(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const state = { file: null, previewUrl: null, ffmpeg: null, busy: false, outputBlob: null, outputName: "IntroAddon_Custom_Resources.zip" };
  const ffmpegScript = window.FFmpeg;
  const setStatus = (message, kind = "") => { $("status").textContent = message; $("status").className = "status" + (kind ? " " + kind : ""); };
  const setProgress = (percent, message) => {
    $("progressWrap").classList.remove("hidden");
    $("progressBar").style.width = Math.max(0, Math.min(100, percent)) + "%";
    $("progressPercent").textContent = Math.round(percent) + "%";
    $("progressText").textContent = message;
  };
  const log = (message) => {
    const el = $("log");
    el.textContent = (el.textContent + message + "\n").slice(-5000);
    el.scrollTop = el.scrollHeight;
  };
  const safeName = (name) => name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 90) || "intro_video";
  const bytesLabel = (n) => n < 1024 * 1024 ? (n / 1024).toFixed(1) + " KB" : (n / 1024 / 1024).toFixed(2) + " MB";
  const readNumber = (id, min, max) => {
    const n = Number($(id).value);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error($(id).previousElementSibling?.textContent + " debe estar entre " + min + " y " + max + ".");
    return Math.floor(n);
  };

  function acceptFile(file) {
    if (!file) return;
    state.file = file;
    state.outputBlob = null;
    $("downloadAgain").classList.add("hidden");
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = URL.createObjectURL(file);
    $("preview").src = state.previewUrl;
    $("preview").classList.remove("hidden");
    $("videoInfo").textContent = file.name + " · " + bytesLabel(file.size) + (file.type ? " · " + file.type : "");
    $("videoInfo").classList.remove("hidden");
    $("generate").disabled = false;
    setStatus("Vídeo listo. Ajusta la salida y genera el paquete.");
  }
  $("videoFile").addEventListener("change", e => acceptFile(e.target.files[0]));
  const drop = $("dropzone");
  ["dragenter", "dragover"].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.remove("dragging"); }));
  drop.addEventListener("drop", e => acceptFile(e.dataTransfer.files[0]));

  async function getFFmpeg() {
    if (state.ffmpeg) return state.ffmpeg;
    if (!ffmpegScript || !ffmpegScript.createFFmpeg) throw new Error("No se pudo cargar FFmpeg.wasm. Comprueba la conexión y vuelve a cargar la página.");
    const { createFFmpeg, fetchFile } = ffmpegScript;
    const ff = createFFmpeg({
      log: false,
      corePath: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js",
      progress: ({ ratio }) => {
        if (Number.isFinite(ratio)) setProgress(Math.min(68, Math.max(5, ratio * 68)), "Procesando vídeo…");
      }
    });
    ff.__fetchFile = fetchFile;
    log("Cargando motor FFmpeg.wasm…");
    await ff.load();
    state.ffmpeg = ff;
    log("Motor listo.");
    return ff;
  }

  function makeSheet(frames, frameW, frameH, cols, rows, format, sheetIndex, zip) {
    const canvas = document.createElement("canvas");
    canvas.width = frameW * cols;
    canvas.height = frameH * rows;
    const ctx = canvas.getContext("2d", { alpha: format === "png" });
    if (format !== "png") { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    frames.forEach((image, i) => {
      const x = (i % cols) * frameW;
      const y = Math.floor(i / cols) * frameH;
      ctx.drawImage(image, x, y, frameW, frameH);
    });
    return new Promise((resolve, reject) => canvas.toBlob(async blob => {
      if (!blob) return reject(new Error("No se pudo codificar el spritesheet."));
      const filename = "video/spritesheet_" + String(sheetIndex).padStart(3, "0") + "." + format;
      zip.file(filename, blob, { compression: "STORE" });
      resolve({ filename, width: canvas.width, height: canvas.height, frameCount: frames.length, columns: cols, rows: rows });
    }, format === "png" ? "image/png" : "image/jpeg", 0.92));
  }

  async function run() {
    if (!state.file || state.busy) return;
    state.busy = true;
    $("generate").disabled = true;
    $("log").textContent = "";
    $("progressWrap").classList.remove("hidden");
    $("downloadAgain").classList.add("hidden");
    let ff;
    const tempFiles = [];
    try {
      const fps = readNumber("fps", 1, 60);
      const frameW = readNumber("frameWidth", 16, 4096);
      const frameH = readNumber("frameHeight", 16, 4096);
      const cols = readNumber("columns", 1, 32);
      const rows = readNumber("rows", 1, 32);
      const minPlayers = readNumber("minPlayers", 1, 100);
      const capacity = cols * rows;
      if (frameW * frameH * capacity > 180000000) throw new Error("La hoja sería demasiado grande para un procesamiento seguro. Reduce la resolución, filas o columnas.");
      setStatus("Preparando el procesamiento…");
      ff = await getFFmpeg();
      const ext = (state.file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
      const inputName = "input." + ext;
      ff.FS("writeFile", inputName, await ff.__fetchFile(state.file));
      tempFiles.push(inputName);
      const imageFormat = $("imageFormat").value;
      const keepAspect = $("keepAspect").checked;
      const vf = keepAspect
        ? "fps=" + fps + ",scale=" + frameW + ":" + frameH + ":force_original_aspect_ratio=decrease,pad=" + frameW + ":" + frameH + ":(ow-iw)/2:(oh-ih)/2"
        : "fps=" + fps + ",scale=" + frameW + ":" + frameH;
      log("Extrayendo fotogramas a " + fps + " FPS…");
      await ff.run("-i", inputName, "-an", "-vf", vf, "-vsync", "0", "-start_number", "1", "frame_%06d.png");
      const entries = ff.FS("readdir", "/").filter(n => /^frame_\d{6}\.png$/.test(n)).sort();
      if (!entries.length) throw new Error("No se extrajeron fotogramas. Prueba con otro formato de vídeo.");
      entries.forEach(n => tempFiles.push(n));
      log("Fotogramas extraídos: " + entries.length);
      setProgress(70, "Montando spritesheets…");
      const zip = new JSZip();
      const sheetMeta = [];
      const totalSheets = Math.ceil(entries.length / capacity);
      for (let s = 0; s < totalSheets; s++) {
        const batch = entries.slice(s * capacity, (s + 1) * capacity);
        const images = [];
        for (const name of batch) {
          const data = ff.FS("readFile", name);
          const url = URL.createObjectURL(new Blob([data], { type: "image/png" }));
          try {
            const img = await createImageBitmap(await (await fetch(url)).blob());
            images.push(img);
          } finally { URL.revokeObjectURL(url); }
          ff.FS("unlink", name);
        }
        const meta = await makeSheet(images, frameW, frameH, cols, rows, imageFormat, s + 1, zip);
        images.forEach(img => img.close && img.close());
        sheetMeta.push(meta);
        setProgress(70 + ((s + 1) / totalSheets) * 12, "Montando spritesheet " + (s + 1) + " de " + totalSheets + "…");
      }

      const audioFormat = $("audioFormat").value;
      const audioName = "audio/intro." + audioFormat;
      log("Extrayendo audio (" + audioFormat.toUpperCase() + ")…");
      try {
        if (audioFormat === "mp3") {
          await ff.run("-i", inputName, "-vn", "-map", "0:a:0", "-codec:a", "libmp3lame", "-q:a", "3", "-y", "intro_audio.mp3");
        } else {
          await ff.run("-i", inputName, "-vn", "-map", "0:a:0", "-codec:a", "pcm_s16le", "-y", "intro_audio.wav");
        }
      } catch (err) {
        if (audioFormat !== "mp3") throw new Error("No se pudo extraer el audio. Comprueba que el vídeo tenga una pista de audio.");
        log("El codificador MP3 no está disponible; se intentará extraer WAV.");
        await ff.run("-i", inputName, "-vn", "-map", "0:a:0", "-codec:a", "pcm_s16le", "-y", "intro_audio.wav");
      }
      let actualAudio = audioFormat === "mp3" ? "intro_audio.mp3" : "intro_audio.wav";
      if (audioFormat === "mp3" && !ff.FS("readdir", "/").includes(actualAudio)) actualAudio = "intro_audio.wav";
      const audioData = ff.FS("readFile", actualAudio);
      zip.file(actualAudio.endsWith(".mp3") ? audioName : "audio/intro.wav", audioData, { binary: true, compression: "STORE" });
      tempFiles.push(actualAudio);
      setProgress(85, "Creando manifiesto y paquete…");

      const duration = Number.isFinite($("preview").duration) ? $("preview").duration : entries.length / fps;
      const config = {
        schemaVersion: 1,
        project: "IntroAddon",
        createdAt: new Date().toISOString(),
        source: { name: state.file.name, durationSeconds: duration, fps: fps, extractedFrames: entries.length },
        playback: {
          targetPlatforms: ["Android", "Windows"],
          mode: $("playMode").value,
          minimumPlayers: minPlayers,
          replayPolicy: $("replay").value,
          durationSeconds: duration,
          fps: fps,
          audioPath: actualAudio.endsWith(".mp3") ? "audio/intro.mp3" : "audio/intro.wav"
        },
        spritesheets: {
          frameWidth: frameW, frameHeight: frameH, columns: cols, rows: rows,
          framesPerSheet: capacity, format: imageFormat, totalFrames: entries.length, sheets: sheetMeta
        },
        note: "Los recursos ya están preparados. Minecraft no debe convertir vídeo ni audio; el reproductor consume las rutas y metadatos de este manifiesto."
      };
      zip.file("introaddon_config.json", JSON.stringify(config, null, 2));
      zip.file("README.txt", "IntroAddon - paquete de recursos\n\nvideo/: spritesheets preparados.\naudio/: pista de audio extraída.\nintroaddon_config.json: rutas, FPS, dimensiones, duración y opciones de inicio.\n\nEste ZIP es un paquete de recursos/configuración generado, no un .mcaddon instalable por sí solo. La capa de reproducción Bedrock debe integrarlo en el pack de comportamiento y recursos.\n");
      if ($("includeOriginal").checked) zip.file("source/" + safeName(state.file.name), state.file, { compression: "STORE" });
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE" }, meta => setProgress(85 + meta.percent * 0.15, "Empaquetando…"));
      state.outputBlob = blob;
      state.outputName = "IntroAddon_" + safeName(state.file.name.replace(/\.[^.]+$/, "")) + "_Resources.zip";
      setProgress(100, "Paquete listo.");
      setStatus("Listo: " + entries.length + " fotogramas en " + sheetMeta.length + " spritesheet(s), audio y configuración.", "success");
      $("downloadAgain").classList.remove("hidden");
      log("Paquete generado: " + bytesLabel(blob.size));
      downloadOutput();
    } catch (error) {
      console.error(error);
      setStatus(error && error.message ? error.message : "Ocurrió un error al procesar el vídeo.", "error");
      log("ERROR: " + (error && error.message ? error.message : String(error)));
    } finally {
      if (ff) {
        for (const name of tempFiles) { try { ff.FS("unlink", name); } catch (_) {} }
      }
      state.busy = false;
      $("generate").disabled = !state.file;
    }
  }

  function downloadOutput() {
    if (!state.outputBlob) return;
    const url = URL.createObjectURL(state.outputBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = state.outputName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  $("generate").addEventListener("click", run);
  $("downloadAgain").addEventListener("click", downloadOutput);
})();