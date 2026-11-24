// Cliente de la API (Apps Script) y simulador local para pruebas.

export function createApi({ url, mock, latency = 300 }) {
  return mock ? mockApi(latency) : realApi(url);
}

function realApi(url) {
  async function call(body) {
    // text/plain evita el "preflight" CORS que Apps Script no responde.
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
  return {
    login: (user, pass) => call({ action: 'login', user, pass }),
    vote: (token, v) => call({ action: 'vote', token, lista: v.lista, vote_id: v.vote_id, estacion: v.estacion }),
    results: (token) => call({ action: 'results', token }),
  };
}

// ---- Modo prueba: guarda todo en localStorage (compartido entre pestañas) ----
const MOCK_USER = 'prueba';
const MOCK_PASS = 'prueba';
const KEYS = ['UNESI', 'HUMBI', 'AVH'];

function mockApi(latency) {
  const ls = globalThis.localStorage;
  const wait = () => new Promise((r) => setTimeout(r, latency));
  const read = (k, d) => {
    try { return JSON.parse(ls.getItem(k)) ?? d; } catch { return d; }
  };
  const write = (k, v) => ls.setItem(k, JSON.stringify(v));
  const counts = () => ({ UNESI: 0, HUMBI: 0, AVH: 0, ...read('avh_mock_counts', {}) });
  const validToken = (t) => !!t && read('avh_mock_tokens', []).includes(t);

  return {
    async login(user, pass) {
      await wait();
      if (user !== MOCK_USER || pass !== MOCK_PASS) return { ok: false, error: 'credenciales' };
      const token = 'mock-' + Math.random().toString(36).slice(2);
      write('avh_mock_tokens', [...read('avh_mock_tokens', []), token]);
      return { ok: true, token };
    },
    async vote(token, v) {
      await wait();
      if (!validToken(token)) return { ok: false, error: 'auth' };
      if (!KEYS.includes(v.lista)) return { ok: false, error: 'lista' };
      const ids = read('avh_mock_ids', []);
      if (ids.includes(v.vote_id)) return { ok: true, duplicate: true, counts: counts() };
      const c = counts();
      c[v.lista] += 1;
      write('avh_mock_counts', c);
      write('avh_mock_ids', [...ids, v.vote_id]);
      return { ok: true, duplicate: false, counts: c };
    },
    async results(token) {
      await wait();
      if (!validToken(token)) return { ok: false, error: 'auth' };
      return { ok: true, counts: counts(), updatedAt: new Date().toISOString() };
    },
  };
}
