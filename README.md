# Coordinación de instalación deportiva · versión gratuita

Aplicación web que funciona **100 % en el navegador**: no necesita servidor, base de datos ni IA de pago.
Se publica gratis con GitHub Pages y los datos se guardan en el propio dispositivo (IndexedDB).

## Qué incluye
- Secciones y subsecciones ilimitadas.
- Registros (tareas, incidencias, personal, notas) con estado, fecha y responsable.
- Documentos: Word, Excel, CSV y texto (se leen sin conexión); PDF con texto (pdf.js) y fotos (OCR con Tesseract.js, calidad según la imagen).
- Buscador y asistente por palabras clave: muestra las filas y fragmentos más relevantes citando la fuente. **No usa IA.**
- Copia de seguridad (descargar / restaurar un archivo .json).

## Publicarla gratis en GitHub Pages
1. Crea una cuenta en github.com y un repositorio **público** nuevo (los Pages gratuitos requieren repositorio público; tus datos NO se suben, solo el código).
2. Sube todos los archivos de esta carpeta a la raíz del repositorio (botón *Add file → Upload files*, o con git).
3. En el repositorio: *Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main, carpeta /(root) → Save*.
4. Tras 1–2 minutos aparecerá la dirección `https://TU_USUARIO.github.io/NOMBRE_REPO/`. Ábrela desde el móvil y usa *Añadir a pantalla de inicio*.

## Probar en local
```
python3 -m http.server 3000
```
y abre http://localhost:3000 (o cualquier servidor de archivos estáticos).

## Límites de esta versión
- Los datos viven en cada dispositivo/navegador: no se sincronizan entre móvil y ordenador (usa la copia de seguridad para pasarlos).
- Si borras los datos del navegador se pierden: descarga copias periódicas.
- Sin IA: las preguntas funcionan mejor con palabras clave («natación lunes») que con frases largas.
- PDF y fotos necesitan internet la primera vez para cargar sus componentes gratuitos; los PDF escaneados no se leen como PDF (súbelos como imagen).
- Cualquiera que conozca la dirección puede abrir la aplicación, pero solo verá sus propios datos (vacíos). No guardes aquí datos que requieran control de acceso entre personas.

## Pasar a la versión con servidor e IA
La carpeta `instalacion-app` (entregada aparte) añade usuarios, datos compartidos y chat con IA real (requiere alojamiento y clave de API de pago).
