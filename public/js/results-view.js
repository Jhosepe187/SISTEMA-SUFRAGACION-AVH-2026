// Pantalla de resultados: barras por lista, conteo por mesa y gráfico global con regla,
// con refresco periódico.
import { LISTAS, POLL_MS, KEY_PREFIX } from './config.js';
import { computeShares, axisMax } from './logic.js';

const MESAS = ['Mesa 1', 'Mesa 2'];

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
        <button class="seg-btn" data-view="mesa" role="tab">Por mesa</button>
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

    <div class="res-mesas" data-panel="mesa" hidden>
      ${MESAS.map((m) => `
        <section class="mesa-card" data-mesa-card="${m}">
          <header class="mesa-head">
            <h2>${m}</h2>
            <div class="mesa-total"><strong data-mesa-total>0</strong><span>votos</span></div>
          </header>
          <ul class="mesa-rows">
            ${LISTAS.map((l) => `
              <li class="mesa-row" data-key="${l.key}" style="--c:${l.color}">
                <img src="${l.logo}" alt="" />
                <span class="mesa-name">${l.nombre}</span>
                <span class="mesa-bar"><span></span></span>
                <strong class="mesa-num" data-mesa-votos>0</strong>
              </li>`).join('')}
          </ul>
        </section>`).join('')}
    </div>

    <div class="res-global" data-panel="global" hidden>
      <div class="vchart" style="--cols:${LISTAS.length}">
        <div class="vaxis-title">Estudiantes</div>
        <div class="vaxis" aria-hidden="true"></div>
        ${LISTAS.map((l, i) => `
          <div class="vcol" data-key="${l.key}" style="--c:${l.color}; --col:${i + 2}">
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
  let axisTop = 0;

  root.querySelector('[data-act="back"]').addEventListener('click', onBack);
  root.querySelectorAll('.seg-btn').forEach((b) =>
    b.addEventListener('click', () => {
      root.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('is-active', x === b));
      root.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.view));
    }),
  );

  function renderAxis(top) {
    if (top === axisTop) return;
    axisTop = top;
    const ticks = [];
    for (let v = 0; v <= top; v += 50) ticks.push(`<span class="vtick" style="bottom:${(v / top) * 100}%">${v}</span>`);
    $('.vaxis').innerHTML = ticks.join('');
    $('.vchart').style.setProperty('--steps', top / 50);
  }

  function render(data) {
    const counts = data.counts || data; // compatible con el formato anterior guardado en el navegador
    const { total, items } = computeShares(counts);
    $('[data-total]').textContent = total.toLocaleString('es-PE');
    const top = axisMax(Math.max(...items.map((i) => i.votos)));
    renderAxis(top);
    for (const it of items) {
      const card = root.querySelector(`.res-card[data-key="${it.key}"]`);
      card.querySelector('[data-votos]').textContent = it.votos;
      card.querySelector('[data-unit]').textContent = it.votos === 1 ? 'voto' : 'votos';
      card.querySelector('[data-pct]').textContent = `${it.pct} %`;
      card.querySelector('.hbar span').style.width = `${it.pct}%`;
      const col = root.querySelector(`.vcol[data-key="${it.key}"]`);
      col.querySelector('[data-votos]').textContent = it.votos;
      col.querySelector('[data-pct]').textContent = `${it.pct} %`;
      col.querySelector('.vbar').style.height = `${(it.votos / top) * 100}%`;
    }
    const lead = items.reduce((a, b) => (b.votos > a.votos ? b : a));
    const unique = items.filter((i) => i.votos === lead.votos).length === 1;
    root.querySelectorAll('.res-card[data-key], .vcol[data-key]').forEach((el) =>
      el.classList.toggle('is-lead', total > 0 && unique && el.dataset.key === lead.key),
    );
    renderMesas(data.mesas || {});
  }

  function renderMesas(mesas) {
    for (const m of MESAS) {
      const card = root.querySelector(`[data-mesa-card="${m}"]`);
      const { total, items } = computeShares(mesas[m] || {});
      card.querySelector('[data-mesa-total]').textContent = total.toLocaleString('es-PE');
      for (const it of items) {
        const row = card.querySelector(`.mesa-row[data-key="${it.key}"]`);
        row.querySelector('[data-mesa-votos]').textContent = it.votos;
        row.querySelector('.mesa-bar span').style.width = `${it.pct}%`;
      }
    }
  }

  const SNAP_KEY = KEY_PREFIX + 'last_results';
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
        const data = { counts: r.counts, mesas: r.mesas || {} };
        render(data);
        try { localStorage.setItem(SNAP_KEY, JSON.stringify(data)); } catch { /* sin almacenamiento */ }
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
      render(snap || { counts: {}, mesas: {} });
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
