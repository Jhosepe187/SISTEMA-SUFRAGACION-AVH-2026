import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeShares, VoteQueue } from '../public/js/logic.js';

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test('shares con total 0', () => {
  const r = computeShares({ UNESI: 0, HUMBI: 0, AVH: 0 });
  assert.equal(r.total, 0);
  for (const it of r.items) assert.equal(it.pct, 0);
});

test('shares normal', () => {
  const r = computeShares({ UNESI: 90, HUMBI: 60, AVH: 30 });
  assert.equal(r.total, 180);
  assert.deepEqual(r.items.map((i) => i.pct), [50, 33.3, 16.7]);
  assert.deepEqual(r.items.map((i) => i.key), ['UNESI', 'HUMBI', 'AVH']);
});

test('enqueue persiste', () => {
  const s = fakeStorage();
  new VoteQueue(s, async () => ({ ok: true })).enqueue('UNESI', 'Mesa 1');
  assert.equal(new VoteQueue(s, async () => ({ ok: true })).pending(), 1);
});

test('flush exitoso vacía', async () => {
  const q = new VoteQueue(fakeStorage(), async () => ({ ok: true }));
  q.enqueue('HUMBI', 'Mesa 1');
  const r = await q.flush();
  assert.equal(r.sent, 1);
  assert.equal(q.pending(), 0);
});

test('red caída conserva', async () => {
  const q = new VoteQueue(fakeStorage(), async () => { throw new Error('offline'); });
  q.enqueue('AVH', 'Mesa 2');
  const r = await q.flush();
  assert.ok(r.failed >= 1);
  assert.equal(q.pending(), 1);
});

test('reintento no duplica', async () => {
  const ids = [];
  let fail = true;
  const q = new VoteQueue(fakeStorage(), async (v) => {
    ids.push(v.vote_id);
    if (fail) { fail = false; throw new Error('offline'); }
    return { ok: true };
  });
  q.enqueue('UNESI', 'Mesa 1');
  await q.flush();
  await q.flush();
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  assert.equal(q.pending(), 0);
});

test('auth detiene', async () => {
  const q = new VoteQueue(fakeStorage(), async () => ({ ok: false, error: 'auth' }));
  q.enqueue('UNESI', 'Mesa 1');
  const r = await q.flush();
  assert.equal(r.authError, true);
  assert.equal(q.pending(), 1);
});

test('mock login + vote + results', async () => {
  globalThis.localStorage = fakeStorage();
  const { createApi } = await import('../public/js/api.js');
  const api = createApi({ url: '', mock: true, latency: 0 });
  assert.equal((await api.login('prueba', 'mal')).ok, false);
  const { ok, token } = await api.login('prueba', 'prueba');
  assert.equal(ok, true);
  const v = { vote_id: 'm1', lista: 'AVH', estacion: 'Mesa 1' };
  assert.equal((await api.vote(token, v)).ok, true);
  await api.vote(token, v); // reintento: no duplica
  const r = await api.results(token);
  assert.deepEqual(r.counts, { UNESI: 0, HUMBI: 0, AVH: 1 });
  assert.equal((await api.results('otro')).error, 'auth');
});

test('eleccion descarta el voto viejo', async () => {
  const q = new VoteQueue(fakeStorage(), async () => ({ ok: false, error: 'eleccion' }));
  q.enqueue('UNESI', 'Mesa 1');
  await q.flush();
  assert.equal(q.pending(), 0);
});

test('VoteQueue con clave propia no toca la cola real', () => {
  const s = fakeStorage();
  new VoteQueue(s, async () => ({ ok: true }), 'avh_mock_queue').enqueue('UNESI', 'Mesa 1');
  assert.equal(s.getItem('avh_queue'), null);
});

test('fetch colgado se aborta por timeout', async () => {
  const { createApi } = await import('../public/js/api.js');
  const hang = (_u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('abort'))));
  const api = createApi({ url: 'https://x', mock: false, timeoutMs: 30, fetchImpl: hang });
  await assert.rejects(api.vote('t', { vote_id: 'a', lista: 'UNESI', estacion: 'Mesa 1', ts: 1 }));
});

test('vote envía ts al servidor', async () => {
  const { createApi } = await import('../public/js/api.js');
  let body;
  const api = createApi({ url: 'https://x', mock: false, fetchImpl: async (_u, o) => { body = JSON.parse(o.body); return { ok: true, json: async () => ({ ok: true }) }; } });
  await api.vote('t', { vote_id: 'a', lista: 'UNESI', estacion: 'Mesa 1', ts: 123 });
  assert.equal(body.ts, 123);
});
