
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const state = { file: null, previewUrl: null, ffmpeg: null, busy: false, outputBlob: null, assetBlob: null, outputName: "IntroAddon_Custom.mcaddon", assetName: "IntroAddon_Resources.zip", duration: 0, sourceWidth: 0, sourceHeight: 0 };
  window.addEventListener("error", event => { const message = event && event.message ? event.message : "Error inesperado del navegador"; try { setStatus("Error de la página: " + message + ". Recarga la web e inténtalo otra vez.", "error"); } catch (_) {} });
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
  const makeUuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); }));
  const fileBytes = async (file) => new Uint8Array(await file.arrayBuffer());
  const bytesLabel = (n) => n < 1024 * 1024 ? (n / 1024).toFixed(1) + " KB" : (n / 1024 / 1024).toFixed(2) + " MB";

  const scriptLoads = new Map();
  function loadScript(url, ready) {
    if (ready()) return Promise.resolve();
    if (scriptLoads.has(url)) return scriptLoads.get(url);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.onload = () => ready() ? resolve() : reject(new Error("La biblioteca se descargó, pero no quedó disponible."));
      script.onerror = () => reject(new Error("No se pudo descargar una biblioteca externa. Comprueba tu conexión y vuelve a intentarlo."));
      document.head.appendChild(script);
    }).catch(error => { scriptLoads.delete(url); throw error; });
    scriptLoads.set(url, promise);
    return promise;
  }
  const readNumber = (id, min, max) => {
    const n = Number($(id).value);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error($(id).previousElementSibling?.textContent + " debe estar entre " + min + " y " + max + ".");
    return Math.floor(n);
  };

  function acceptFile(file) {
    if (!file) {
      setStatus("No se recibió ningún archivo. Intenta seleccionarlo otra vez.", "error");
      return;
    }
    if (file.size <= 0) {
      setStatus("El archivo seleccionado está vacío. Prueba con otro vídeo.", "error");
      return;
    }
    state.file = file;
    state.duration = 0; state.sourceWidth = 0; state.sourceHeight = 0;
    state.outputBlob = null;
    state.assetBlob = null;
    $("downloadAgain").classList.add("hidden");
    $("downloadAssets").classList.add("hidden");
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = URL.createObjectURL(file);
    $("preview").onloadedmetadata = () => {
      state.duration = Number.isFinite($("preview").duration) ? $("preview").duration : 0;
      state.sourceWidth = $("preview").videoWidth || 0;
      state.sourceHeight = $("preview").videoHeight || 0;
      autoConfigure();
    };
    $("preview").onerror = () => {
      setStatus("Archivo seleccionado: " + file.name + ". No se pudo mostrar la vista previa; intenta generar o prueba un MP4 H.264.", "error");
    };
    $("preview").src = state.previewUrl;
    $("preview").classList.remove("hidden");
    $("videoInfo").textContent = file.name + " · " + bytesLabel(file.size) + (file.type ? " · " + file.type : "");
    $("videoInfo").classList.remove("hidden");
    $("generate").disabled = false;
    setStatus("Vídeo listo. Calculando la configuración recomendada…");
  }

  function autoConfigure() {
    if (!state.sourceWidth || !state.sourceHeight) return;
    const duration = state.duration || 0;
    const fps = duration > 180 ? 12 : duration > 60 ? 15 : 24;
    $("fps").value = String(fps);
    const scale = Math.min(1, 640 / state.sourceWidth, 360 / state.sourceHeight);
    const round16 = n => Math.max(16, Math.round((n * scale) / 16) * 16);
    const w = round16(state.sourceWidth), h = round16(state.sourceHeight);
    $("frameWidth").value = String(w); $("frameHeight").value = String(h);
    const maxCols = Math.max(1, Math.floor(4096 / w));
    const maxRows = Math.max(1, Math.floor(4096 / h));
    const targetFrames = Math.max(1, Math.ceil(fps * Math.min(duration || 2, 2)));
    const cols = Math.min(maxCols, Math.max(1, Math.ceil(Math.sqrt(targetFrames * h / w))));
    const rows = Math.min(maxRows, Math.max(1, Math.ceil(targetFrames / cols)));
    $("columns").value = String(cols); $("rows").value = String(rows);
    $("autoConfig").textContent = "Origen: " + state.sourceWidth + "×" + state.sourceHeight + " · " +
      (duration ? duration.toFixed(2) + " s" : "duración por detectar") + " · Recomendado: " +
      w + "×" + h + " px, " + fps + " FPS, hojas de " + cols + "×" + rows + " fotogramas.";
  }
  window.introAddonSelectFile = acceptFile;
  $("videoFile").addEventListener("cancel", () => setStatus("Selección cancelada. Pulsa el selector para elegir un vídeo.", ""));
  const drop = $("dropzone");
  ["dragenter", "dragover"].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.remove("dragging"); }));
  drop.addEventListener("drop", e => acceptFile(e.dataTransfer.files[0]));

  async function getFFmpeg() {
    if (state.ffmpeg) return state.ffmpeg;
    if (!window.FFmpeg || typeof window.FFmpeg.createFFmpeg !== "function") {
      await loadScript("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js", () => !!(window.FFmpeg && typeof window.FFmpeg.createFFmpeg === "function"));
    }
    if (!window.FFmpeg || typeof window.FFmpeg.createFFmpeg !== "function") {
      throw new Error("FFmpeg no está disponible. Comprueba tu conexión e inténtalo otra vez.");
    }
    log("Preparando FFmpeg.wasm 0.11.6 con core-st 0.11.1 (un solo hilo, sin SharedArrayBuffer)…");
    log("Compatibilidad del navegador: SharedArrayBuffer=" + (typeof SharedArrayBuffer !== "undefined" ? "disponible" : "no disponible") + ". Se usa core-st para no depender de él.");
    const ff = window.FFmpeg.createFFmpeg({
      mainName: "main",
      corePath: "https://unpkg.com/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js",
      log: true,
      logger: ({ type, message }) => {
        if (typeof message !== "string") return;
        state.ffmpegMessages = state.ffmpegMessages || [];
        state.ffmpegMessages.push(message);
        if (state.ffmpegMessages.length > 30) state.ffmpegMessages.shift();
        if (type === "fferr" && /error|invalid|unknown|failed|not found|no such|stream map|encoder|decoder/i.test(message)) log("FFmpeg: " + message);
      },
      progress: ({ ratio }) => {
        if (Number.isFinite(ratio)) setProgress(Math.min(68, Math.max(5, ratio * 68)), "Procesando vídeo…");
      }
    });
    try {
      await ff.load();
    } catch (error) {
      const detail = error && error.message ? error.message : String(error);
      log("Fallo al inicializar FFmpeg: " + detail);
      if (/SharedArrayBuffer/i.test(detail)) {
        throw new Error("El CDN o el navegador está cargando un motor FFmpeg incompatible. Se ha seleccionado el core de un solo hilo; recarga la página actualizada y vuelve a intentarlo. Si persiste, envía el registro completo.");
      }
      throw new Error("No se pudo iniciar FFmpeg: " + detail);
    }
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
    log("Versión de procesamiento: extracción continua de fotogramas · build 2026-10-12-h");
    $("progressWrap").classList.remove("hidden");
    $("downloadAgain").classList.add("hidden");
    let ff;
    const tempFiles = [];
    try {
      const fps = readNumber("fps", 1, 60);
      const frameW = readNumber("frameWidth", 16, 4096);
      const frameH = readNumber("frameHeight", 16, 4096);
      const requestedCols = readNumber("columns", 1, 32);
      const requestedRows = readNumber("rows", 1, 32);
      // El atlas final será una sola imagen en cuadrícula, reproducida mediante metadatos Aseprite.
      let cols = Math.max(1, Math.min(requestedCols, Math.floor(4096 / frameW), 32));
      let rows = 1;
      let capacity = 1;
      if (frameW > 4096 || frameH > 4096) throw new Error("Cada fotograma debe caber en 4096 × 4096 px.");
      if (frameW * frameH > 180000000) throw new Error("La resolución del fotograma es demasiado grande. Reduce ancho y alto.");
      setStatus("Preparando bibliotecas de generación…");
      if (typeof window.JSZip !== "function") {
        await loadScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js", () => typeof window.JSZip === "function");
      }
      if (typeof window.JSZip !== "function") throw new Error("No se pudo cargar JSZip para empaquetar los recursos. Comprueba tu conexión e inténtalo otra vez.");
      ff = await getFFmpeg();
      const ext = (state.file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
      const inputName = "input." + ext;
      ff.FS("writeFile", inputName, await fileBytes(state.file));
      tempFiles.push(inputName);
      // Procesar el audio antes de generar miles de PNG reduce el riesgo de quedarnos sin memoria.
      log("Extrayendo audio OGG (Vorbis, 44.1 kHz)…");
      state.ffmpegMessages = [];
      const actualAudio = "intro_audio.ogg";
      let audioData;
      try {
        await ff.run("-i", inputName, "-map", "0:a:0", "-vn", "-sn", "-dn", "-ac", "2", "-ar", "44100", "-c:a", "libvorbis", "-q:a", "5", "-f", "ogg", "-y", actualAudio);
        if (!ff.FS("readdir", "/").includes(actualAudio)) throw new Error("FFmpeg terminó sin crear intro_audio.ogg.");
        audioData = ff.FS("readFile", actualAudio);
        if (!audioData || audioData.length < 64) throw new Error("El archivo OGG generado está vacío o incompleto.");
        tempFiles.push(actualAudio);
        log("Audio OGG extraído: " + (audioData.length / 1024 / 1024).toFixed(2) + " MB.");
      } catch (err) {
        const detail = (state.ffmpegMessages || []).slice(-8).join(" | ");
        const reason = err && err.message ? err.message : String(err);
        throw new Error("Falló la extracción OGG antes de procesar los fotogramas. " + reason + (detail ? " · FFmpeg: " + detail : " · FFmpeg no informó la causa; puede ser un códec no compatible o falta de memoria."));
      }
      const imageFormat = "png";
      const keepAspect = $("keepAspect").checked;
      const vf = keepAspect
        ? "fps=" + fps + ",scale=" + frameW + ":" + frameH + ":force_original_aspect_ratio=decrease,pad=" + frameW + ":" + frameH + ":(ow-iw)/2:(oh-ih)/2"
        : "fps=" + fps + ",scale=" + frameW + ":" + frameH;
      const duration = state.duration || 0;
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error("No se pudo detectar la duración del vídeo. Vuelve a seleccionarlo y espera a que aparezcan sus dimensiones y duración antes de generar.");
      }

      // core-st puede dejar el worker ocupado tras terminar un comando de extracción
      // de imágenes con exit(0). Ejecutar toda la extracción de vídeo en UNA sola llamada
      // evita lanzar un segundo comando sobre ese worker ocupado.
      const sheetMeta = [];
      let totalFrames = 0;
      const zip = new window.JSZip();
      // El empaquetado y la reproducción del audio se dejan intactos.
      zip.file("audio/intro.ogg", audioData, { binary: true, compression: "STORE" });

      // Limpia cualquier resto de una ejecución anterior dentro del MEMFS.
      for (const name of ff.FS("readdir", "/").filter(n => /^frame_\d{6}\.jpg$/.test(n))) {
        try { ff.FS("unlink", name); } catch (_) {}
      }
      log("Extrayendo fotogramas a " + fps + " FPS en una sola ejecución de FFmpeg…");
      state.ffmpegMessages = [];
      try {
        await ff.run(
          "-i", inputName, "-an", "-vf", vf, "-vsync", "0", "-q:v", "8",
          "-f", "image2", "-y", "-start_number", "1", "frame_%06d.jpg"
        );
      } catch (err) {
        const reason = err && err.message ? err.message : String(err);
        const completedFiles = ff.FS("readdir", "/").filter(n => /^frame_\d{6}\.jpg$/.test(n));
        if (/Program terminated with exit\(0\)/i.test(reason) && completedFiles.length > 0) {
          log("FFmpeg finalizó la extracción con exit(0); se validaron " + completedFiles.length + " fotogramas temporales.");
        } else {
          const detail = (state.ffmpegMessages || []).slice(-8).join(" | ");
          throw new Error("FFmpeg no pudo completar la extracción de fotogramas. " + reason +
            (detail ? " · FFmpeg: " + detail : " · No se encontraron fotogramas válidos; prueba una resolución o FPS menores."));
        }
      }

      const batch = ff.FS("readdir", "/").filter(n => /^frame_\d{6}\.jpg$/.test(n)).sort();
      if (!batch.length) throw new Error("FFmpeg terminó sin generar fotogramas. Prueba con otro vídeo MP4 o revisa su códec.");
      const maxCols = Math.floor(4096 / frameW);
      const maxRows = Math.floor(4096 / frameH);
      if (batch.length > maxCols * maxRows) {
        throw new Error("El vídeo necesita " + batch.length + " fotogramas, pero a " + frameW + "×" + frameH + " solo caben " + (maxCols * maxRows) + " en una única imagen de máximo 4096×4096. Reduce los FPS o la resolución para probar el atlas único.");
      }
      cols = Math.min(maxCols, Math.max(1, requestedCols, Math.ceil(batch.length / maxRows)));
      rows = Math.ceil(batch.length / cols);
      capacity = batch.length;
      const atlasCanvas = document.createElement("canvas");
      atlasCanvas.width = frameW * cols;
      atlasCanvas.height = frameH * rows;
      if (atlasCanvas.width > 4096 || atlasCanvas.height > 4096) throw new Error("El atlas excede 4096 × 4096 px. Reduce FPS o resolución.");
      const atlasContext = atlasCanvas.getContext("2d", { alpha: true });
      if (!atlasContext) throw new Error("No se pudo crear el lienzo del atlas de vídeo.");
      const asepriteFrames = [];
      log("Extracción completada: " + batch.length + " fotogramas. Construyendo una única imagen atlas " + atlasCanvas.width + "×" + atlasCanvas.height + "…");
      const clientBatchSize = 60;
      for (let index = 0; index < batch.length; index++) {
        const name = batch[index];
        const data = ff.FS("readFile", name);
        let img;
        try {
          img = await createImageBitmap(new Blob([data], { type: "image/jpeg" }));
          const x = (index % cols) * frameW;
          const y = Math.floor(index / cols) * frameH;
          atlasContext.drawImage(img, x, y, frameW, frameH);
          asepriteFrames.push({
            filename: "frame_" + String(index + 1).padStart(6, "0") + ".png",
            frame: { x, y, w: frameW, h: frameH },
            rotated: false, trimmed: false,
            spriteSourceSize: { x: 0, y: 0, w: frameW, h: frameH },
            sourceSize: { w: frameW, h: frameH },
            duration: Math.max(1, Math.round(1000 / fps))
          });
        } catch (err) {
          throw new Error("No se pudo montar el fotograma " + (index + 1) + " de " + batch.length + ": " + (err && err.message ? err.message : String(err)));
        } finally {
          if (img && img.close) img.close();
          try { ff.FS("unlink", name); } catch (_) {}
        }
        totalFrames++;
        if ((index + 1) % clientBatchSize === 0 || index + 1 === batch.length) {
          setProgress(68 + ((index + 1) / batch.length) * 14,
            "Montando atlas · " + (index + 1) + " de " + batch.length + " fotogramas…");
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      if (!totalFrames) throw new Error("FFmpeg no generó fotogramas. Prueba con otro vídeo MP4 o revisa su códec.");
      const atlasBlob = await new Promise((resolve, reject) => atlasCanvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("No se pudo codificar la imagen atlas PNG.")), "image/png"));
      const atlasFilename = "video/spritesheet_001.png";
      zip.file(atlasFilename, atlasBlob, { compression: "STORE" });
      const atlasJson = {
        frames: asepriteFrames,
        meta: { app: "IntroAddon Studio", version: "1.0", image: "spritesheet_001.png", format: "RGBA8888", size: { w: atlasCanvas.width, h: atlasCanvas.height }, scale: "1" }
      };
      const atlasJsonFilename = "video/spritesheet_001.json";
      zip.file(atlasJsonFilename, JSON.stringify(atlasJson));
      sheetMeta.push({ filename: atlasFilename, metadataFilename: atlasJsonFilename, width: atlasCanvas.width, height: atlasCanvas.height, frameCount: totalFrames, columns: cols, rows });
      log("Atlas único listo: " + totalFrames + " fotogramas en " + cols + "×" + rows + " celdas.");
      setProgress(82, "Atlas único preparado…");

      const config = {
        schemaVersion: 1,
        project: "IntroAddon",
        createdAt: new Date().toISOString(),
        source: { name: state.file.name, durationSeconds: duration, fps: fps, extractedFrames: totalFrames },
        playback: {
          targetPlatforms: ["Android", "Windows"],
          durationSeconds: duration,
          fps: fps,
          audioPath: actualAudio.endsWith(".ogg") ? "audio/intro.ogg" : "audio/intro.wav"
        },
        spritesheets: {
          frameWidth: frameW, frameHeight: frameH, columns: cols, rows: rows,
          framesPerSheet: capacity, format: imageFormat, totalFrames: totalFrames, sheets: sheetMeta
        },
        note: "Todos los fotogramas se empaquetan en una única imagen atlas PNG con metadatos Aseprite para aseprite_flip_book; el audio OGG Vorbis se conserva en el Resource Pack."
      };
      config.runtime = {
        addonFormat: "mcaddon",
        visualPlayback: "Bedrock JSON UI flip_book con tiras horizontales de una fila",
        soundEvent: "introaddon.cinematic_intro",
        limitations: [
          "La UI visual comienza cuando carga el HUD de cada cliente.",
          "El modo grupal espera para iniciar el audio, pero no sincroniza de forma fiable el comienzo visual entre clientes.",
          "La integración de UI personalizada debe probarse en las versiones objetivo de Bedrock."
        ]
      };
      zip.file("introaddon_config.json", JSON.stringify(config, null, 2));
      zip.file("README.txt", "IntroAddon - recursos preparados\\n\\nvideo/: spritesheets.\\naudio/: audio extraído.\\nintroaddon_config.json: rutas, FPS, dimensiones y opciones.\\n");
      if ($("includeOriginal").checked) zip.file("source/" + safeName(state.file.name), state.file, { compression: "STORE" });

      setProgress(86, "Construyendo los packs de Minecraft Bedrock…");
      const rpUuid = makeUuid(), rpModuleUuid = makeUuid(), bpUuid = makeUuid(), bpDataUuid = makeUuid(), bpScriptUuid = makeUuid();
      const rpZip = new JSZip(), bpZip = new JSZip();
      rpZip.file("manifest.json", JSON.stringify({
        format_version: 2,
        header: { name: "IntroAddon Resources", description: "Recursos cinematográficos generados por IntroAddon Studio.", uuid: rpUuid, version: [1,0,0], min_engine_version: [1,26,50] },
        modules: [{ type: "resources", uuid: rpModuleUuid, version: [1,0,0] }]
      }, null, 2));
      bpZip.file("manifest.json", JSON.stringify({
        format_version: 2,
        header: { name: "IntroAddon Behavior", description: "Audio y configuración de IntroAddon.", uuid: bpUuid, version: [1,0,0], min_engine_version: [1,26,50] },
        modules: [
          { type: "data", uuid: bpDataUuid, version: [1,0,0] },
          { type: "script", language: "javascript", entry: "scripts/main.js", uuid: bpScriptUuid, version: [1,0,0] }
        ],
        dependencies: [
          { uuid: rpUuid, version: [1,0,0] },
          { module_name: "@minecraft/server", version: "2.10.0" },
          { module_name: "@minecraft/server-ui", version: "2.1.0" }
        ]
      }, null, 2));

      const uiAnimations = {};
      const uiControls = [];
      for (let i = 0; i < sheetMeta.length; i++) {
        const sheet = sheetMeta[i], n = i + 1;
        const texName = "spritesheet_" + String(n).padStart(3, "0");
        const animName = "sheet_" + n + "_uv";
        const startEvent = "introaddon_start_sheet_" + n;
        const nextEvent = "introaddon_finish";
        const pngBytes = await zip.file(sheet.filename).async("uint8array");
        rpZip.file("textures/ui/intro/" + texName + ".png", pngBytes, { binary: true, compression: "STORE" });
        const metadataBytes = await zip.file(sheet.metadataFilename).async("uint8array");
        rpZip.file("textures/ui/intro/" + texName + ".json", metadataBytes, { binary: true, compression: "STORE" });
        uiAnimations[animName] = {
          anim_type: "aseprite_flip_book",
          initial_uv: [0, 0],
          reversible: false,
          resettable: false,
          easing: "linear",
          end_event: nextEvent
        };
        const control = {
          type: "image",
          texture: "textures/ui/intro/" + texName,
          size: ["100%", "100%"], uv_size: [frameW, frameH],
          uv: "@introaddon." + animName,
          anchor_from: "center", anchor_to: "center",
          keep_ratio: true, layer: 1000002 + n, disable_anim_fast_forward: true
        };
        if (i > 0) {
          const alphaName = "sheet_" + n + "_alpha";
          if (i === sheetMeta.length - 1) {
            const holdName = "sheet_" + n + "_hold";
            const fadeName = "sheet_" + n + "_fade";
            uiAnimations[alphaName] = { anim_type: "alpha", from: 0, to: 1, duration: 0.01, play_event: startEvent, next: "@introaddon." + holdName };
            uiAnimations[holdName] = { anim_type: "alpha", from: 1, to: 1, duration: sheet.frameCount / fps, next: "@introaddon." + fadeName };
            uiAnimations[fadeName] = { anim_type: "alpha", from: 1, to: 0, duration: 0.45 };
          } else {
            uiAnimations[alphaName] = { anim_type: "alpha", from: 0, to: 1, duration: 0.01, play_event: startEvent };
          }
          control.alpha = "@introaddon." + alphaName;
        } else if (sheetMeta.length === 1) {
          const alphaName = "sheet_1_alpha", holdName = "sheet_1_hold", fadeName = "sheet_1_fade";
          uiAnimations[alphaName] = { anim_type: "alpha", from: 1, to: 1, duration: sheet.frameCount / fps, next: "@introaddon." + holdName };
          uiAnimations[holdName] = { anim_type: "alpha", from: 1, to: 1, duration: 0.01, next: "@introaddon." + fadeName };
          uiAnimations[fadeName] = { anim_type: "alpha", from: 1, to: 0, duration: 0.45 };
          control.alpha = "@introaddon." + alphaName;
        }
        uiControls.push({ ["sheet_" + n]: control });
      }
      // Fondo negro opaco para cubrir el HUD y las franjas fuera de la imagen.
      const blackCanvas = document.createElement("canvas");
      blackCanvas.width = 1; blackCanvas.height = 1;
      const blackContext = blackCanvas.getContext("2d", { alpha: false });
      if (!blackContext) throw new Error("No se pudo crear el fondo negro de la intro.");
      blackContext.fillStyle = "#000000"; blackContext.fillRect(0, 0, 1, 1);
      const blackBlob = await new Promise(resolve => blackCanvas.toBlob(resolve, "image/png"));
      if (!blackBlob) throw new Error("No se pudo codificar la textura del fondo negro.");
      rpZip.file("textures/ui/intro/black.png", blackBlob, { binary: true, compression: "STORE" });
      uiAnimations.black_fade = {
        anim_type: "alpha", from: 1, to: 0, duration: 0.45,
        play_event: "introaddon_finish"
      };
      uiControls.unshift({ black_background: {
        type: "image", texture: "textures/ui/intro/black",
        size: ["100%", "100%"], keep_ratio: false,
        anchor_from: "center", anchor_to: "center",
        alpha: "@introaddon.black_fade", layer: 1000001
      } });
      const introUi = {
        namespace: "introaddon", ...uiAnimations,
        overlay: {
          type: "panel", size: ["100%", "100%"], layer: 1000000, controls: uiControls,
          // La intro solo tapa el HUD cuando el script activa el título señal.
          bindings: [
            { binding_name: "#hud_title_text_string" },
            { binding_type: "view", source_property_name: "(#hud_title_text_string = 'INTROADDON_START')", target_property_name: "#visible" }
          ]
        }
      };
      rpZip.file("ui/intro_ui.json", JSON.stringify(introUi, null, 2));
      rpZip.file("ui/_ui_defs.json", JSON.stringify({ ui_defs: ["ui/hud_screen.json", "ui/intro_ui.json"] }, null, 2));
      rpZip.file("ui/hud_screen.json", JSON.stringify({
        namespace: "hud",
        root_panel: { modifications: [{
          array_name: "controls", operation: "insert_front",
          value: { "introaddon_overlay@introaddon.overlay": { layer: 1000000 } }
        }] }
      }, null, 2));
      const audioPath = actualAudio.endsWith(".ogg") ? "sounds/intro.ogg" : "sounds/intro.wav";
      rpZip.file(audioPath, audioData, { binary: true, compression: "STORE" });
      rpZip.file("sounds/sound_definitions.json", JSON.stringify({
        format_version: "1.20.20",
        sound_definitions: {
          "introaddon.cinematic_intro": {
            category: "ui",
            sounds: [{ name: "sounds/intro", stream: true, volume: 1.0, load_on_low_memory: true, is3D: false }]
          }
        }
      }, null, 2));
      
      const scriptLines = [
        'import { world, system, HudVisibility, HudElement } from "@minecraft/server";',
        'import { ModalFormData } from "@minecraft/server-ui";',
        "const CONFIG = " + JSON.stringify(config) + ";",
        'const SOUND_ID = "introaddon.cinematic_intro";',
        'let menuShown = false;',
        'let menuPending = false;',
        'let menuAttempts = 0;',
        'let modeSelected = false;',
        'let playbackMode = "per_player";',
        'let minimumPlayers = 2;',
        'let soundVolume = 1.0;',
        'let groupSoundStarted = false;',
        'function startIntro(player) { const ticks = Math.max(20, Math.ceil(Number(CONFIG.playback.durationSeconds || 5) * 20) + 12); const hidden = [HudElement.TouchControls, HudElement.Hotbar, HudElement.Crosshair, HudElement.Health, HudElement.Hunger, HudElement.Armor, HudElement.ProgressBar, HudElement.AirBubbles, HudElement.HorseHealth, HudElement.StatusEffects, HudElement.ItemText, HudElement.PaperDoll, HudElement.ToolTips]; try { player.onScreenDisplay.setHudVisibility(HudVisibility.Hide, hidden); } catch (e) { try { player.sendMessage("§cIntroAddon: no se pudieron ocultar todos los controles: " + String(e)); } catch (_) {} } try { player.onScreenDisplay.setTitle("INTROADDON_START", { fadeInDuration: 0, stayDuration: ticks, fadeOutDuration: 0 }); } catch (e) { try { player.sendMessage("§cIntroAddon: no se pudo activar la pantalla de intro: " + String(e)); } catch (_) {} } let audioStarted = false; try { player.playSound(SOUND_ID, { volume: soundVolume, pitch: 1.0 }); audioStarted = true; } catch (apiError) { try { player.runCommand("playsound " + SOUND_ID + " @s ~ ~ ~ " + soundVolume + " 1"); audioStarted = true; } catch (commandError) { try { player.sendMessage("§cIntroAddon: no se pudo iniciar el audio. Comprueba que el pack de recursos esté activo y que sounds/intro.ogg exista. API: " + String(apiError) + " · playsound: " + String(commandError)); } catch (_) {} } } if (audioStarted) { try { player.sendMessage("§aIntroAddon: intro y audio iniciados."); } catch (_) {} } system.runTimeout(() => { try { player.onScreenDisplay.setHudVisibility(HudVisibility.Reset, hidden); } catch (_) {} }, ticks); }',
        'function startGroupAudio() { const runId = system.runInterval(() => { const players = world.getAllPlayers(); if (!groupSoundStarted && players.length >= minimumPlayers) { groupSoundStarted = true; system.clearRun(runId); system.runTimeout(() => { for (const p of world.getAllPlayers()) startIntro(p); }, 40); } }, 20); }',
        'async function showFirstPlayerMenu(player) {',
        '  if (menuShown || menuPending || menuAttempts >= 3) return;',
        '  menuPending = true; menuAttempts++;',
        '  try {',
        '    const form = new ModalFormData().title("IntroAddon - configuración").dropdown("Modo de reproducción", ["Individual - cada jugador al entrar", "Grupal - esperar al grupo"], 0).slider("Volumen de audio (%)", 0, 100, { valueStep: 5, defaultValue: 100 }).slider("Jugadores necesarios (modo grupal)", 1, 20, { valueStep: 1, defaultValue: 2 });',
        '    const answer = await form.show(player);',
        '    menuShown = true; menuPending = false;',
        '    if (answer.canceled || !answer.formValues) { playbackMode = "per_player"; soundVolume = 1.0; minimumPlayers = 2; modeSelected = true; player.sendMessage("§eIntroAddon: se usarán los valores predeterminados."); system.runTimeout(() => startIntro(player), 40); return; }',
        '    playbackMode = Number(answer.formValues[0]) === 0 ? "per_player" : "group_once";',
        '    soundVolume = Math.max(0, Math.min(1, Number(answer.formValues[1]) / 100));',
        '    minimumPlayers = Math.max(1, Math.min(20, Math.floor(Number(answer.formValues[2]) || 2)));',
        '    modeSelected = true;',
        '    player.sendMessage(playbackMode === "per_player" ? "§aIntroAddon: modo individual. El audio comenzará en breve." : "§aIntroAddon: modo grupal. Esperando a " + minimumPlayers + " jugador(es).");',
        '    if (playbackMode === "per_player") system.runTimeout(() => startIntro(player), 40);',
        '    else startGroupAudio();',
        '  } catch (e) { menuPending = false; if (menuAttempts < 3) { system.runTimeout(() => showFirstPlayerMenu(player), 60); } else { menuShown = true; modeSelected = true; playbackMode = "per_player"; soundVolume = 1.0; try { player.sendMessage("§cIntroAddon: no se pudo abrir la configuración tras 3 intentos: " + String(e) + ". Se usará el modo individual."); } catch (_) {} system.runTimeout(() => startIntro(player), 40); } }',
        '}',
        'world.afterEvents.playerSpawn.subscribe((event) => { if (!event.initialSpawn) return; const player = event.player; system.runTimeout(() => { if (!menuShown) showFirstPlayerMenu(player); else if (modeSelected && playbackMode === "per_player") system.runTimeout(() => startIntro(player), 40); }, 20); });',
        'system.runInterval(() => { if (menuShown) return; const players = world.getAllPlayers(); if (players.length > 0) showFirstPlayerMenu(players[0]); }, 40);'
      ];
      bpZip.file("scripts/main.js", scriptLines.join("\n"));
      bpZip.file("introaddon_config.json", JSON.stringify(config, null, 2));
      bpZip.file("README.txt", "Activa el pack de comportamiento y el pack de recursos. La UI visual empieza al cargar el HUD; el modo grupal solo puede retrasar el audio, no sincronizar el inicio visual de todos los clientes.\n");
      const [rpBytes, bpBytes] = await Promise.all([
        rpZip.generateAsync({ type: "uint8array", compression: "STORE" }),
        bpZip.generateAsync({ type: "uint8array", compression: "STORE" })
      ]);
      const addonZip = new JSZip();
      addonZip.file("IntroAddon_RP.mcpack", rpBytes, { binary: true, compression: "STORE" });
      addonZip.file("IntroAddon_BP.mcpack", bpBytes, { binary: true, compression: "STORE" });
      const addonBlob = await addonZip.generateAsync({ type: "blob", compression: "STORE" }, meta => setProgress(88 + meta.percent * 0.12, "Empaquetando addon…"));
      const assetBlob = await zip.generateAsync({ type: "blob", compression: "STORE" });
      state.outputBlob = addonBlob;
      state.assetBlob = assetBlob;
      const baseName = "IntroAddon_" + safeName(state.file.name.replace(/\.[^.]+$/, ""));
      state.outputName = baseName + ".mcaddon";
      state.assetName = baseName + "_Resources.zip";
      setProgress(100, "Addon generado.");
      setStatus("Generado: addon .mcaddon con " + totalFrames + " fotogramas, " + sheetMeta.length + " spritesheet(s), audio y configuración.", "success");
      $("downloadAgain").classList.remove("hidden");
      $("downloadAssets").classList.remove("hidden");
      log("Addon generado: " + bytesLabel(addonBlob.size));
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
  function downloadAssets() {
    if (!state.assetBlob) return;
    const url = URL.createObjectURL(state.assetBlob);
    const a = document.createElement("a"); a.href = url; a.download = state.assetName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  $("generate").addEventListener("click", run);
  $("downloadAgain").addEventListener("click", downloadOutput);
  $("downloadAssets").addEventListener("click", downloadAssets);
  setStatus("Web cargada. Selecciona un vídeo para comenzar.");
})();