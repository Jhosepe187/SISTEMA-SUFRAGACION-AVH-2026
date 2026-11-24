import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// ---- Stubs en memoria de los servicios de Google ----
function makeSheet(name) {
  const rows = []; // array de arrays (fila 1 = rows[0])
  const sheet = {
    name,
    rows,
    getName: () => name,
    getLastRow: () => rows.length,
    appendRow: (r) => { rows.push([...r]); },
    clear: () => { rows.length = 0; },
    deleteRows: (r, n) => { rows.splice(r - 1, n); },
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => rows[r - 1 + i]?.[c - 1 + j] ?? '')),
      setValues: (vals) => vals.forEach((row, i) => row.forEach((v, j) => {
        while (rows.length < r + i) rows.push([]);
        rows[r - 1 + i][c - 1 + j] = v;
      })),
      setValue: (v) => { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; },
      setFontWeight: () => sheet.getRange(r, c, nr, nc),
      setNumberFormat: () => sheet.getRange(r, c, nr, nc),
    }),
    setFrozenRows: () => {},
    autoResizeColumns: () => {},
  };
  return sheet;
}
function makeSpreadsheet() {
  const sheets = {};
  return {
    sheets,
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n)),
  };
}
function makeCache() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), put: (k, v) => m.set(k, String(v)), remove: (k) => m.delete(k) };
}

function load({ runSetup = true } = {}) {
  const books = {};
  const opens = { n: 0 };
  const events = [];
  const clock = { t: 1_800_000_000_000 };
  class FakeDate extends Date { static now() { return clock.t; } }
  const props = new Map([['ADMIN_USER', 'adminAVH'], ['ADMIN_PASS', 'clave-prueba']]);
  const cache = makeCache();
  let n = 0;
  const ctx = {
    SpreadsheetApp: { openById: (id) => { opens.n++; return (books[id] ||= makeSpreadsheet()); }, flush: () => events.push('flush') },
    CacheService: { getScriptCache: () => cache },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v)),
        deleteProperty: (k) => props.delete(k),
        getKeys: () => [...props.keys()],
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock: () => events.push('lock'), releaseLock: () => events.push('release') }) },
    Utilities: { getUuid: () => 'uuid-' + ++n },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }),
    },
    Date: FakeDate,
    console,
    JSON,
    Math,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx);
  if (runSetup) ctx.setup();
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).content);
  return { ctx, books, post, events, clock, opens };
}

const BD = '1OXnQwi6F4ywY156jGIaxQ8bwGCPmR2G1WbdiCAbvEAQ';
const REP = '1LAR84myX-IEYsXUzv0SjwwNmk_1KWP9wceh-isf1iVM';

test('login correcto devuelve token', () => {
  const { post } = load();
  const r = post({ action: 'login', user: 'adminAVH', pass: 'clave-prueba' });
  assert.equal(r.ok, true);
  assert.ok(r.token);
});

test('login incorrecto → credenciales', () => {
  const { post } = load();
  const r = post({ action: 'login', user: 'adminAVH', pass: 'x' });
  assert.deepEqual(r, { ok: false, error: 'credenciales' });
});

test('vote sin token → auth', () => {
  const { post } = load();
  const r = post({ action: 'vote', token: 'nope', lista: 'UNESI', vote_id: 'a', estacion: 'Mesa 1' });
  assert.equal(r.error, 'auth');
});

test('vote lista inválida → lista', () => {
  const { post } = load();
  const { token } = post({ action: 'login', user: 'adminAVH', pass: 'clave-prueba' });
  const r = post({ action: 'vote', token, lista: 'OTRA', vote_id: 'a', estacion: 'Mesa 1' });
  assert.equal(r.error, 'lista');
});

test('vote válido incrementa conteo y escribe fila', () => {
  const { post, books } = load();
  const { token } = post({ action: 'login', user: 'adminAVH', pass: 'clave-prueba' });
  const r = post({ action: 'vote', token, lista: 'HUMBI', vote_id: 'v1', estacion: 'Mesa 2' });
  assert.equal(r.ok, true);
  assert.equal(r.duplicate, false);
  assert.equal(r.counts.HUMBI, 1);
  const votos = books[BD].sheets.Votos.rows;
  assert.equal(votos.length, 2); // encabezado + 1
  assert.deepEqual(votos[1].slice(1), ['Mesa 2', 'HUMBI', 'v1']);
  const resumen = books[REP].sheets.Resumen.rows;
  assert.ok(resumen.some((row) => row[0] === 'Humbi por siempre' && row[1] === 1));
  assert.ok(resumen.some((row) => row[0] === 'Total' && row[1] === 1));
});

test('mismo vote_id dos veces → duplicate:true y el conteo sube solo una vez', () => {
  const { post } = load();
  const { token } = post({ action: 'login', user: 'adminAVH', pass: 'clave-prueba' });
  post({ action: 'vote', token, lista: 'AVH', vote_id: 'dup', estacion: 'Mesa 1' });
  const r = post({ action: 'vote', token, lista: 'AVH', vote_id: 'dup', estacion: 'Mesa 1' });
  assert.equal(r.duplicate, true);
  assert.equal(r.counts.AVH, 1);
});

test('dedup funciona aunque se pierda el cache', () => {
  const { post, ctx } = load();
  const { token } = post({ action: 'login', user: 'adminAVH', pass: 'clave-prueba' });
  post({ action: 'vote', token, lista: 'AVH', vote_id: 'dup2', estacion: 'Mesa 1' });
  ctx.CacheService.getScriptCache().remove('vid_dup2');
  const r = post({ action: 'vote', token, lista: 'AVH', vote_id: 'dup2', estacion: 'Mesa 1' });
  assert.equal(r.duplicate, true);
  assert.equal(r.counts.AVH, 1);
});

test('results devuelve counts', () => {
  const { post } = load();
  const { token } = post({ action: 'login', user: 'adminAVH', pass: 'clave-prueba' });
  post({ action: 'vote', token, lista: 'UNESI', vote_id: 'r1', estacion: 'Mesa 1' });
  post({ action: 'vote', token, lista: 'UNESI', vote_id: 'r2', estacion: 'Mesa 2' });
  const r = post({ action: 'results', token });
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { UNESI: 2, HUMBI: 0, AVH: 0, BLANCO: 0 });
  assert.ok(r.updatedAt);
});

test('results sin token → auth', () => {
  const { post } = load();
  assert.equal(post({ action: 'results', token: '' }).error, 'auth');
});

const login = (post) => post({ action: 'login', user: 'adminAVH', pass: 'clave-prueba' });

test('conteo se deriva de Votos aunque Conteo esté desfasado', () => {
  const { post, books } = load();
  const { token } = login(post);
  books[BD].sheets.Conteo.getRange(2, 1, 3, 2).setValues([['UNESI', 50], ['HUMBI', 50], ['AVH', 50]]);
  const r = post({ action: 'vote', token, lista: 'HUMBI', vote_id: 'c1', estacion: 'Mesa 1' });
  assert.deepEqual(r.counts, { UNESI: 0, HUMBI: 1, AVH: 0, BLANCO: 0 });
  assert.deepEqual(post({ action: 'results', token }).counts, { UNESI: 0, HUMBI: 1, AVH: 0, BLANCO: 0 });
});

test('flush antes de liberar el lock', () => {
  const { post, events } = load();
  const { token } = login(post);
  events.length = 0;
  post({ action: 'vote', token, lista: 'UNESI', vote_id: 'f1', estacion: 'Mesa 1' });
  const i = events.lastIndexOf('release');
  assert.ok(i > 0 && events[i - 1] === 'flush', JSON.stringify(events));
});

test('reporte que falla no rompe el voto', () => {
  const { post, books } = load();
  const { token } = login(post);
  delete books[REP].sheets.Resumen;
  const r = post({ action: 'vote', token, lista: 'AVH', vote_id: 'rf1', estacion: 'Mesa 2' });
  assert.equal(r.ok, true);
  assert.equal(r.counts.AVH, 1);
});

test('reiniciar invalida sesiones viejas y votos anteriores al reinicio', () => {
  const { post, ctx, clock } = load();
  const old = login(post).token;
  const tsBefore = clock.t;
  clock.t += 1000;
  ctx.reiniciarEleccion();
  clock.t += 1000;
  assert.equal(post({ action: 'results', token: old }).error, 'auth');
  const { token } = login(post);
  assert.equal(post({ action: 'vote', token, lista: 'UNESI', vote_id: 'e1', estacion: 'Mesa 1', ts: tsBefore }).error, 'eleccion');
  const ok = post({ action: 'vote', token, lista: 'UNESI', vote_id: 'e2', estacion: 'Mesa 1', ts: clock.t });
  assert.equal(ok.ok, true);
  assert.equal(ok.counts.UNESI, 1);
});

test('mesa y vote_id inválidos se rechazan', () => {
  const { post } = load();
  const { token } = login(post);
  assert.equal(post({ action: 'vote', token, lista: 'UNESI', vote_id: 'x'.repeat(300), estacion: 'Mesa 1' }).error, 'vote_id');
  const r = post({ action: 'vote', token, lista: 'UNESI', vote_id: 'm1', estacion: '=HYPERLINK("x")' });
  assert.equal(r.ok, true);
});

test('login sin ADMIN_PASS configurada → sin_config', () => {
  const { post, ctx } = load();
  ctx.PropertiesService.getScriptProperties().deleteProperty('ADMIN_PASS');
  assert.equal(post({ action: 'login', user: 'adminAVH', pass: 'lo-que-sea' }).error, 'sin_config');
});

test('login tolera espacios y mayúsculas en el usuario', () => {
  const { post, ctx } = load();
  ctx.PropertiesService.getScriptProperties().setProperty('ADMIN_PASS', ' clave-prueba \n');
  assert.equal(post({ action: 'login', user: ' AdminAVH ', pass: 'clave-prueba ' }).ok, true);
});

test('crea las hojas solas si nadie ejecutó setup', () => {
  const { post, books } = load({ runSetup: false });
  const { token } = login(post);
  const r = post({ action: 'vote', token, lista: 'UNESI', vote_id: 's1', estacion: 'Mesa 1' });
  assert.equal(r.ok, true);
  assert.equal(r.counts.UNESI, 1);
  assert.equal(books[BD].sheets.Votos.rows.length, 2);
  assert.ok(books[REP].sheets.Resumen);
  assert.deepEqual(post({ action: 'results', token }).counts, { UNESI: 1, HUMBI: 0, AVH: 0, BLANCO: 0 });
});

test('results sin hojas creadas devuelve ceros (no error)', () => {
  const { post } = load({ runSetup: false });
  const { token } = login(post);
  const r = post({ action: 'results', token });
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { UNESI: 0, HUMBI: 0, AVH: 0, BLANCO: 0 });
});

test('results repetidos usan caché sin abrir la hoja', () => {
  const { post, opens } = load();
  const { token } = login(post);
  post({ action: 'vote', token, lista: 'AVH', vote_id: 'k1', estacion: 'Mesa 1' });
  opens.n = 0;
  const r = post({ action: 'results', token });
  assert.equal(r.counts.AVH, 1);
  assert.equal(opens.n, 0);
});

test('un voto abre cada libro una sola vez', () => {
  const { post, opens } = load();
  const { token } = login(post);
  opens.n = 0;
  post({ action: 'vote', token, lista: 'HUMBI', vote_id: 'o1', estacion: 'Mesa 1' });
  assert.ok(opens.n <= 2, 'openById llamado ' + opens.n + ' veces');
});

test('voto en blanco se registra, se cuenta y sale en el reporte', () => {
  const { post, books } = load();
  const { token } = login(post);
  const r = post({ action: 'vote', token, lista: 'BLANCO', vote_id: 'bl1', estacion: 'Mesa 1' });
  assert.equal(r.ok, true);
  assert.equal(r.counts.BLANCO, 1);
  assert.equal(books[BD].sheets.Votos.rows[1][2], 'BLANCO');
  const resumen = books[REP].sheets.Resumen.rows;
  assert.ok(resumen.some((row) => row[0] === 'Voto en blanco' && row[1] === 1));
  assert.ok(resumen.some((row) => row[0] === 'Total' && row[1] === 1));
});
