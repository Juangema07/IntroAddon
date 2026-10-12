# IntroAddon Studio

Generador web para preparar una intro de Minecraft Bedrock desde un vídeo local. La web extrae fotogramas, crea spritesheets y extrae audio OGG; después genera un `.mcaddon` experimental y un ZIP de recursos/configuración.

## Funciones
- La web ya no ofrece el selector individual/grupal.
- Tras entrar el primer jugador, el addon abre un formulario dentro del mundo para elegir individual o grupal; el modo grupal pregunta cuántos jugadores deben estar presentes.
- Al cargar el vídeo, la web recomienda automáticamente dimensiones, FPS y distribución de spritesheets a partir de la resolución y duración del archivo.
- FFmpeg.wasm se ejecuta con el núcleo de un solo hilo para evitar la dependencia de SharedArrayBuffer.

## Funciones (detalle)

- Procesamiento en el navegador: el vídeo no se envía a un servidor de IntroAddon.
- FPS de extracción configurables: 12, 15, 20, 24, 30 y 60.
- Ancho y alto de cada fotograma configurables.
- Columnas y filas por spritesheet configurables; se generan varias hojas cuando hacen falta.
- Audio OGG para Bedrock.
- Generación de un `.mcaddon` con pack de recursos (UI, spritesheets, metadatos Aseprite y audio) y pack de comportamiento (evento de sonido y configuración).
- ZIP separado con spritesheets, audio y `introaddon_config.json`.

## Publicar con GitHub Pages

El repositorio incluye `.github/workflows/pages.yml`.

1. Abre **Settings → Pages**.
2. En **Build and deployment → Source**, selecciona **GitHub Actions**.
3. Ve a **Actions** y confirma que el flujo **Deploy IntroAddon Studio to GitHub Pages** termine correctamente.
4. La web se publicará en `https://juangema07.github.io/IntroAddon/`.

## Uso

1. Abre la web publicada en un navegador actualizado.
2. Selecciona el vídeo.
3. Revisa las recomendaciones automáticas de FPS, resolución y distribución de hojas; puedes ajustar los valores técnicos. El modo de reproducción se elige dentro del mundo.
4. Pulsa **Generar addon .mcaddon**.
5. Importa el `.mcaddon` en Minecraft Bedrock y activa ambos packs en el mundo.
6. Usa el ZIP separado si necesitas inspeccionar o reemplazar recursos y configuración.

## Límites conocidos de esta versión experimental

- Minecraft no convierte el vídeo: la web prepara los recursos y el addon los consume.
- El pack usa JSON UI `aseprite_flip_book` para animar los spritesheets. La modificación de `hud_screen` debe probarse en la versión exacta de Bedrock usada en Android y Windows.
- El menú dentro del mundo aparece al primer jugador y permite elegir individual o grupal; el modo grupal pregunta el mínimo de jugadores. En esta versión, la selección controla el audio, pero la UI visual aún empieza cuando carga el HUD de cada cliente. Por tanto, la sincronización visual grupal no está resuelta y debe probarse antes de considerar la función terminada.
- La política de repetición del script afecta al audio; la UI puede reiniciarse cuando el HUD se vuelva a cargar. Debe verificarse en juego antes de usarlo en un mundo principal.
- El spritesheet está limitado a 4096 px por lado para reducir problemas de compatibilidad y memoria.
- Si FFmpeg.wasm no puede codificar OGG o el vídeo no contiene audio, la generación se detiene con un error claro.
- La primera carga requiere conexión para descargar FFmpeg.wasm y JSZip desde CDN. FFmpeg usa el núcleo de un solo hilo para evitar depender de SharedArrayBuffer.

## Pruebas recomendadas

Primero prueba una intro corta, 12–15 FPS y fotogramas de 256×144 o 320×180. Confirma importación del addon, pantalla completa, orden de los fotogramas, sonido y cierre de la animación antes de probar vídeos largos o multijugador.
