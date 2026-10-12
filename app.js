(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const state = { file: null, previewUrl: null, ffmpeg: null, busy: false, outputBlob: null, assetBlob: null, outputName: "IntroAddon_Custom.mcaddon", assetName: "IntroAddon_Resources.zip" };
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
  const makeUuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); }));
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
    state.assetBlob = null;
    $("downloadAgain").classList.add("hidden");
    $("downloadAssets").classList.add("hidden");
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
      if (frameW * cols > 4096 || frameH * rows > 4096) throw new Error("El spritesheet superaría 4096 px en uno de sus lados. Reduce la resolución, columnas o filas para mantener compatibilidad con Bedrock móvil.");
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
      await ff.run("-i", inputName, "-an", "-vf", vf, "-vsync", "0", "-y", "-start_number", "1", "frame_%06d.png");
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
      let actualAudio = "intro_audio." + audioFormat;
      try {
        if (audioFormat === "ogg") {
          await ff.run("-i", inputName, "-vn", "-map", "0:a:0", "-c:a", "libvorbis", "-q:a", "5", "-y", actualAudio);
        } else {
          await ff.run("-i", inputName, "-vn", "-map", "0:a:0", "-c:a", "pcm_s16le", "-y", actualAudio);
        }
      } catch (err) {
        throw new Error("No se pudo generar audio OGG compatible con Bedrock. Comprueba que el vídeo tenga audio e inténtalo con otro archivo.");
      }
      if (!ff.FS("readdir", "/").includes(actualAudio)) throw new Error("FFmpeg no generó el archivo de audio esperado.");
      const audioData = ff.FS("readFile", actualAudio);
      const finalAudioPath = actualAudio.endsWith(".ogg") ? "audio/intro.ogg" : "audio/intro.wav";
      zip.file(finalAudioPath, audioData, { binary: true, compression: "STORE" });
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
          audioPath: actualAudio.endsWith(".ogg") ? "audio/intro.ogg" : "audio/intro.wav"
        },
        spritesheets: {
          frameWidth: frameW, frameHeight: frameH, columns: cols, rows: rows,
          framesPerSheet: capacity, format: imageFormat, totalFrames: entries.length, sheets: sheetMeta
        },
        note: "Los recursos ya están preparados. Minecraft no debe convertir vídeo ni audio; el reproductor consume las rutas y metadatos de este manifiesto."
      };
      config.runtime = {
        addonFormat: "mcaddon",
        visualPlayback: "Bedrock JSON UI aseprite_flip_book",
        soundEvent: "introaddon:cinematic_intro",
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
        header: { name: "IntroAddon Resources", description: "Recursos cinematográficos generados por IntroAddon Studio.", uuid: rpUuid, version: [1,0,0], min_engine_version: [1,21,0] },
        modules: [{ type: "resources", uuid: rpModuleUuid, version: [1,0,0] }]
      }, null, 2));
      bpZip.file("manifest.json", JSON.stringify({
        format_version: 2,
        header: { name: "IntroAddon Behavior", description: "Audio y configuración de IntroAddon.", uuid: bpUuid, version: [1,0,0], min_engine_version: [1,20,80] },
        modules: [
          { type: "data", uuid: bpDataUuid, version: [1,0,0] },
          { type: "script", language: "javascript", entry: "scripts/main.js", uuid: bpScriptUuid, version: [1,0,0] }
        ],
        dependencies: [{ uuid: rpUuid, version: [1,0,0] }, { module_name: "@minecraft/server", version: "1.13.0" }]
      }, null, 2));

      const uiAnimations = {};
      const uiControls = [];
      for (let i = 0; i < sheetMeta.length; i++) {
        const sheet = sheetMeta[i], n = i + 1;
        const texName = "spritesheet_" + String(n).padStart(3, "0");
        const animName = "sheet_" + n + "_uv";
        const startEvent = "introaddon_start_sheet_" + n;
        const nextEvent = n < sheetMeta.length ? "introaddon_start_sheet_" + (n + 1) : "introaddon_finish";
        const frames = [];
        for (let f = 0; f < sheet.frameCount; f++) {
          frames.push({
            filename: "frame_" + String((i * capacity) + f + 1).padStart(6, "0") + ".png",
            frame: { x: (f % cols) * frameW, y: Math.floor(f / cols) * frameH, w: frameW, h: frameH },
            rotated: false, trimmed: false,
            spriteSourceSize: { x: 0, y: 0, w: frameW, h: frameH },
            sourceSize: { w: frameW, h: frameH },
            duration: Math.max(1, Math.round(1000 / fps))
          });
        }
        const aseprite = {
          frames,
          meta: {
            app: "IntroAddon Studio", version: "1.0", image: texName + ".png", format: "RGBA8888",
            size: { w: frameW * cols, h: frameH * rows }, scale: "1",
            frameTags: [{ name: "intro", from: 0, to: sheet.frameCount - 1, direction: "forward" }],
            layers: [{ name: "Intro", opacity: 255, blendMode: "normal" }], slices: []
          }
        };
        const pngBytes = await zip.file(sheet.filename).async("uint8array");
        rpZip.file("textures/ui/intro/" + texName + ".png", pngBytes, { binary: true, compression: "STORE" });
        rpZip.file("textures/ui/intro/" + texName + ".json", JSON.stringify(aseprite, null, 2));
        uiAnimations[animName] = {
          anim_type: "aseprite_flip_book", initial_uv: [0, 0],
          ...(i > 0 ? { play_event: startEvent } : {}),
          end_event: nextEvent
        };
        const control = {
          type: "image", texture: "textures/ui/intro/" + texName,
          size: ["100%", "100%"], uv_size: [frameW, frameH],
          uv: "@introaddon." + animName, anchor_from: "center", anchor_to: "center",
          layer: 100 + n, disable_anim_fast_forward: true
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
      const introUi = { namespace: "introaddon", ...uiAnimations, overlay: { type: "panel", size: ["100%", "100%"], controls: uiControls } };
      rpZip.file("ui/intro_ui.json", JSON.stringify(introUi, null, 2));
      rpZip.file("ui/_ui_defs.json", JSON.stringify(["ui/hud_screen.json", "ui/intro_ui.json"], null, 2));
      rpZip.file("ui/hud_screen.json", JSON.stringify({
        namespace: "hud",
        root_panel: { modifications: [{ array_name: "controls", operation: "insert_front", value: { "introaddon_overlay@introaddon.overlay": {} } }] }
      }, null, 2));
      const audioPath = actualAudio.endsWith(".ogg") ? "sounds/intro.ogg" : "sounds/intro.wav";
      rpZip.file(audioPath, audioData, { binary: true, compression: "STORE" });
      rpZip.file("sounds/sound_definitions.json", JSON.stringify({
        "introaddon:cinematic_intro": { category: "music", sounds: [{ name: audioPath.replace(/\\.(ogg|wav)$/i, ""), volume: 1.0, pitch: 1.0 }] }
      }, null, 2));

      const scriptLines = [
        'import { world, system } from "@minecraft/server";',
        "const CONFIG = " + JSON.stringify(config) + ";",
        'const SOUND_ID = "introaddon:cinematic_intro";',
        "let groupSoundStarted = false;",
        "let groupWaitActive = false;",
        "function playIntroSound(player) { try { player.playSound(SOUND_ID, { volume: 1.0, pitch: 1.0 }); } catch (e) {} }",
        "world.afterEvents.playerSpawn.subscribe((event) => {",
        "  const player = event.player;",
        '  if (CONFIG.playback.replayPolicy !== "every_join" && !event.initialSpawn) return;',
        '  if (CONFIG.playback.mode === "per_player") { system.runTimeout(() => playIntroSound(player), 2); return; }',
        "  if (groupSoundStarted || groupWaitActive) return;",
        "  groupWaitActive = true;",
        "  const startedAt = system.currentTick;",
        "  const runId = system.runInterval(() => {",
        "    const players = world.getAllPlayers();",
        "    if (players.length >= CONFIG.playback.minimumPlayers) {",
        "      groupSoundStarted = true; groupWaitActive = false; system.clearRun(runId);",
        "      for (const p of players) playIntroSound(p);",
        "    } else if (system.currentTick - startedAt > 2400) { groupWaitActive = false; system.clearRun(runId); }",
        "  }, 20);",
        "});"
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
      const baseName = "IntroAddon_" + safeName(state.file.name.replace(/\\.[^.]+$/, ""));
      state.outputName = baseName + ".mcaddon";
      state.assetName = baseName + "_Resources.zip";
      setProgress(100, "Addon generado.");
      setStatus("Generado: addon .mcaddon con " + entries.length + " fotogramas, " + sheetMeta.length + " spritesheet(s), audio y configuración.", "success");
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
})();