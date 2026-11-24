// Cédula de votación: brillo al pasar el mouse, lápiz 3D que marca una X y pantalla de gracias.
import { LISTAS, THANKS_MS } from './config.js';

const STROKE_MS = 520; // duración de cada trazo de la X
const LIFT_MS = 220; // levantar el lápiz entre trazos
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Lápiz en SVG: la punta está en (0,0) del grupo, el cuerpo se extiende hacia arriba-derecha.
const PENCIL_SVG = `
<svg class="pencil-svg" viewBox="-10 -250 70 260" width="70" height="260" aria-hidden="true">
  <defs>
    <linearGradient id="pb" x1="0" x2="1">
      <stop offset="0" stop-color="#c98a00"/><stop offset=".35" stop-color="#ffd23f"/>
      <stop offset=".6" stop-color="#ffc400"/><stop offset="1" stop-color="#a86e00"/>
    </linearGradient>
    <linearGradient id="pw" x1="0" x2="1">
      <stop offset="0" stop-color="#c8935a"/><stop offset=".5" stop-color="#f3cf9c"/><stop offset="1" stop-color="#b47c45"/>
    </linearGradient>
    <linearGradient id="pm" x1="0" x2="1">
      <stop offset="0" stop-color="#8d939b"/><stop offset=".45" stop-color="#eef1f4"/><stop offset="1" stop-color="#6f757d"/>
    </linearGradient>
    <linearGradient id="pe" x1="0" x2="1">
      <stop offset="0" stop-color="#d9607a"/><stop offset=".5" stop-color="#ff9fb2"/><stop offset="1" stop-color="#c24a64"/>
    </linearGradient>
  </defs>
  <g transform="rotate(28)">
    <polygon points="0,0 -9,-34 9,-34" fill="url(#pw)"/>
    <polygon points="0,0 -3.2,-12 3.2,-12" fill="#2b2b2b"/>
    <rect x="-9" y="-190" width="18" height="156" fill="url(#pb)"/>
    <rect x="-3" y="-190" width="2" height="156" fill="#fff3" />
    <rect x="-9.5" y="-212" width="19" height="24" rx="2" fill="url(#pm)"/>
    <rect x="-9.5" y="-205" width="19" height="2" fill="#0002"/><rect x="-9.5" y="-198" width="19" height="2" fill="#0002"/>
    <rect x="-9" y="-238" width="18" height="28" rx="6" fill="url(#pe)"/>
  </g>
</svg>`;

export function mountBallot(root, { onVote }) {
  root.innerHTML = `
    <div class="ballot-paper">
      <header class="ballot-head">
        <div class="ballot-title">
          <span class="ballot-kicker">ELECCIÓN DEL MUNICIPIO ESCOLAR 2026</span>
          <h1>I.E.P. ALEXANDER VON HUMBOLDT</h1>
        </div>
      </header>
      <p class="ballot-instr">MARCA CON UNA X EL SÍMBOLO DE LA LISTA DE TU PREFERENCIA</p>
      <div class="ballot-options">
        ${LISTAS.map((l, i) => `
          <div class="option" style="--glow:${l.color}">
            <div class="option-label">LISTA ${i + 1}</div>
            <div class="option-name">${l.nombre}</div>
            <button class="option-box" data-key="${l.key}" aria-label="Votar por ${l.nombre}">
              <img src="${l.logo}" alt="" draggable="false" />
              <svg class="xmark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <path class="x1" d="M14 14 L86 86" pathLength="1"/>
                <path class="x2" d="M86 14 L14 86" pathLength="1"/>
              </svg>
            </button>
          </div>`).join('')}
      </div>
      <footer class="ballot-foot">Voto secreto · Un voto por estudiante</footer>
    </div>
    <div class="pencil" hidden>${PENCIL_SVG}</div>
    <div class="thanks" hidden>
      <div class="thanks-card">
        <div class="thanks-check" aria-hidden="true">
          <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27 l7 7 l15 -16"/></svg>
        </div>
        <h2>¡Gracias por votar!</h2>
        <p>Tu voto fue registrado.</p>
        <div class="thanks-progress"><span></span></div>
      </div>
    </div>`;

  const paper = root.querySelector('.ballot-paper');
  const pencil = root.querySelector('.pencil');
  const thanks = root.querySelector('.thanks');
  let locked = false;
  let timer = null;

  root.querySelectorAll('.option-box').forEach((box) => {
    box.addEventListener('click', () => choose(box));
  });

  async function choose(box) {
    if (locked) return;
    locked = true;
    paper.classList.add('is-locked');
    box.classList.add('is-chosen');
    await drawX(box);
    onVote(box.dataset.key);
    await sleep(350);
    showThanks();
  }

  async function drawX(box) {
    const x1 = box.querySelector('.x1');
    const x2 = box.querySelector('.x2');
    if (reduceMotion()) {
      x1.style.strokeDashoffset = 0;
      x2.style.strokeDashoffset = 0;
      return;
    }
    const r = box.getBoundingClientRect();
    const rootR = root.getBoundingClientRect();
    const pt = (px, py) => [r.left - rootR.left + (px / 100) * r.width, r.top - rootR.top + (py / 100) * r.height];
    pencil.hidden = false;
    // entra desde arriba a la derecha
    const s1 = pt(14, 14);
    await move(pencil, [s1[0] + 120, s1[1] - 160], s1, 300, 1.25, 1);
    await stroke(pencil, x1, pt(14, 14), pt(86, 86));
    await move(pencil, pt(86, 86), pt(86, 14), LIFT_MS, 1, 1.12, true);
    await stroke(pencil, x2, pt(86, 14), pt(14, 86));
    const end = pt(14, 86);
    await move(pencil, end, [end[0] + 140, end[1] - 220], 320, 1, 1.25);
    pencil.hidden = true;
  }

  function showThanks() {
    thanks.hidden = false;
    const bar = thanks.querySelector('.thanks-progress span');
    bar.style.transition = 'none';
    bar.style.width = '100%';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bar.style.transition = `width ${THANKS_MS}ms linear`;
      bar.style.width = '0%';
    }));
    timer = setTimeout(reset, THANKS_MS);
  }

  function reset() {
    clearTimeout(timer);
    thanks.hidden = true;
    pencil.hidden = true;
    root.querySelectorAll('.option-box').forEach((b) => {
      b.classList.remove('is-chosen');
      b.querySelectorAll('path').forEach((p) => (p.style.strokeDashoffset = ''));
    });
    paper.classList.remove('is-locked');
    locked = false;
  }

  return { reset };
}

// ---- animación ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function placePencil(el, x, y, scale) {
  // la punta del lápiz (0,0 del SVG) está a 10px del borde izquierdo y 250px del superior
  el.style.transform = `translate(${x - 10}px, ${y - 250}px) perspective(600px) rotateX(18deg) rotateY(-14deg) scale(${scale})`;
  el.style.setProperty('--lift', scale > 1.02 ? 1 : 0);
}

function move(el, from, to, ms, s0, s1, arc = false) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = ease(t);
      const sc = arc ? 1 + (s1 - 1) * Math.sin(Math.PI * t) : s0 + (s1 - s0) * e;
      placePencil(el, from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e, sc);
      t < 1 ? requestAnimationFrame(step) : resolve();
    };
    requestAnimationFrame(step);
  });
}

function stroke(el, path, from, to) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / STROKE_MS);
      const e = ease(t);
      const wobble = Math.sin(t * Math.PI * 6) * 1.2; // trazo a mano
      placePencil(el, from[0] + (to[0] - from[0]) * e + wobble, from[1] + (to[1] - from[1]) * e, 1);
      path.style.strokeDashoffset = String(1 - e);
      t < 1 ? requestAnimationFrame(step) : resolve();
    };
    requestAnimationFrame(step);
  });
}
