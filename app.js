
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const state = { file: null, previewUrl: null, ffmpeg: null, busy: false, outputBlob: null, assetBlob: null, outputName: "IntroAddon_Custom.mcaddon", assetName: "IntroAddon_Resources.zip", duration: 0, sourceWidth: 0, sourceHeight: 0 };
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
  const readNumber = (id, min, max) => {
    const n = Number($(id).value);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error($(id).previousElementSibling?.textContent + " debe estar entre " + min + " y " + max + ".");
    return Math.floor(n);
  };

  function acceptFile(file) {
    if (!file) return;
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
  $("videoFile").addEventListener("change", e => acceptFile(e.target.files[0]));
  const drop = $("dropzone");
  ["dragenter", "dragover"].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.remove("dragging"); }));
  drop.addEventListener("drop", e => acceptFile(e.dataTransfer.files[0]));

  async function getFFmpeg() {
    if (state.ffmpeg) return state.ffmpeg;
    if (!window.FFmpeg || typeof window.FFmpeg.createFFmpeg !== "function") {
      throw new Error("No se pudo cargar la biblioteca FFmpeg. Recarga la página y vuelve a intentarlo.");
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
      const capacity = cols * rows;
      if (frameW * cols > 4096 || frameH * rows > 4096) throw new Error("El spritesheet superaría 4096 px en uno de sus lados. Reduce la resolución, columnas o filas para mantener compatibilidad con Bedrock móvil.");
      if (frameW * frameH * capacity > 180000000) throw new Error("La hoja sería demasiado grande para un procesamiento seguro. Reduce la resolución, filas o columnas.");
      setStatus("Preparando el procesamiento…");
      ff = await getFFmpeg();
      const ext = (state.file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
      const inputName = "input." + ext;
      ff.FS("writeFile", inputName, await fileBytes(state.file));
      tempFiles.push(inputName);
      const imageFormat = "png";
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

      const audioFormat = "ogg";
      log("Extrayendo audio OGG…");
      const actualAudio = "intro_audio.ogg";
      try {
        await ff.run("-i", inputName, "-map", "0:a:0", "-vn", "-sn", "-dn", "-ac", "2", "-ar", "44100", "-c:a", "libvorbis", "-q:a", "5", "-f", "ogg", "-y", actualAudio);
      } catch (err) {
        const detail = (state.ffmpegMessages || []).slice(-8).join(" | ");
        throw new Error("Falló la extracción OGG. " + (detail ? "Detalle de FFmpeg: " + detail : "FFmpeg no devolvió el motivo; revisa si el códec de audio es compatible o si faltó memoria.") + " Comprueba que el vídeo tenga audio y vuelve a intentarlo.");
      }
      if (!ff.FS("readdir", "/").includes(actualAudio)) throw new Error("FFmpeg no generó el archivo de audio esperado.");
      const audioData = ff.FS("readFile", actualAudio);
      const finalAudioPath = actualAudio.endsWith(".ogg") ? "audio/intro.ogg" : "audio/intro.wav";
      zip.file(finalAudioPath, audioData, { binary: true, compression: "STORE" });
      tempFiles.push(actualAudio);
      setProgress(85, "Creando manifiesto y paquete…");

      const duration = state.duration || entries.length / fps;
      const config = {
        schemaVersion: 1,
        project: "IntroAddon",
        createdAt: new Date().toISOString(),
        source: { name: state.file.name, durationSeconds: duration, fps: fps, extractedFrames: entries.length },
        playback: {
          targetPlatforms: ["Android", "Windows"],
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
        header: { name: "IntroAddon Behavior", description: "Audio y configuración de IntroAddon.", uuid: bpUuid, version: [1,0,0], min_engine_version: [1,21,0] },
        modules: [
          { type: "data", uuid: bpDataUuid, version: [1,0,0] },
          { type: "script", language: "javascript", entry: "scripts/main.js", uuid: bpScriptUuid, version: [1,0,0] }
        ],
        dependencies: [
          { uuid: rpUuid, version: [1,0,0] },
          { module_name: "@minecraft/server", version: "1.13.0" },
          { module_name: "@minecraft/server-ui", version: "1.3.0" }
        ]
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
        "introaddon:cinematic_intro": { category: "music", sounds: [{ name: audioPath.replace(/\.(ogg|wav)$/i, ""), volume: 1.0, pitch: 1.0 }] }
      }, null, 2));

      const scriptLines = [
        'import { world, system } from "@minecraft/server";',
        'import { ActionFormData, ModalFormData } from "@minecraft/server-ui";',
        "const CONFIG = " + JSON.stringify(config) + ";",
        'const SOUND_ID = "introaddon:cinematic_intro";',
        'let menuShown = false;',
        'let modeSelected = false;',
        'let playbackMode = "per_player";',
        'let minimumPlayers = 2;',
        'let groupSoundStarted = false;',
        'function playIntroSound(player) { try { player.playSound(SOUND_ID, { volume: 1.0, pitch: 1.0 }); } catch (e) {} }',
        'async function showFirstPlayerMenu(player) {',
        '  if (menuShown) return;',
        '  menuShown = true;',
        '  try {',
        '    const form = new ActionFormData().title("IntroAddon").body("¿Cómo quieres reproducir la intro en este mundo?").button("Individual - cada jugador al entrar").button("Grupal - una intro para el grupo");',
        '    const result = await form.show(player);',
        '    if (result.canceled || result.selection === undefined) { menuShown = false; return; }',
        '    playbackMode = result.selection === 0 ? "per_player" : "group_once";',
        '    modeSelected = true;',
        '    if (playbackMode === "group_once") {',
        '      const settings = new ModalFormData().title("Intro grupal").slider("Jugadores necesarios para iniciar", 1, 20, { valueStep: 1, defaultValue: 2 });',
        '      const answer = await settings.show(player);',
        '      if (!answer.canceled && answer.formValues && Number.isFinite(answer.formValues[0])) minimumPlayers = Math.max(1, Math.floor(answer.formValues[0]));',
        '    }',
        '    player.sendMessage(playbackMode === "per_player" ? "§aIntroAddon: modo individual seleccionado." : "§aIntroAddon: modo grupal seleccionado. Jugadores necesarios: " + minimumPlayers);',
        '    if (playbackMode === "per_player") { playIntroSound(player); }',
        '    else { const runId = system.runInterval(() => { const players = world.getAllPlayers(); if (!groupSoundStarted && players.length >= minimumPlayers) { groupSoundStarted = true; system.clearRun(runId); for (const p of players) playIntroSound(p); } }, 20); }',
        '  } catch (e) { menuShown = false; try { player.sendMessage("IntroAddon: no se pudo abrir el menú. Comprueba que el pack de scripts esté activo."); } catch (_) {} }',
        '}',
        'world.afterEvents.playerSpawn.subscribe((event) => { if (!event.initialSpawn) return; const player = event.player; system.runTimeout(() => { if (!menuShown) showFirstPlayerMenu(player); else if (modeSelected && playbackMode === "per_player") playIntroSound(player); }, 1); });'
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