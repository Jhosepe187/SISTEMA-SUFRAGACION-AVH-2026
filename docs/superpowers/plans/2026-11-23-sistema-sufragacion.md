# Sistema de Sufragación AVH v1 — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sitio de votación escolar con cédula animada, 2 mesas sincronizadas y conteo/reporte en Google Sheets.

**Architecture:** Sitio estático (HTML/CSS/JS en módulos ES) en `public/`, servido por Vercel. Un Google Apps Script (`apps-script/Code.gs`) vinculado a la hoja BD es la API: login con token, voto con deduplicación bajo bloqueo, y resultados. El frontend tiene un modo `MOCK` para probar todo en local sin Google.

**Tech Stack:** HTML5, CSS, JavaScript ES modules (sin framework ni build), Node 18+ `node --test` para pruebas de lógica, Google Apps Script, Vercel.

**Spec:** `docs/superpowers/specs/2026-11-23-sistema-sufragacion-design.md`

## Global Constraints

- IDs: BD `1OXnQwi6F4ywY156jGIaxQ8bwGCPmR2G1WbdiCAbvEAQ`, REPORTE `1LAR84myX-IEYsXUzv0SjwwNmk_1KWP9wceh-isf1iVM`.
- Usuario `adminAVH`; la contraseña vive **solo** en Script Properties de Apps Script (`ADMIN_USER`, `ADMIN_PASS`), nunca en el repositorio ni en el frontend. El `MOCK` usa `prueba`/`prueba`.
- Listas (claves fijas en todo el sistema): `UNESI` → "UNESI", `HUMBI` → "Humbi por siempre", `AVH` → "AVH Juntos por el cambio". Orden en la cédula: UNESI, HUMBI, AVH.
- `THANKS_MS = 8000`, `POLL_MS = 3000`, token válido 12 h.
- Textos de la cédula: "ELECCIÓN DEL MUNICIPIO ESCOLAR 2026", "I.E.P. ALEXANDER VON HUMBOLDT", "MARCA CON UNA X EL SÍMBOLO DE LA LISTA DE TU PREFERENCIA", "¡Gracias por votar!".
- Peticiones a Apps Script: `POST` con `Content-Type: text/plain;charset=utf-8` y cuerpo JSON `{action, ...}`; respuesta JSON `{ok:true, ...}` o `{ok:false, error:"..."}`.
- No hay repo git: no hay pasos de commit salvo que el usuario lo pida.

## Review Focus

1. Corte de internet a mitad de la votación → los votos quedan en cola y se envían al volver; el contador de pendientes es visible; nunca hay duplicados (Task 1, prueba `reintento no duplica`).
2. Doble clic o clic rápido en dos listas → solo un voto por ciclo de cédula (Task 4, verificación + bandera `locked`).
3. Token vencido mientras la mesa vota → el voto queda en cola y la mesa muestra "Sesión vencida" sin perder la cola (Task 1 prueba `auth detiene`, Task 5 lo muestra).
4. F5 o cierre accidental en modo cédula → vuelve a la cédula y la cola persiste (Task 5: `avh_mode` en `localStorage`).
5. Resultados con 0 votos → barras en 0 % sin dividir entre cero (Task 1, prueba `shares con total 0`).

---

## File Structure

```
public/
  index.html            pantallas: inicio, login, menu, cedula, gracias, resultados, modal-salir
  css/styles.css
  js/config.js          constantes + LISTAS + API_URL + MOCK
  js/logic.js           funciones puras: computeShares, VoteQueue
  js/api.js             createApi({url, mock}) → {login, vote, results}
  js/ballot.js          render de cédula, brillo, lápiz, bloqueo
  js/results-view.js    barras por lista, gráfico global, polling
  js/app.js             router de pantallas, sesión, estación, arranque
  assets/inicio.webp, unesi.webp, humbi.webp, avh.webp
apps-script/
  Code.gs               API
  INSTALACION.md        guía paso a paso para el usuario
tests/
  logic.test.mjs
  apps-script.test.mjs
vercel.json             {"outputDirectory": "public"}
package.json            {"type":"module","scripts":{"test":"node --test tests/"}}
README.md               cómo correr en local, desplegar, enlace a spec/plan
```

---

### Task 1: Lógica pura (porcentajes + cola de votos)

**Files:** Create `public/js/config.js`, `public/js/logic.js`, `tests/logic.test.mjs`, `package.json`

**Interfaces:**
- Produces:
  - `config.js`: `export const LISTAS = [{key:'UNESI', nombre:'UNESI', logo:'assets/unesi.webp'}, {key:'HUMBI', nombre:'Humbi por siempre', logo:'assets/humbi.webp'}, {key:'AVH', nombre:'AVH Juntos por el cambio', logo:'assets/avh.webp'}]`, `THANKS_MS`, `POLL_MS`, `API_URL` (string, vacío por defecto), `MOCK` (boolean: `true` si `API_URL===''` o la URL trae `?mock=1`; seguro en Node, donde no hay `location`).
  - `computeShares(counts: {UNESI,HUMBI,AVH}) → {total:number, items:[{key, votos, pct}]}`; `pct` con 1 decimal, 0 si el total es 0.
  - `class VoteQueue(storage, sendFn)`: `storage` con `getItem/setItem`; `sendFn(vote) → Promise<{ok, error?}>`.
    - `enqueue(lista, estacion) → vote` (`{vote_id, lista, estacion, ts}`, con `vote_id` vía `crypto.randomUUID()`), persiste en la clave `avh_queue`.
    - `pending() → number`.
    - `flush() → Promise<{sent, failed, authError:boolean}>`: envía en orden; saca de la cola solo con `ok:true`; con `error==='auth'` se detiene y devuelve `authError:true`; con una excepción de red se detiene. No permite dos flush simultáneos (si ya hay uno en curso, devuelve el mismo Promise).

- [ ] **Step 1: Write the failing tests** en `tests/logic.test.mjs`:
  - `shares con total 0`: `computeShares({UNESI:0,HUMBI:0,AVH:0})` → `total 0`, todos los `pct === 0`.
  - `shares normal`: `{UNESI:90,HUMBI:60,AVH:30}` → `total 180`, pct `50, 33.3, 16.7`.
  - `enqueue persiste`: fake storage; tras `enqueue('UNESI','Mesa 1')`, una nueva `VoteQueue` sobre el mismo storage tiene `pending()===1`.
  - `flush exitoso vacía`: con `sendFn` que devuelve `{ok:true}` → `pending()===0`, `sent===1`.
  - `red caída conserva`: `sendFn` lanza un error → `pending()===1`, `failed>=1`.
  - `reintento no duplica`: el primer flush falla y el segundo funciona → `sendFn` recibió el mismo `vote_id` las dos veces.
  - `auth detiene`: `sendFn` devuelve `{ok:false,error:'auth'}` → `authError===true`, `pending()===1`.
- [ ] **Step 2:** `npm test` → FAIL (módulo inexistente).
- [ ] **Step 3:** Implementar `config.js` y `logic.js`.
- [ ] **Step 4:** `npm test` → 7 pass.

### Task 2: API en Apps Script

**Files:** Create `apps-script/Code.gs`, `apps-script/INSTALACION.md`, `tests/apps-script.test.mjs`

**Interfaces:**
- Produces: `doPost(e)` con las acciones:
  - `login {user, pass}` → `{ok, token}` / `{ok:false, error:'credenciales'}`.
  - `vote {token, lista, vote_id, estacion}` → `{ok, counts, duplicate:boolean}`; `error:'auth'` si el token es inválido, `error:'lista'` si la clave no existe.
  - `results {token}` → `{ok, counts:{UNESI,HUMBI,AVH}, updatedAt}`.
  - `doGet` → `{ok:true, service:'AVH votos'}`.
- Detalles fijados:
  - Token: `Utilities.getUuid()`, guardado en Script Properties como `tok_<token>` = vencimiento (epoch ms, +12 h). Se cachea en CacheService (21600 s, el máximo) para no leer Properties en cada consulta. Al hacer login se borran los tokens vencidos.
  - Deduplicación: `vote_id` en CacheService (`vid_<id>`, 21600 s); si no está en cache, se busca en la columna D de las últimas 500 filas de `Votos`.
  - `LockService.getScriptLock().waitLock(20000)` alrededor de la escritura del voto.
  - Voto: append a `Votos` [`new Date()`, estacion, lista, vote_id] → incrementar la fila en `Conteo` → `writeReport(counts)`.
  - `setup()` (función que se ejecuta a mano): crea las hojas `Votos` (`Fecha | Mesa | Lista | ID`) y `Conteo` (3 filas en 0) en BD, y la pestaña `Resumen` en REPORTE, si no existen.
  - `writeReport(counts)`: REPORTE/`Resumen` con `Lista | Votos | %`, una fila por lista con su nombre completo, una fila `Total` y una fila `Última actualización`.
  - La lógica pura (`isValidLista`, `applyVote(counts, lista)`) va en funciones sin dependencias de Google.
- [ ] **Step 1: Write the failing tests** en `tests/apps-script.test.mjs`: cargar `Code.gs` con `vm.runInNewContext` usando stubs en memoria de `SpreadsheetApp`, `CacheService`, `PropertiesService`, `LockService`, `Utilities`, `ContentService`. Pruebas:
  - `login correcto devuelve token`, `login incorrecto → credenciales`.
  - `vote sin token → auth`.
  - `vote lista inválida → lista`.
  - `vote válido incrementa conteo y escribe fila`.
  - `mismo vote_id dos veces → duplicate:true y el conteo sube solo una vez`.
  - `results devuelve counts`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementar `Code.gs`.
- [ ] **Step 4:** `npm test` → todo pass.
- [ ] **Step 5:** `INSTALACION.md`: hoja BD → Extensiones → Apps Script → pegar `Code.gs` → Configuración del proyecto → Propiedades del script `ADMIN_USER`, `ADMIN_PASS` → ejecutar `setup` (autorizar) → Implementar → Nueva implementación → Aplicación web, ejecutar como "Yo", acceso "Cualquier usuario" → copiar la URL a `API_URL` en `public/js/config.js`. Incluir también cómo reiniciar la elección (borrar las filas de `Votos` y poner `Conteo` en 0).

### Task 3: Cliente API + assets

**Files:** Create `public/js/api.js`, `public/assets/*.webp`, `vercel.json`

**Interfaces:**
- Consumes: `API_URL`, `MOCK`.
- Produces: `createApi({url, mock}) → {login(user,pass), vote(token, vote), results(token)}`, todas `Promise<{ok, ...}>`. El modo real usa `fetch` POST text/plain y convierte las excepciones de red en un `throw` (VoteQueue las trata como red caída). El mock guarda los conteos en `localStorage` (`avh_mock_counts`) y los ids en `avh_mock_ids`, acepta `prueba`/`prueba`, agrega 300 ms de latencia y deduplica por `vote_id`. Así 2 pestañas simulan las 2 mesas.
- [ ] **Step 1:** Rasterizar los SVG a WebP (Chrome headless `--screenshot` o una herramienta disponible; `qlmanage` deja `avh` en blanco): logos a 600×600 con fondo transparente, portada a 1920×1080, cada uno de menos de 300 KB. Revisar cada imagen con Read.
- [ ] **Step 2:** Implementar `api.js` y `vercel.json`.
- [ ] **Step 3:** Prueba `mock login + vote + results` en `tests/logic.test.mjs` (con fake `localStorage` global) → los counts suben en 1 y el login incorrecto falla. `npm test` pass.

### Task 4: Cédula (brillo, lápiz 3D, gracias)

**Files:** Create `public/js/ballot.js`; Modify `public/index.html`, `public/css/styles.css`

**Interfaces:**
- Consumes: `LISTAS`, `THANKS_MS`.
- Produces: `mountBallot(rootEl, {onVote(listaKey)}) → {reset()}`. Llama a `onVote` una sola vez por ciclo, al terminar la X (~1,4 s); luego muestra "¡Gracias por votar!" durante `THANKS_MS` y llama a `reset()` sola.
- Comportamiento: encabezado de cédula con los textos de Global Constraints sobre papel blanco con borde; 3 recuadros (nombre arriba, logo en un recuadro marcable). Hover/focus: `drop-shadow` brillante animado + `scale(1.04)`. Clic → `locked=true` (ignora otros clics) → un lápiz SVG (cuerpo amarillo con caras sombreadas, punta de madera, mina, virola metálica, goma, sombra proyectada) inclinado en perspectiva recorre los dos trazos de la X mientras dos `<path>` grafito se dibujan con `stroke-dashoffset`. Con `prefers-reduced-motion`, la X aparece sin animación. Operable con teclado (Tab + Enter).
- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** Verificar en el navegador (mock): el hover brilla; el clic dibuja la X con el lápiz → gracias 8 s → cédula limpia; un doble clic rápido o un clic en otra lista cuenta un solo voto (revisar `avh_mock_counts`).

### Task 5: Pantallas, sesión y sincronización

**Files:** Create `public/js/app.js`, `public/js/results-view.js`; Modify `public/index.html`, `public/css/styles.css`

**Interfaces:**
- Consumes: `createApi`, `VoteQueue`, `computeShares`, `mountBallot`, `LISTAS`, `POLL_MS`.
- Produces: `mountResults(rootEl, {fetchCounts: () => Promise<{ok,counts}>}) → {start(), stop()}`.
- `app.js`:
  - `localStorage`: `avh_token`, `avh_mode` (`'menu'|'cedula'|'resultados'`), `avh_estacion`.
  - Arranque: con token → restaurar `avh_mode`; sin token → inicio.
  - Tras el primer login sin estación → selector "Mesa 1 / Mesa 2".
  - `onVote` → `queue.enqueue(lista, estacion)` + `queue.flush()` en segundo plano. Reintento cada 5 s y en el evento `online`. Indicador "N votos por sincronizar" mientras `pending()>0`. Con `authError` → banner "Sesión vencida — un responsable debe reingresar" (la cédula sigue funcionando y encolando; el banner abre el login y al acertar reanuda el flush).
  - "Salir" (esquina, discreto) → modal de login → si es correcto, va al menú; si no, muestra un error y se queda en la cédula.
  - Menú: "Iniciar votación", "Ver resultados", "Cerrar sesión" (borra el token, conserva la cola).
- `results-view.js`: tarjetas por lista (logo, barra animada, votos, %), un total grande, el botón "Gráfico global" que alterna con un gráfico de barras verticales comparativo (valores y %), y el texto "Actualizado hace Xs". Polling con `POLL_MS`; con un error se mantienen los últimos datos y se muestra "sin conexión".
- [ ] **Step 1:** Implementar.
- [ ] **Step 2:** Verificar en el navegador (mock): inicio → login incorrecto (error) → correcto → mesa → 3 votos → salir (login) → resultados = 3 → gráfico global → total 3. Una segunda pestaña en resultados se actualiza en ≤ 3 s. F5 en la cédula → vuelve a la cédula.
- [ ] **Step 3:** Viewports 1366×768 y 1920×1080: la cédula cabe sin scroll.

### Task 6: README y verificación final

**Files:** Create `README.md`

- [ ] **Step 1:** README: qué es, cómo correr en local (`python3 -m http.server -d public 8080`, con `?mock=1`), cómo conectar Google (→ `apps-script/INSTALACION.md`), cómo desplegar en Vercel (importar la carpeta, framework "Other"; `vercel.json` apunta a `public`), y enlaces a la spec y al plan.
- [ ] **Step 2:** `npm test` → todo pass; repetir la verificación de Task 5 Step 2.
