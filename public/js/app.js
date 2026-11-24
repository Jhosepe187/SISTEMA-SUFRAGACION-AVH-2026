// Arranque: pantallas, sesión, mesa y sincronización de votos.
import { API_URL, MOCK, RETRY_MS, KEY_PREFIX as P } from './config.js';
import { createApi } from './api.js';
import { VoteQueue } from './logic.js';
import { mountBallot } from './ballot.js';
import { mountResults } from './results-view.js';

const api = createApi({ url: API_URL, mock: MOCK });
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* */ } },
};
const storage = { getItem: store.get, setItem: store.set };

const $ = (s) => document.querySelector(s);
const SCREENS = ['inicio', 'login', 'menu', 'cedula', 'resultados'];
const PERSISTED = ['menu', 'cedula', 'resultados'];

let token = store.get(P + 'token');
const queue = new VoteQueue(storage, (vote) => api.vote(token, vote), P + 'queue');

// ---------- pantallas ----------
let results = null;
function show(name) {
  if ((name === 'menu' || name === 'cedula' || name === 'resultados') && !token) name = 'login';
  for (const s of SCREENS) $(`#screen-${s}`).hidden = s !== name;
  if (PERSISTED.includes(name)) store.set(P + 'mode', name);
  if (name === 'resultados') results.start(); else results?.stop();
  if (name === 'cedula') ballot.reset();
  if (name === 'login') {
    const f = $('#login-form');
    f.reset();
    f.querySelector('.form-error').textContent = '';
    setTimeout(() => f.user.focus(), 50);
  }
  if (name === 'menu') {
    paintSync();
    if (!store.get(P + 'estacion')) openMesa();
  }
}

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) show(go.dataset.go);
});

// ---------- login ----------
async function tryLogin(form) {
  const err = form.querySelector('.form-error');
  const btn = form.querySelector('[type="submit"]');
  err.textContent = '';
  btn.disabled = true;
  try {
    const r = await api.login(form.user.value.trim(), form.pass.value);
    if (r.ok) {
      token = r.token;
      store.set(P + 'token', token);
      return true;
    }
    err.textContent =
      r.error === 'credenciales' ? 'Usuario o contraseña incorrectos.'
      : r.error === 'sin_config' ? 'Falta configurar la contraseña (ADMIN_PASS) en Google Apps Script.'
      : 'No se pudo iniciar sesión.';
  } catch {
    err.textContent = 'Sin conexión con el servidor. Revisa el internet e intenta de nuevo.';
  } finally {
    btn.disabled = false;
  }
  form.pass.value = '';
  form.pass.focus();
  return false;
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (await tryLogin(e.currentTarget)) show('menu');
});

$('#btn-logout').addEventListener('click', () => {
  token = null;
  store.del(P + 'token');
  store.del(P + 'mode');
  show('inicio');
});

// ---------- mesa ----------
function paintEstacion() {
  const m = store.get(P + 'estacion') || 'Mesa sin asignar';
  document.querySelectorAll('[data-estacion]').forEach((el) => (el.textContent = m));
}
function openMesa() { $('#modal-mesa').hidden = false; }
$('#btn-estacion').addEventListener('click', openMesa);
document.querySelectorAll('[data-mesa]').forEach((b) =>
  b.addEventListener('click', () => {
    store.set(P + 'estacion', b.dataset.mesa);
    $('#modal-mesa').hidden = true;
    paintEstacion();
  }),
);

// ---------- modal de autenticación (salir / reingresar) ----------
let authMode = 'exit';
function openAuth(mode) {
  authMode = mode;
  const f = $('#modal-auth-form');
  f.reset();
  f.querySelector('.form-error').textContent = '';
  $('#modal-auth-title').textContent = mode === 'exit' ? 'Salir de la votación' : 'Reingresar sesión';
  $('#modal-auth').hidden = false;
  setTimeout(() => f.user.focus(), 50);
}
function closeAuth() { $('#modal-auth').hidden = true; }
$('#btn-exit').addEventListener('click', () => openAuth('exit'));
$('#auth-banner').addEventListener('click', () => openAuth('reauth'));
$('#modal-auth-cancel').addEventListener('click', closeAuth);
$('#modal-auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!(await tryLogin(e.currentTarget))) return;
  closeAuth();
  $('#auth-banner').hidden = true;
  syncNow();
  if (authMode === 'exit') show('menu');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modal-auth').hidden) closeAuth();
});

// ---------- sincronización de votos ----------
let online = true;
function paintSync() {
  const n = queue.pending();
  const isOnline = online && navigator.onLine !== false;
  const text = n > 0 ? `⟳ ${n} voto${n === 1 ? '' : 's'} por sincronizar` : isOnline ? '● Conectado' : '● Sin conexión';
  const cls = 'sync-status' + (n > 0 || !isOnline ? ' is-pending' : '');
  document.querySelectorAll('[data-sync]').forEach((el) => { el.textContent = text; el.className = cls; });
}
async function syncNow() {
  if (!token) return paintSync();
  const r = await queue.flush();
  if (r.sent > 0) online = true;
  else if (r.failed > 0) online = false;
  if (r.authError) $('#auth-banner').hidden = false;
  paintSync();
}
setInterval(syncNow, RETRY_MS);
window.addEventListener('online', syncNow);
window.addEventListener('offline', paintSync);

// ---------- montaje ----------
const ballot = mountBallot($('#ballot-root'), {
  onVote(lista) {
    queue.enqueue(lista, store.get(P + 'estacion') || 'Mesa sin asignar');
    paintSync();
    syncNow();
  },
});

results = mountResults($('#results-root'), {
  fetchCounts: () => api.results(token),
  onBack: () => show('menu'),
  onAuthError: () => {
    token = null;
    store.del(P + 'token');
    show('login');
  },
});

if (MOCK) $('#mock-tag').hidden = false;
paintEstacion();
paintSync();
show(token ? store.get(P + 'mode') || 'menu' : 'inicio');
syncNow();
