// Pantalla de resultados: barras por lista, gráfico global y total, con refresco periódico.
import { LISTAS, POLL_MS, KEY_PREFIX } from './config.js';
import { computeShares } from './logic.js';

export function mountResults(root, { fetchCounts, onBack, onAuthError }) {
  root.innerHTML = `
    <header class="res-head">
      <button class="btn btn-ghost" data-act="back">← Menú</button>
      <div class="res-title">
        <span class="ballot-kicker">ELECCIONES MUNICIPIO ESCOLAR 2026</span>
        <h1>Resultados en tiempo real</h1>
      </div>
      <div class="res-total"><span>Total de votos</span><strong data-total>0</strong></div>
    </header>
    <div class="res-toolbar">
      <div class="seg" role="tablist">
        <button class="seg-btn is-active" data-view="lista" role="tab">Por lista</button>
        <button class="seg-btn" data-view="global" role="tab">Gráfico global</button>
      </div>
      <span class="res-updated" data-updated>Cargando…</span>
    </div>

    <div class="res-cards" data-panel="lista">
      ${LISTAS.map((l) => `
        <article class="res-card" data-key="${l.key}" style="--c:${l.color}">
          <img src="${l.logo}" alt="Logo ${l.nombre}" />
          <div class="res-card-body">
            <h2>${l.nombre}</h2>
            <div class="hbar"><span></span></div>
            <div class="res-nums"><strong data-votos>0</strong> <span data-unit>votos</span> <em data-pct>0 %</em></div>
          </div>
        </article>`).join('')}
    </div>

    <div class="res-global" data-panel="global" hidden>
      <div class="vchart">
        ${LISTAS.map((l) => `
          <div class="vcol" data-key="${l.key}" style="--c:${l.color}">
            <div class="vval"><strong data-votos>0</strong><em data-pct>0 %</em></div>
            <div class="vtrack"><div class="vbar"></div></div>
            <img src="${l.logo}" alt="" />
            <span class="vname">${l.nombre}</span>
          </div>`).join('')}
      </div>
    </div>`;

  const $ = (s) => root.querySelector(s);
  let timer = null;
  let lastOk = 0;
  let tick = null;

  root.querySelector('[data-act="back"]').addEventListener('click', onBack);
  root.querySelectorAll('.seg-btn').forEach((b) =>
    b.addEventListener('click', () => {
      root.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('is-active', x === b));
      root.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.view));
    }),
  );

  function render(counts) {
    const { total, items } = computeShares(counts);
    $('[data-total]').textContent = total.toLocaleString('es-PE');
    const max = Math.max(1, ...items.map((i) => i.votos));
    for (const it of items) {
      const card = root.querySelector(`.res-card[data-key="${it.key}"]`);
      card.querySelector('[data-votos]').textContent = it.votos;
      card.querySelector('[data-unit]').textContent = it.votos === 1 ? 'voto' : 'votos';
      card.querySelector('[data-pct]').textContent = `${it.pct} %`;
      card.querySelector('.hbar span').style.width = `${it.pct}%`;
      const col = root.querySelector(`.vcol[data-key="${it.key}"]`);
      col.querySelector('[data-votos]').textContent = it.votos;
      col.querySelector('[data-pct]').textContent = `${it.pct} %`;
      col.querySelector('.vbar').style.height = `${(it.votos / max) * 100}%`;
    }
    const lead = items.reduce((a, b) => (b.votos > a.votos ? b : a));
    root.querySelectorAll('[data-key]').forEach((el) => el.classList.toggle('is-lead', total > 0 && el.dataset.key === lead.key && items.filter((i) => i.votos === lead.votos).length === 1));
  }

  const SNAP_KEY = KEY_PREFIX + 'last_counts';
  const STALE_S = Math.max(15, (POLL_MS / 1000) * 4);
  let lastError = '';
  let running = false;

  function updatedLabel() {
    const el = $('[data-updated]');
    if (!lastOk) {
      el.textContent = lastError ? `⚠ ${lastError} · reintentando…` : 'Cargando…';
      el.classList.toggle('is-stale', !!lastError);
      return;
    }
    const s = Math.round((Date.now() - lastOk) / 1000);
    const stale = s > STALE_S;
    el.textContent = stale ? `⚠ ${lastError || 'Sin conexión'} · último dato hace ${s}s` : `● Actualizado hace ${s}s`;
    el.classList.toggle('is-stale', stale);
  }

  function schedule() {
    clearTimeout(timer);
    if (running && !document.hidden) timer = setTimeout(poll, POLL_MS);
  }

  async function poll() {
    if (!running) return;
    try {
      const r = await fetchCounts();
      if (r.ok) {
        lastOk = Date.now();
        lastError = '';
        render(r.counts);
        try { localStorage.setItem(SNAP_KEY, JSON.stringify(r.counts)); } catch { /* sin almacenamiento */ }
      } else if (r.error === 'auth') {
        stop();
        onAuthError?.();
        return;
      } else {
        lastError = 'Error del servidor';
      }
    } catch {
      lastError = 'Sin conexión';
    }
    updatedLabel();
    schedule();
  }

  function onVisibility() {
    if (!running) return;
    if (document.hidden) clearTimeout(timer);
    else poll();
  }

  function start() {
    stop();
    running = true;
    // mostrar al instante el último conteo conocido mientras llega el nuevo
    try {
      const snap = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null');
      if (snap) render(snap);
    } catch { /* */ }
    document.addEventListener('visibilitychange', onVisibility);
    poll();
    tick = setInterval(updatedLabel, 1000);
  }
  function stop() {
    running = false;
    clearTimeout(timer);
    clearInterval(tick);
    document.removeEventListener('visibilitychange', onVisibility);
  }

  return { start, stop };
}
