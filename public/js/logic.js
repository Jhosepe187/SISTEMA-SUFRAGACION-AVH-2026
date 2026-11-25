// Lógica pura: porcentajes y cola local de votos (sin DOM).

const KEYS = ['UNESI', 'HUMBI', 'AVH', 'BLANCO'];

export function computeShares(counts) {
  const items = KEYS.map((key) => ({ key, votos: Number(counts?.[key]) || 0 }));
  const total = items.reduce((s, i) => s + i.votos, 0);
  for (const it of items) it.pct = total ? Math.round((it.votos / total) * 1000) / 10 : 0;
  return { total, items };
}

/** Tope de la regla del gráfico: 250 estudiantes, o más si se supera (en pasos de 50). */
export const AXIS_MIN = 250;
export function axisMax(maxVotos) {
  return Math.max(AXIS_MIN, Math.ceil((Number(maxVotos) || 0) / 50) * 50);
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// Cola persistente: un voto sale de la cola solo cuando el servidor lo confirma.
// El servidor deduplica por vote_id, así que reintentar nunca duplica.
export class VoteQueue {
  constructor(storage, sendFn, key = 'avh_queue') {
    this.storage = storage;
    this.sendFn = sendFn;
    this.key = key;
    this._flushing = null;
  }

  _read() {
    try {
      const raw = this.storage.getItem(this.key);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  _write(arr) {
    this.storage.setItem(this.key, JSON.stringify(arr));
  }

  enqueue(lista, estacion) {
    const vote = { vote_id: uuid(), lista, estacion, ts: Date.now() };
    const q = this._read();
    q.push(vote);
    this._write(q);
    return vote;
  }

  pending() {
    return this._read().length;
  }

  flush() {
    if (this._flushing) return this._flushing;
    this._flushing = this._doFlush().finally(() => { this._flushing = null; });
    return this._flushing;
  }

  async _doFlush() {
    let sent = 0;
    let failed = 0;
    let authError = false;
    while (true) {
      const q = this._read();
      if (!q.length) break;
      const vote = q[0];
      let res;
      try {
        res = await this.sendFn(vote);
      } catch {
        failed++;
        break;
      }
      if (res && res.ok) {
        // quitar por id (la cola pudo crecer mientras se enviaba)
        this._write(this._read().filter((v) => v.vote_id !== vote.vote_id));
        sent++;
      } else if (res && res.error === 'auth') {
        authError = true;
        break;
      } else if (res && (res.error === 'lista' || res.error === 'vote_id' || res.error === 'eleccion')) {
        // voto que el servidor nunca aceptará (inválido o de antes del reinicio de la elección):
        // se descarta para no bloquear la cola
        this._write(this._read().filter((v) => v.vote_id !== vote.vote_id));
        failed++;
      } else {
        failed++;
        break;
      }
    }
    return { sent, failed, authError };
  }
}
