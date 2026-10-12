# IntroAddon

Generador web para preparar recursos y crear un .mcaddon experimental de intro cinematográfica para Minecraft Bedrock a partir de un vídeo. La web está pensada para GitHub Pages y procesa los archivos localmente en el navegador.

## Funciones de esta primera versión

- Cargar un vídeo local.
- Elegir FPS de extracción y dimensiones de cada fotograma.
- Elegir columnas y filas por spritesheet y crear varias hojas automáticamente.
- Extraer el audio del vídeo (OGG para Bedrock, con WAV como alternativa).
- Generar un .mcaddon con packs de recursos y comportamiento, además de un ZIP de recursos y metadatos.
- Definir modo de inicio individual o grupal, cantidad mínima de jugadores y comportamiento de reproducción.
- El procesamiento se ejecuta en el navegador; el vídeo no se sube a un servidor de IntroAddon.

## Publicar con GitHub Pages

1. En el repositorio, abre **Settings → Pages**.
2. En **Build and deployment**, elige **Deploy from a branch**.
3. Selecciona la rama `main` y la carpeta `/ (root)`.
4. Guarda y espera a que GitHub publique la web.

## Uso

Abre la web en un navegador actualizado, carga un vídeo y configura la salida. Pulsa **Generar paquete** y espera a que termine. El ZIP contiene recursos preparados y `introaddon_config.json`.

## Importante: límites de Bedrock

Este repositorio inicia el generador de recursos y la configuración portable. La creación de spritesheets/audio ocurre en la web, nunca dentro de Minecraft. El ZIP generado documenta la secuencia y la configuración para que el reproductor Bedrock pueda consumirlas.

Bedrock no reproduce un archivo de vídeo directamente ni descubre de forma universal archivos arbitrariamente renombrados. Para cambiar los nombres sin tocar código, el paquete incluye un manifiesto que registra las rutas reales de los recursos. La compatibilidad final de la capa de reproducción (especialmente la UI a pantalla completa y la coordinación de inicio multijugador) debe verificarse en las versiones objetivo de Bedrock para Android y Windows.

## Bibliotecas

- FFmpeg.wasm para extraer fotogramas y audio localmente.
- JSZip para empaquetar los resultados.

Las bibliotecas se cargan desde CDN, por lo que la primera carga requiere conexión a Internet.
