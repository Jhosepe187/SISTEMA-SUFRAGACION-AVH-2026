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
var DEDUP_SCAN = 500; // filas recientes revisadas si el cache no tiene el vote_id

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
    return json_({ ok: false, error: 'servidor', detail: String(err) });
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

function applyVote(counts, lista) {
  var out = {};
  for (var i = 0; i < LISTAS.length; i++) out[LISTAS[i].key] = Number(counts[LISTAS[i].key]) || 0;
  out[lista] = out[lista] + 1;
  return out;
}

// ---------- Sesión ----------

function login_(user, pass) {
  var props = PropertiesService.getScriptProperties();
  var U = props.getProperty('ADMIN_USER');
  var P = props.getProperty('ADMIN_PASS');
  if (!U || !P || user !== U || pass !== P) return { ok: false, error: 'credenciales' };
  purgeTokens_(props);
  var token = Utilities.getUuid();
  var exp = Date.now() + TOKEN_MS;
  props.setProperty('tok_' + token, String(exp));
  CacheService.getScriptCache().put('tok_' + token, String(exp), CACHE_S);
  return { ok: true, token: token };
}

function validToken_(token) {
  if (!token) return false;
  var key = 'tok_' + token;
  var cache = CacheService.getScriptCache();
  var exp = cache.get(key);
  if (exp === null) {
    exp = PropertiesService.getScriptProperties().getProperty(key);
    if (exp === null) return false;
    cache.put(key, exp, CACHE_S);
  }
  return Number(exp) > Date.now();
}

function purgeTokens_(props) {
  var keys = props.getKeys();
  var now = Date.now();
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf('tok_') === 0 && Number(props.getProperty(keys[i])) <= now) props.deleteProperty(keys[i]);
  }
}

// ---------- Votos ----------

function vote_(req) {
  if (!isValidLista(req.lista)) return { ok: false, error: 'lista' };
  if (!req.vote_id) return { ok: false, error: 'vote_id' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var cache = CacheService.getScriptCache();
    var vidKey = 'vid_' + req.vote_id;
    if (cache.get(vidKey) !== null || seenInSheet_(req.vote_id)) {
      cache.put(vidKey, '1', CACHE_S);
      return { ok: true, duplicate: true, counts: readCounts_() };
    }

    var bd = SpreadsheetApp.openById(BD_ID);
    bd.getSheetByName('Votos').appendRow([new Date(), String(req.estacion || ''), req.lista, String(req.vote_id)]);
    var counts = applyVote(readCounts_(), req.lista);
    writeCounts_(counts);
    cache.put(vidKey, '1', CACHE_S);
    writeReport(counts);
    return { ok: true, duplicate: false, counts: counts };
  } finally {
    lock.releaseLock();
  }
}

function seenInSheet_(voteId) {
  var sh = SpreadsheetApp.openById(BD_ID).getSheetByName('Votos');
  var last = sh.getLastRow();
  if (last < 2) return false;
  var start = Math.max(2, last - DEDUP_SCAN + 1);
  var ids = sh.getRange(start, 4, last - start + 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(voteId)) return true;
  return false;
}

function readCounts_() {
  var vals = SpreadsheetApp.openById(BD_ID).getSheetByName('Conteo').getRange(2, 1, LISTAS.length, 2).getValues();
  var out = {};
  for (var i = 0; i < LISTAS.length; i++) out[LISTAS[i].key] = 0;
  for (var j = 0; j < vals.length; j++) if (isValidLista(vals[j][0])) out[vals[j][0]] = Number(vals[j][1]) || 0;
  return out;
}

function writeCounts_(counts) {
  var rows = [];
  for (var i = 0; i < LISTAS.length; i++) rows.push([LISTAS[i].key, counts[LISTAS[i].key]]);
  SpreadsheetApp.openById(BD_ID).getSheetByName('Conteo').getRange(2, 1, rows.length, 2).setValues(rows);
}

// ---------- Reporte ----------

function writeReport(counts) {
  var sh = SpreadsheetApp.openById(REPORTE_ID).getSheetByName('Resumen');
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

/** Reinicia la elección: borra todos los votos y pone el conteo en 0. ¡Irreversible! */
function reiniciarEleccion() {
  var bd = SpreadsheetApp.openById(BD_ID);
  var votos = bd.getSheetByName('Votos');
  var last = votos.getLastRow();
  if (last > 1) votos.deleteRows(2, last - 1);
  var zero = {};
  for (var i = 0; i < LISTAS.length; i++) zero[LISTAS[i].key] = 0;
  writeCounts_(zero);
  writeReport(zero);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
