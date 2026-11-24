/**
 * Sistema de Sufragación AVH — API (Google Apps Script)
 * Vinculado a la hoja "BD simple". Guía: apps-script/INSTALACION.md
 *
 * Las hojas necesarias (Votos, Conteo, Resumen) se crean solas en la primera petición.
 */

var BD_ID = '1OXnQwi6F4ywY156jGIaxQ8bwGCPmR2G1WbdiCAbvEAQ';
var REPORTE_ID = '1LAR84myX-IEYsXUzv0SjwwNmk_1KWP9wceh-isf1iVM';

var LISTAS = [
  { key: 'UNESI', nombre: 'UNESI' },
  { key: 'HUMBI', nombre: 'Humbi por siempre' },
  { key: 'AVH', nombre: 'AVH Juntos por el cambio' },
  { key: 'BLANCO', nombre: 'Voto en blanco' }
];

var TOKEN_MS = 12 * 60 * 60 * 1000; // 12 horas
var CACHE_S = 21600; // máximo permitido por CacheService (6 h)
var COUNTS_CACHE_S = 120; // conteo en caché para responder resultados sin abrir la hoja
var MESAS = ['Mesa 1', 'Mesa 2', 'Mesa sin asignar'];
var VOTE_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

// ---------- Acceso a libros/hojas (una sola apertura por petición) ----------

var BOOKS_ = {};
function book_(id) {
  if (!BOOKS_[id]) BOOKS_[id] = SpreadsheetApp.openById(id);
  return BOOKS_[id];
}

/** Devuelve la hoja; si no existe la crea con su encabezado. */
function sheet_(bookId, name) {
  var b = book_(bookId);
  var sh = b.getSheetByName(name);
  if (sh) return sh;
  sh = b.insertSheet(name);
  if (name === 'Votos') {
    sh.appendRow(['Fecha', 'Mesa', 'Lista', 'ID']);
    sh.getRange(1, 1, 1, 4).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (name === 'Conteo') {
    sh.appendRow(['Lista', 'Votos']);
    sh.getRange(1, 1, 1, 2).setFontWeight('bold');
    for (var i = 0; i < LISTAS.length; i++) sh.appendRow([LISTAS[i].key, 0]);
  }
  return sh;
}

// ---------- Entrada HTTP ----------

function doGet() {
  return json_({ ok: true, service: 'AVH votos' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'json' });
  }
  try {
    return json_(handle_(req));
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'servidor' });
  }
}

function handle_(req) {
  switch (req.action) {
    case 'login': return login_(req.user, req.pass);
    case 'vote':
      if (!validToken_(req.token)) return { ok: false, error: 'auth' };
      return vote_(req);
    case 'results':
      if (!validToken_(req.token)) return { ok: false, error: 'auth' };
      return { ok: true, counts: cachedCounts_(), updatedAt: new Date().toISOString() };
    default:
      return { ok: false, error: 'accion' };
  }
}

// ---------- Lógica pura ----------

function isValidLista(key) {
  for (var i = 0; i < LISTAS.length; i++) if (LISTAS[i].key === key) return true;
  return false;
}

// ---------- Sesión ----------

function login_(user, pass) {
  var props = PropertiesService.getScriptProperties();
  var U = String(props.getProperty('ADMIN_USER') || 'adminAVH').trim(); // el usuario no es secreto
  var P = String(props.getProperty('ADMIN_PASS') || '').trim();
  if (!P) return { ok: false, error: 'sin_config' }; // falta la propiedad ADMIN_PASS
  var okUser = String(user || '').trim().toLowerCase() === U.toLowerCase();
  if (!okUser || String(pass || '').trim() !== P) return { ok: false, error: 'credenciales' };
  purgeTokens_(props);
  var token = Utilities.getUuid();
  var val = (Date.now() + TOKEN_MS) + '|' + Date.now(); // vencimiento|emitido
  props.setProperty('tok_' + token, val);
  CacheService.getScriptCache().put('tok_' + token, val, CACHE_S);
  return { ok: true, token: token };
}

function validToken_(token) {
  if (!token) return false;
  var key = 'tok_' + token;
  var cache = CacheService.getScriptCache();
  var val = cache.get(key);
  if (val === null) {
    val = PropertiesService.getScriptProperties().getProperty(key);
    if (val === null) return false;
    cache.put(key, val, CACHE_S);
  }
  var parts = String(val).split('|');
  // un token emitido antes del último reinicio de la elección ya no sirve
  return Number(parts[0]) > Date.now() && Number(parts[1] || 0) >= eleccionDesde_();
}

/** Momento (ms) del último reiniciarEleccion(); 0 si nunca se reinició. */
function eleccionDesde_() {
  return Number(PropertiesService.getScriptProperties().getProperty('ELECCION_DESDE') || 0);
}

function purgeTokens_(props) {
  var keys = props.getKeys();
  var now = Date.now();
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf('tok_') === 0 && Number(String(props.getProperty(keys[i])).split('|')[0]) <= now) props.deleteProperty(keys[i]);
  }
}

// ---------- Votos ----------

function vote_(req) {
  if (!isValidLista(req.lista)) return { ok: false, error: 'lista' };
  if (!VOTE_ID_RE.test(String(req.vote_id || ''))) return { ok: false, error: 'vote_id' };
  // voto emitido antes del último reinicio (p. ej. un ensayo que quedó en cola): se descarta
  if (req.ts && Number(req.ts) < eleccionDesde_()) return { ok: false, error: 'eleccion' };
  var estacion = MESAS.indexOf(req.estacion) >= 0 ? req.estacion : 'Mesa sin asignar';

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var cache = CacheService.getScriptCache();
    var vidKey = 'vid_' + req.vote_id;
    var votos = sheet_(BD_ID, 'Votos');
    if (cache.get(vidKey) !== null || seenInSheet_(votos, req.vote_id)) {
      cache.put(vidKey, '1', CACHE_S);
      return { ok: true, duplicate: true, counts: cachedCounts_() };
    }

    // La hoja Votos es la única fuente de verdad: una sola escritura por voto.
    votos.appendRow([new Date(), estacion, req.lista, String(req.vote_id)]);
    SpreadsheetApp.flush(); // asegurar la fila antes de soltar el lock
    cache.put(vidKey, '1', CACHE_S);
    var counts = readCounts_(votos);
    putCounts_(counts);
    refreshViews_(counts);
    SpreadsheetApp.flush();
    return { ok: true, duplicate: false, counts: counts };
  } finally {
    lock.releaseLock();
  }
}

/** Actualiza Conteo y REPORTE (solo vistas). Si fallan, el voto ya está guardado. */
function refreshViews_(counts) {
  try { writeCounts_(counts); } catch (err) { console.error('Conteo', err); }
  try { writeReport(counts); } catch (err) { console.error('Reporte', err); }
}

function seenInSheet_(sh, voteId) {
  var last = sh.getLastRow();
  if (last < 2) return false;
  var ids = sh.getRange(2, 4, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(voteId)) return true;
  return false;
}

function zeroCounts_() {
  var out = {};
  for (var i = 0; i < LISTAS.length; i++) out[LISTAS[i].key] = 0;
  return out;
}

/** Cuenta los votos directamente desde la hoja Votos (columna C). */
function readCounts_(votos) {
  var sh = votos || book_(BD_ID).getSheetByName('Votos');
  var out = zeroCounts_();
  if (!sh) return out;
  var last = sh.getLastRow();
  if (last < 2) return out;
  var vals = sh.getRange(2, 3, last - 1, 1).getValues();
  for (var j = 0; j < vals.length; j++) if (isValidLista(vals[j][0])) out[vals[j][0]] += 1;
  return out;
}

/** Conteo para la pantalla de resultados: caché primero, hoja solo si hace falta. */
function cachedCounts_() {
  var raw = CacheService.getScriptCache().get('counts');
  if (raw) {
    try { return JSON.parse(raw); } catch (err) { /* recalcular */ }
  }
  var counts = readCounts_();
  putCounts_(counts);
  return counts;
}

function putCounts_(counts) {
  CacheService.getScriptCache().put('counts', JSON.stringify(counts), COUNTS_CACHE_S);
}

function writeCounts_(counts) {
  var rows = [];
  for (var i = 0; i < LISTAS.length; i++) rows.push([LISTAS[i].key, counts[LISTAS[i].key]]);
  sheet_(BD_ID, 'Conteo').getRange(2, 1, rows.length, 2).setValues(rows);
}

// ---------- Reporte ----------

function writeReport(counts) {
  var sh = sheet_(REPORTE_ID, 'Resumen');
  var total = 0;
  for (var i = 0; i < LISTAS.length; i++) total += counts[LISTAS[i].key];
  var rows = [['Lista', 'Votos', '%']];
  for (var j = 0; j < LISTAS.length; j++) {
    var v = counts[LISTAS[j].key];
    rows.push([LISTAS[j].nombre, v, total ? v / total : 0]);
  }
  rows.push(['Total', total, total ? 1 : 0]);
  rows.push(['Última actualización', new Date(), '']);
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold');
  sh.getRange(2, 3, LISTAS.length + 1, 1).setNumberFormat('0.0%');
}

// ---------- Mantenimiento (ejecutar a mano desde el editor) ----------

/** Crea las hojas si faltan y escribe el reporte. Es opcional: la API lo hace sola. */
function setup() {
  sheet_(BD_ID, 'Votos');
  sheet_(BD_ID, 'Conteo');
  var counts = readCounts_();
  putCounts_(counts);
  writeCounts_(counts);
  writeReport(counts);
}

/**
 * Reinicia la elección: borra todos los votos, pone el conteo en 0, cierra todas las sesiones
 * y descarta cualquier voto de ensayo que alguna PC tenga todavía en cola. ¡Irreversible!
 */
function reiniciarEleccion() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var votos = sheet_(BD_ID, 'Votos');
    var last = votos.getLastRow();
    if (last > 1) votos.deleteRows(2, last - 1);
    PropertiesService.getScriptProperties().setProperty('ELECCION_DESDE', String(Date.now()));
    var counts = zeroCounts_();
    putCounts_(counts);
    refreshViews_(counts);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

/** Reconstruye Conteo y REPORTE a partir de la hoja Votos (por si alguien los editó a mano). */
function recontar() {
  var counts = readCounts_();
  putCounts_(counts);
  refreshViews_(counts);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
