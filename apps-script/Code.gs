/**
 * Sistema de Sufragación AVH — API (Google Apps Script)
 * Pegar este archivo en Extensiones → Apps Script de la hoja "BD simple".
 * Guía completa: apps-script/INSTALACION.md
 */

var BD_ID = '1OXnQwi6F4ywY156jGIaxQ8bwGCPmR2G1WbdiCAbvEAQ';
var REPORTE_ID = '1LAR84myX-IEYsXUzv0SjwwNmk_1KWP9wceh-isf1iVM';

var LISTAS = [
  { key: 'UNESI', nombre: 'UNESI' },
  { key: 'HUMBI', nombre: 'Humbi por siempre' },
  { key: 'AVH', nombre: 'AVH Juntos por el cambio' }
];

var TOKEN_MS = 12 * 60 * 60 * 1000; // 12 horas
var CACHE_S = 21600; // máximo permitido por CacheService (6 h)
var MESAS = ['Mesa 1', 'Mesa 2', 'Mesa sin asignar'];
var VOTE_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

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
      return { ok: true, counts: readCounts_(), updatedAt: new Date().toISOString() };
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
  var U = props.getProperty('ADMIN_USER');
  var P = props.getProperty('ADMIN_PASS');
  if (!U || !P || user !== U || pass !== P) return { ok: false, error: 'credenciales' };
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
    if (cache.get(vidKey) !== null || seenInSheet_(req.vote_id)) {
      cache.put(vidKey, '1', CACHE_S);
      return { ok: true, duplicate: true, counts: readCounts_() };
    }

    // La hoja Votos es la única fuente de verdad: una sola escritura por voto.
    SpreadsheetApp.openById(BD_ID).getSheetByName('Votos')
      .appendRow([new Date(), estacion, req.lista, String(req.vote_id)]);
    SpreadsheetApp.flush(); // asegurar la fila antes de soltar el lock
    cache.put(vidKey, '1', CACHE_S);
    var counts = readCounts_();
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

function seenInSheet_(voteId) {
  var sh = SpreadsheetApp.openById(BD_ID).getSheetByName('Votos');
  var last = sh.getLastRow();
  if (last < 2) return false;
  var ids = sh.getRange(2, 4, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(voteId)) return true;
  return false;
}

/** Cuenta los votos directamente desde la hoja Votos (columna C). */
function readCounts_() {
  var sh = SpreadsheetApp.openById(BD_ID).getSheetByName('Votos');
  var out = {};
  for (var i = 0; i < LISTAS.length; i++) out[LISTAS[i].key] = 0;
  var last = sh.getLastRow();
  if (last < 2) return out;
  var vals = sh.getRange(2, 3, last - 1, 1).getValues();
  for (var j = 0; j < vals.length; j++) if (isValidLista(vals[j][0])) out[vals[j][0]] += 1;
  return out;
}

function writeCounts_(counts) {
  var rows = [];
  for (var i = 0; i < LISTAS.length; i++) rows.push([LISTAS[i].key, counts[LISTAS[i].key]]);
  SpreadsheetApp.openById(BD_ID).getSheetByName('Conteo').getRange(2, 1, rows.length, 2).setValues(rows);
}

// ---------- Reporte ----------

function writeReport(counts) {
  var rep = SpreadsheetApp.openById(REPORTE_ID);
  var sh = rep.getSheetByName('Resumen') || rep.insertSheet('Resumen');
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
  sh.getRange(2, 3, LISTAS.length + 1, 1).setNumberFormat('0.0%');
}

// ---------- Instalación (ejecutar a mano una vez) ----------

function setup() {
  var bd = SpreadsheetApp.openById(BD_ID);
  var votos = bd.getSheetByName('Votos') || bd.insertSheet('Votos');
  if (votos.getLastRow() === 0) {
    votos.appendRow(['Fecha', 'Mesa', 'Lista', 'ID']);
    votos.getRange(1, 1, 1, 4).setFontWeight('bold');
    votos.setFrozenRows(1);
  }
  var conteo = bd.getSheetByName('Conteo') || bd.insertSheet('Conteo');
  if (conteo.getLastRow() === 0) {
    conteo.appendRow(['Lista', 'Votos']);
    conteo.getRange(1, 1, 1, 2).setFontWeight('bold');
    for (var i = 0; i < LISTAS.length; i++) conteo.appendRow([LISTAS[i].key, 0]);
  }
  var rep = SpreadsheetApp.openById(REPORTE_ID);
  if (!rep.getSheetByName('Resumen')) rep.insertSheet('Resumen');
  writeReport(readCounts_());
  rep.getSheetByName('Resumen').getRange(1, 1, 1, 3).setFontWeight('bold');
}

/**
 * Reinicia la elección: borra todos los votos, pone el conteo en 0, cierra todas las sesiones
 * y descarta cualquier voto de ensayo que alguna PC tenga todavía en cola. ¡Irreversible!
 */
function reiniciarEleccion() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var votos = SpreadsheetApp.openById(BD_ID).getSheetByName('Votos');
    var last = votos.getLastRow();
    if (last > 1) votos.deleteRows(2, last - 1);
    PropertiesService.getScriptProperties().setProperty('ELECCION_DESDE', String(Date.now()));
    refreshViews_(readCounts_());
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

/** Reconstruye Conteo y REPORTE a partir de la hoja Votos (por si alguien los editó a mano). */
function recontar() {
  refreshViews_(readCounts_());
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
