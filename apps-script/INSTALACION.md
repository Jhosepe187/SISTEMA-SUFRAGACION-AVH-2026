# Conectar el sistema con Google Sheets

Se hace **una sola vez**, con la cuenta de Google dueña de las dos hojas (BD simple y REPORTE). Toma unos 10 minutos.

## 1. Pegar el código

1. Abre la hoja **BD simple**.
2. Menú **Extensiones → Apps Script**.
3. Borra lo que haya en `Código.gs` y pega todo el contenido de [`Code.gs`](Code.gs).
4. Guarda (ícono de disquete o `Ctrl/Cmd + S`). Ponle de nombre al proyecto "Votación AVH".

## 2. Guardar el usuario y la contraseña (no van en el sitio web)

1. En Apps Script, abre el engranaje **Configuración del proyecto** (barra izquierda).
2. Baja hasta **Propiedades del script** → **Agregar propiedad del script**:
   - `ADMIN_USER` = `adminAVH`
   - `ADMIN_PASS` = la contraseña acordada por el comité (no la escribas en ningún archivo del repositorio)
3. Pulsa **Guardar propiedades del script**.

> Para cambiar la contraseña en el futuro, solo cambia `ADMIN_PASS` aquí. No hay que tocar el sitio.

## 3. Preparar las hojas (opcional)

> La API crea sola las pestañas `Votos`, `Conteo` y `Resumen` en la primera petición. Ejecutar `setup` sirve sobre todo para **autorizar** el script la primera vez.

1. Vuelve al editor (`<>` en la barra izquierda).
2. En la lista de funciones de arriba elige **`setup`** y pulsa **Ejecutar**.
3. Google pedirá permisos: **Revisar permisos** → tu cuenta → "Configuración avanzada" → "Ir a Votación AVH (no seguro)" → **Permitir**. (Sale "no seguro" porque el script es tuyo y no está verificado por Google; es normal.)
4. Revisa los resultados:
   - **BD simple** tiene ahora las pestañas `Votos` y `Conteo`.
   - **REPORTE** tiene la pestaña `Resumen`.

## 4. Publicar como aplicación web

1. Botón azul **Implementar → Nueva implementación**.
2. En el engranaje junto a "Seleccionar tipo", elige **Aplicación web**.
3. Configura:
   - **Ejecutar como:** Yo
   - **Quién tiene acceso:** Cualquier usuario
4. **Implementar** → copia la **URL de la aplicación web** (termina en `/exec`).
5. Pega esa URL en `public/js/config.js`:

   ```js
   export const API_URL = 'https://script.google.com/macros/s/XXXXXXXX/exec';
   ```

6. Vuelve a desplegar el sitio en Vercel (o recarga si lo pruebas en local).

Prueba rápida: si abres la URL `/exec` en el navegador, debe responder `{"ok":true,"service":"AVH votos"}`.

> **Si cambias `Code.gs` más adelante:** Implementar → **Administrar implementaciones** → lápiz ✏️ → Versión: **Nueva versión** → Implementar. Así la URL se mantiene igual.

## Reiniciar la elección (antes del día de votación)

Para borrar los votos de prueba: en Apps Script elige la función **`reiniciarEleccion`** → **Ejecutar**. **No se puede deshacer.** Hace lo siguiente:

- borra todas las filas de `Votos` y deja el conteo y el REPORTE en 0;
- **cierra la sesión de todas las PCs**: cada mesa debe volver a iniciar sesión;
- descarta los votos de ensayo que alguna PC todavía tenga "por sincronizar", para que no se sumen a la elección real.

Si alguien editó `Conteo` o el REPORTE a mano, ejecuta **`recontar`**: los reconstruye a partir de la hoja `Votos`.

## Qué guarda cada hoja

| Hoja | Pestaña | Contenido |
|---|---|---|
| BD simple | `Votos` | Una fila por voto: Fecha, Mesa, Lista, ID (único, evita duplicados) |
| BD simple | `Conteo` | Total por lista (vista; se recalcula desde `Votos` en cada voto) |
| REPORTE | `Resumen` | Lista, Votos, %, Total y hora de la última actualización |

La hoja **`Votos` es la fuente de verdad**: los resultados del sitio se cuentan directamente desde ella. No borres ni edites filas de `Votos` durante la votación.
