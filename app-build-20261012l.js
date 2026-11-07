
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
    const round16 = n => Math.max(16, Math.min(1024, Math.round((n * scale) / 16) * 16));
    const w = round16(state.sourceWidth), h = round16(state.sourceHeight);
    $("frameWidth").value = String(w); $("frameHeight").value = String(h);
    const maxCols = Math.max(1, Math.floor(4096 / w));
    const maxRows = Math.max(1, Math.floor(4096 / h));
    const targetFrames = Math.max(1, Math.ceil(fps * Math.min(duration || 2, 2)));
    const cols = 4;
    const rows = 1;
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
    log("Versión de procesamiento: IntroAddon V2 · cuatro fotogramas por hoja + audio OGG · build 2026-10-13-b");
    $("progressWrap").classList.remove("hidden");
    $("downloadAgain").classList.add("hidden");
    let ff;
    const tempFiles = [];
    try {
      const fps = readNumber("fps", 1, 60);
      const frameW = readNumber("frameWidth", 16, 4096);
      const frameH = readNumber("frameHeight", 16, 4096);
      const cols = 4;
      const rows = 1;
      const capacity = 4;
      if (frameW > 1024 || frameH > 4096) throw new Error("Con cuatro fotogramas por hoja, el ancho máximo por fotograma es 1024 px.");
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
      if (maxCols < 4 || maxRows < 1) throw new Error("Se necesitan cuatro fotogramas horizontales dentro del límite de 4096 px. Reduce el ancho por fotograma.");
      // Formato idéntico al addon funcional: cuatro fotogramas por spritesheet.
      const sheetCapacity = 4;
      const sheetCount = Math.ceil(batch.length / sheetCapacity);
      log("Extracción completada: " + batch.length + " fotogramas. Se crearán " + sheetCount + " spritesheets V2 de cuatro fotogramas.");
      for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex++) {
        const first = sheetIndex * sheetCapacity;
        const sheetBatch = batch.slice(first, first + sheetCapacity);
        const canvas = document.createElement("canvas");
        canvas.width = frameW * sheetBatch.length; canvas.height = frameH;
        if (canvas.width > 4096 || canvas.height > 4096) throw new Error("La tira horizontal excede 4096 × 4096 px; reduce el ancho del fotograma.");
        const ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) throw new Error("No se pudo crear la tira de fotogramas.");
        for (let localIndex = 0; localIndex < sheetBatch.length; localIndex++) {
          const name = sheetBatch[localIndex], globalIndex = first + localIndex;
          let img;
          try {
            img = await createImageBitmap(new Blob([ff.FS("readFile", name)], { type: "image/jpeg" }));
            ctx.drawImage(img, localIndex * frameW, 0, frameW, frameH);
          } finally {
            if (img && img.close) img.close();
            try { ff.FS("unlink", name); } catch (_) {}
          }
          totalFrames++;
          if ((globalIndex + 1) % 30 === 0 || globalIndex + 1 === batch.length) {
            setProgress(68 + ((globalIndex + 1) / batch.length) * 14, "Construyendo tiras · " + (globalIndex + 1) + " de " + batch.length + " fotogramas…");
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
        const blob = await new Promise((resolve, reject) => canvas.toBlob(v => v ? resolve(v) : reject(new Error("No se pudo codificar la tira PNG.")), "image/png"));
        const filename = "video/spritesheet_" + String(sheetIndex + 1).padStart(3, "0") + ".png";
        zip.file(filename, blob, { compression: "STORE" });
        sheetMeta.push({ filename, width: canvas.width, height: canvas.height, frameCount: sheetBatch.length, columns: 4, rows: 1 });
        canvas.width = 1; canvas.height = 1;
        log("Tira " + (sheetIndex + 1) + "/" + sheetCount + " lista (" + sheetBatch.length + " fotogramas útiles; hoja normalizada a cuatro posiciones).");
      }
      if (!totalFrames) throw new Error("FFmpeg no generó fotogramas. Prueba con otro vídeo MP4 o revisa su códec.");
      setProgress(82, "Tiras de animación preparadas…");

      const config = {
        schemaVersion: 2,
        project: "IntroAddon",
        createdAt: new Date().toISOString(),
        source: { name: state.file.name, durationSeconds: duration, fps, extractedFrames: totalFrames },
        playback: { targetPlatforms: ["Android", "Windows"], durationSeconds: duration, fps, audioPath: "audio/intro.ogg" },
        spritesheets: { frameWidth: frameW, frameHeight: frameH, columns: 4, rows: 1, framesPerSheet: 4, format: "png", totalFrames, sheets: sheetMeta },
        runtime: { addonFormat: "mcaddon", visualPlayback: "Bedrock JSON UI con cuatro recortes UV por spritesheet y títulos IA###F#", soundEvent: "introaddon:cinematic_intro" }
      };
      zip.file("introaddon_config.json", JSON.stringify(config, null, 2));
      zip.file("README.txt", "IntroAddon V2 - recursos preparados\\n\\nActiva ambos packs. La animación usa títulos IA###F# y cuatro fotogramas por spritesheet.\\n");

      setProgress(86, "Construyendo los packs compatibles con IntroAddon V2…");
      const rpUuid = makeUuid(), rpModuleUuid = makeUuid(), bpUuid = makeUuid(), bpDataUuid = makeUuid(), bpScriptUuid = makeUuid();
      const rpZip = new JSZip(), bpZip = new JSZip();
      const version = [1, 0, 1];
      rpZip.file("manifest.json", JSON.stringify({
        format_version: 2,
        header: { name: "IntroAddon Resources", description: "Recursos cinematográficos generados por IntroAddon Studio.", uuid: rpUuid, version, min_engine_version: [1, 26, 50] },
        modules: [{ type: "resources", uuid: rpModuleUuid, version }]
      }, null, 2));
      bpZip.file("manifest.json", JSON.stringify({
        format_version: 2,
        header: { name: "IntroAddon Behavior", description: "Audio y configuración de IntroAddon.", uuid: bpUuid, version, min_engine_version: [1, 26, 50] },
        modules: [
          { type: "data", uuid: bpDataUuid, version },
          { type: "script", language: "javascript", entry: "scripts/main.js", uuid: bpScriptUuid, version }
        ],
        dependencies: [
          { uuid: rpUuid, version },
          { module_name: "@minecraft/server", version: "2.10.0" },
          { module_name: "@minecraft/server-ui", version: "2.1.0" }
        ]
      }, null, 2));

      // La UI de la versión funcional identifica la hoja y el fotograma desde el título del HUD.
      const introControls = [];
      introControls.push({ black_background: { type: "image", texture: "textures/ui/intro/black", size: ["100%", "100%"], keep_ratio: false, anchor_from: "center", anchor_to: "center", layer: 1000001 } });
      for (let frame = 0; frame < 4; frame++) {
        introControls.push({ ["f" + frame]: {
          type: "image", size: ["100%", "100%"], keep_ratio: true,
          anchor_from: "center", anchor_to: "center",
          texture: "#texture", uv: [frame * frameW, 0], uv_size: [frameW, frameH],
          layer: 1000003, disable_anim_fast_forward: true,
          bindings: [
            { binding_name: "#hud_title_text_string" },
            { binding_type: "view", source_property_name: "('textures/ui/intro/spritesheet_' + (#hud_title_text_string - 'IA' - 'F0' - 'F1' - 'F2' - 'F3' - 'F9'))", target_property_name: "#texture" },
            { binding_type: "view", source_property_name: "(not ((#hud_title_text_string - 'F" + frame + "') = #hud_title_text_string))", target_property_name: "#visible" }
          ]
        }});
      }
      rpZip.file("textures/ui/intro/black.png", await new Promise((resolve, reject) => {
        const c = document.createElement("canvas"); c.width = 1; c.height = 1;
        const cx = c.getContext("2d", { alpha: false });
        if (!cx) return reject(new Error("No se pudo crear el fondo negro."));
        cx.fillStyle = "#000000"; cx.fillRect(0, 0, 1, 1);
        c.toBlob(blob => blob ? resolve(blob) : reject(new Error("No se pudo codificar el fondo negro.")), "image/png");
      }), { compression: "STORE" });
      for (let i = 0; i < sheetMeta.length; i++) {
        const sheet = sheetMeta[i];
        const pngBytes = await zip.file(sheet.filename).async("uint8array");
        rpZip.file("textures/ui/intro/spritesheet_" + String(i + 1).padStart(3, "0") + ".png", pngBytes, { binary: true, compression: "STORE" });
      }
      rpZip.file("ui/_ui_defs.json", JSON.stringify({ ui_defs: ["ui/hud_screen.json", "ui/intro_ui.json"] }, null, 2));
      rpZip.file("ui/hud_screen.json", JSON.stringify({
        namespace: "hud",
        root_panel: { modifications: [{ array_name: "controls", operation: "insert_front", value: { "introaddon_overlay@introaddon.overlay": { layer: 1000000 } } }] }
      }, null, 2));
      rpZip.file("ui/intro_ui.json", JSON.stringify({
        namespace: "introaddon",
        overlay: {
          type: "panel", size: ["100%", "100%"], layer: 1000000,
          bindings: [
            { binding_name: "#hud_title_text_string" },
            { binding_type: "view", source_property_name: "(not ((#hud_title_text_string - 'IA') = #hud_title_text_string))", target_property_name: "#visible" }
          ],
          controls: introControls
        }
      }, null, 2));
      rpZip.file("sounds/intro.ogg", audioData, { binary: true, compression: "STORE" });
      rpZip.file("sounds/sound_definitions.json", JSON.stringify({
        format_version: "1.20.20",
        sound_definitions: {
          "introaddon:cinematic_intro": {
            category: "music",
            sounds: [{ name: "sounds/intro", stream: true, volume: 1, load_on_low_memory: true, is3D: false, allow_concurrent_streaming: true }]
          }
        }
      }, null, 2));

      const scriptSource = `import { world, system, HudVisibility, HudElement } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";

const SOUND_ID = "introaddon:cinematic_intro";
const FPS = __FPS__;
const TOTAL_FRAMES = __TOTAL_FRAMES__;
const FRAMES_PER_SHEET = 4;
const TOTAL_TICKS = Math.ceil(TOTAL_FRAMES * 20 / FPS) + 10;
const HIDDEN = [HudElement.TouchControls, HudElement.Hotbar, HudElement.Crosshair, HudElement.Health, HudElement.Hunger, HudElement.Armor, HudElement.ProgressBar, HudElement.AirBubbles, HudElement.HorseHealth, HudElement.StatusEffects, HudElement.ItemText, HudElement.PaperDoll, HudElement.ToolTips];

function getCfg() {
  return {
    configured: world.getDynamicProperty("ia_configured") === true,
    mode: world.getDynamicProperty("ia_mode") === "group_once" ? "group_once" : "per_player",
    volume: typeof world.getDynamicProperty("ia_volume") === "number" ? world.getDynamicProperty("ia_volume") : 1,
    min: typeof world.getDynamicProperty("ia_min") === "number" ? world.getDynamicProperty("ia_min") : 2,
  };
}
function saveCfg(mode, volume, min) {
  world.setDynamicProperty("ia_configured", true);
  world.setDynamicProperty("ia_mode", mode);
  world.setDynamicProperty("ia_volume", volume);
  world.setDynamicProperty("ia_min", min);
}

const playing = new Set();
let groupStarted = false;
let menuOpen = false;
function pad3(n) { return String(n).padStart(3, "0"); }

function startIntro(player) {
  if (playing.has(player.id)) return;
  playing.add(player.id);
  const cfg = getCfg();
  const opts = { fadeInDuration: 0, stayDuration: 30, fadeOutDuration: 0 };
  try { player.onScreenDisplay.setHudVisibility(HudVisibility.Hide, HIDDEN); } catch (e) {}
  try { player.onScreenDisplay.setTitle("IA000F9", opts); } catch (e) {}
  const startTick = system.currentTick + 10;
  let soundDone = false, last = -1;
  const id = system.runInterval(() => {
    let valid = true;
    try { valid = player.isValid; } catch (e) { valid = false; }
    if (!valid) { system.clearRun(id); playing.delete(player.id); return; }
    const t = system.currentTick - startTick;
    if (t < 0) return;
    if (!soundDone) {
      soundDone = true;
      try { player.playSound(SOUND_ID, { volume: cfg.volume, pitch: 1.0 }); }
      catch (e) { try { player.runCommand("playsound " + SOUND_ID + " @s ~ ~ ~ " + cfg.volume + " 1"); } catch (e2) {} }
    }
    const frame = Math.floor(t * FPS / 20);
    if (frame >= TOTAL_FRAMES) {
      system.clearRun(id); playing.delete(player.id);
      try { player.onScreenDisplay.clearTitle(); } catch (e) {}
      try { player.onScreenDisplay.setHudVisibility(HudVisibility.Reset, HIDDEN); } catch (e) {}
      return;
    }
    if (frame === last) return;
    last = frame;
    const sheet = Math.floor(frame / FRAMES_PER_SHEET) + 1;
    const k = frame % FRAMES_PER_SHEET;
    try { player.onScreenDisplay.setTitle("IA" + pad3(sheet) + "F" + k, opts); } catch (e) {}
  }, 1);
}

function startGroupWatcher() {
  if (groupStarted) return;
  const id = system.runInterval(() => {
    const cfg = getCfg();
    if (world.getAllPlayers().length >= cfg.min) {
      system.clearRun(id); groupStarted = true;
      system.runTimeout(() => { for (const p of world.getAllPlayers()) startIntro(p); }, 40);
    }
  }, 20);
}

function showMenu(player, tries = 0) {
  if (menuOpen) return;
  menuOpen = true;
  const cfg = getCfg();
  const form = new ModalFormData()
    .title("IntroAddon - configuración")
    .dropdown("Modo de reproducción", ["Individual - cada jugador al entrar", "Grupal - esperar al grupo"], { defaultValueIndex: cfg.mode === "group_once" ? 1 : 0 })
    .slider("Volumen de audio (%)", 0, 100, { valueStep: 5, defaultValue: Math.round(cfg.volume * 100) })
    .slider("Jugadores necesarios (modo grupal)", 1, 20, { valueStep: 1, defaultValue: cfg.min })
    .submitButton("Guardar y reproducir");
  form.show(player).then((res) => {
    menuOpen = false;
    if (res.canceled) {
      if (res.cancelationReason === "UserBusy" && tries < 60) {
        system.runTimeout(() => { if (player.isValid) showMenu(player, tries + 1); }, 40);
        return;
      }
      if (!cfg.configured) saveCfg("per_player", 1, 2);
    } else {
      const mode = Number(res.formValues[0]) === 1 ? "group_once" : "per_player";
      saveCfg(mode, Math.max(0, Math.min(1, Number(res.formValues[1]) / 100)), Math.max(1, Math.floor(Number(res.formValues[2]) || 2)));
    }
    afterConfig(player);
  }).catch((e) => {
    menuOpen = false;
    try { player.sendMessage("§cIntroAddon: error en el menú: " + String(e)); } catch (_) {}
    if (tries < 5) system.runTimeout(() => { if (player.isValid) showMenu(player, tries + 1); }, 60);
    else { if (!getCfg().configured) saveCfg("per_player", 1, 2); afterConfig(player); }
  });
}
function afterConfig(player) {
  const cfg = getCfg();
  if (cfg.mode === "per_player") system.runTimeout(() => startIntro(player), 20);
  else startGroupWatcher();
}
world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn) return;
  const player = ev.player;
  system.runTimeout(() => {
    if (!player.isValid) return;
    const cfg = getCfg();
    if (!cfg.configured) showMenu(player);
    else if (cfg.mode === "per_player") startIntro(player);
    else startGroupWatcher();
  }, 60);
});
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  const p = ev.sourceEntity;
  if (!p || p.typeId !== "minecraft:player") return;
  if (ev.id === "introaddon:menu") showMenu(p);
  else if (ev.id === "introaddon:play") startIntro(p);
});
`.replace("__FPS__", String(fps)).replace("__TOTAL_FRAMES__", String(totalFrames));
      bpZip.file("scripts/main.js", scriptSource);
      bpZip.file("README.txt", "Activa BP y RP. /scriptevent introaddon:menu = ajustes; introaddon:play = repetir intro.\\n");
      bpZip.file("introaddon_config.json", JSON.stringify(config, null, 2));
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