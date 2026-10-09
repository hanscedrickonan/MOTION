// Catalogue de démonstration : transitions (T*) et animations (A*) proposées.
// Même contrat que la vidéo : window.seek(t) dessine l'instant t, de façon déterministe.
import {
  FX, ctx, W, H, C, TEXT, DEG, scenes,
  clamp, lerp, prog, easeInCubic, easeInOutCubic,
  text, measure, fitSize, sp, drawGrain, buffer, shot, brushPath, leaf, LEAVES,
} from './main.js';

function withFX(flags, fn) {
  const prev = { ...FX };
  Object.assign(FX, flags);
  try { return fn(); } finally { Object.assign(FX, prev); }
}

// ---------------------------------------------------------------- démos

const D = [];
const add = (code, kind, name, dur, draw) => D.push({ code, kind, name, dur, draw });

// T1 — raccord par le cercle : le tampon du ticket devient l'ensō de la signature.
add('T1', 'TRANSITION', 'RACCORD PAR LE CERCLE', 2.9, (t) => {
  const z0 = [804, 579], z1 = [540, 520];
  if (t < 1.2) {
    const s = easeInOutCubic(prog(t, 0.45, 1.2));
    const Z = lerp(1, 600 / 236, s);
    ctx.save();
    ctx.translate(lerp(z0[0], z1[0], s), lerp(z0[1], z1[1], s));
    ctx.scale(Z, Z);
    ctx.rotate(lerp(0, 14, s) * DEG);
    ctx.translate(-z0[0], -z0[1]);
    scenes.ticket(2.6 + Math.min(t, 0.3));
    ctx.restore();
  } else {
    scenes.cta(0.62 + (t - 1.2));
  }
});

// T2 — coup de pinceau orange, puis le plan suivant révélé par un second trait.
add('T2', 'TRANSITION', 'COUP DE PINCEAU', 2.5, (t) => {
  const p1 = easeInOutCubic(prog(t, 0.4, 0.95));
  const p2 = easeInOutCubic(prog(t, 0.95, 1.45));
  if (p2 < 1) {
    scenes.map(2.68);
    if (p1 > 0) {
      ctx.save();
      brushPath(p1, -11 * DEG);
      ctx.fillStyle = C.orange;
      ctx.fill();
      ctx.restore();
    }
  }
  if (p2 > 0) {
    const b = shot('next', 'burst', Math.max(0, t - 1.05));
    if (p2 < 1) {
      scenes.map(2.68);
      ctx.save();
      brushPath(1, -11 * DEG);
      ctx.fillStyle = C.orange;
      ctx.fill();
      ctx.restore();
      ctx.save();
      brushPath(p2, 9 * DEG);
      ctx.clip();
      ctx.drawImage(b, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(b, 0, 0);
    }
  }
});

// T3 — traversée de canopée : des feuilles passent devant la caméra.
add('T3', 'TRANSITION', 'TRAVERSÉE DE CANOPÉE', 2.6, (t) => {
  if (t < 1.05) scenes.km(1.1 + t);
  else scenes.map(t - 1.05);
  for (const lf of LEAVES) {
    const u = (t - lf.t0) / 0.75;
    if (u <= 0 || u >= 1) continue;
    const z = Math.pow(u, 2.2);
    const r = lf.d * 900 + z * 2600;
    const x = W / 2 + Math.cos(lf.a) * r;
    const y = H / 2 + Math.sin(lf.a) * r * 1.2;
    leaf(x, y, (300 + z * 2600) * lf.len, lf.rot + z * 0.4, lf.col[0], lf.col[1]);
  }
});

// T4 — plongée dans le « O » de BANCO : le plan suivant apparaît dans l'œil de la lettre.
add('T4', 'TRANSITION', 'PLONGÉE DANS LE « O »', 2.5, (t) => {
  const sB = fitSize('BANCO', 880);
  const asc = measure('BANCO', { size: sB }).asc;
  const ox = 66 + measure('BANC', { size: sB }).w;
  const ow = measure('O', { size: sB }).w;
  const cx = ox + ow / 2, cy = 1250 + asc - asc / 2;
  const s = easeInCubic(prog(t, 0.4, 1.15));
  const Z = Math.pow(34, s);
  if (s >= 1) {
    scenes.burst(t - 1.15);
    return;
  }
  const b = shot('next', 'burst', Math.max(0, t - 1.15));
  ctx.save();
  ctx.translate(lerp(cx, W / 2, s), lerp(cy, H / 2, s));
  ctx.scale(Z, Z);
  ctx.translate(-cx, -cy);
  scenes.map(2.68);
  const cw = ow * 0.36, ch = asc * 0.66;
  ctx.beginPath();
  ctx.roundRect(cx - cw / 2, cy - ch / 2, cw, ch, cw / 2);
  ctx.restore();
  ctx.save();
  ctx.clip();
  ctx.drawImage(b, 0, 0);
  ctx.restore();
});

// T5 — la carte se replie en accordéon et révèle la date au dos.
add('T5', 'TRANSITION', 'CARTE QUI SE REPLIE', 2.8, (t) => {
  const th = easeInOutCubic(prog(t, 0.45, 1.3)) * Math.PI / 2;
  const old = shot('old', 'map', 2.68);
  scenes.date(Math.max(0, t - 0.75));
  if (th >= Math.PI / 2) return;
  const P = 3, ph = H / P, strips = 24;
  const h = ph * Math.cos(th);
  const y0 = H / 2 - (P * h) / 2;
  for (let i = 0; i < P; i++) {
    for (let k = 0; k < strips; k++) {
      const f = (k + 0.5) / strips;
      const depth = i % 2 === 0 ? f : 1 - f;
      const wf = 1 - 0.2 * Math.sin(th) * depth;
      const sy = i * ph + (k / strips) * ph;
      const dy = y0 + i * h + (k / strips) * h;
      ctx.drawImage(old, 0, sy, W, ph / strips + 1, W / 2 - (W * wf) / 2, dy, W * wf, h / strips + 1);
      ctx.fillStyle = `rgba(0,0,0,${(0.55 * Math.sin(th) * depth * (i % 2 ? 1 : 0.6)).toFixed(3)})`;
      ctx.fillRect(W / 2 - (W * wf) / 2, dy, W * wf, h / strips + 1);
    }
  }
});

// T6 — lamelles qui basculent une à une, sur les doubles croches.
add('T6', 'TRANSITION', 'LAMELLES RYTHMÉES', 2.4, (t) => {
  const old = shot('old', 'burst', 2.9);
  const nw = shot('next', 'date', Math.max(0, t - 0.75));
  ctx.fillStyle = '#050D09';
  ctx.fillRect(0, 0, W, H);
  const n = 6, sw = W / n;
  for (let i = 0; i < n; i++) {
    const p = easeInOutCubic(prog(t, 0.5 + i * 0.0625, 0.5 + i * 0.0625 + 0.3));
    const src = p < 0.5 ? old : nw;
    const sx = Math.abs(Math.cos(p * Math.PI));
    const x = i * sw;
    ctx.drawImage(src, x, 0, sw, H, x + (sw * (1 - sx)) / 2, 0, sw * sx, H);
    ctx.fillStyle = `rgba(0,0,0,${(0.5 * Math.sin(p * Math.PI)).toFixed(3)})`;
    ctx.fillRect(x + (sw * (1 - sx)) / 2, 0, sw * sx, H);
  }
});

// T7 — panoramique filé avec flou de mouvement.
add('T7', 'TRANSITION', 'PANORAMIQUE FILÉ', 2.3, (t) => {
  const old = shot('old', 'date', 2.55);
  const nw = shot('next', 'ticket', 0.55 + Math.max(0, t - 0.5));
  const e = (x) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2);
  const u = prog(t, 0.5, 0.9);
  const off = -W * 1.08 * e(u);
  const v = Math.abs(e(Math.min(1, u + 0.02)) - e(Math.max(0, u - 0.02))) / 0.04;
  const comp = buffer('comp');
  const g = comp.getContext('2d');
  g.fillStyle = C.forest;
  g.fillRect(0, 0, W, H);
  g.drawImage(old, off, 0);
  g.drawImage(nw, off + W * 1.08, 0);
  const blur = v * 260;
  const n = blur > 2 ? 12 : 1;
  for (let k = 0; k < n; k++) {
    ctx.globalAlpha = 1 / (k + 1);
    ctx.drawImage(comp, n > 1 ? (k / (n - 1) - 0.5) * blur : 0, 0);
  }
  ctx.globalAlpha = 1;
});

add('A1', 'ANIMATION', 'EMPREINTES DE PAS', 3.0, (t) => withFX({ footprints: true }, () => scenes.map(Math.min(t, 2.7))));
add('A5', 'ANIMATION', 'TEXTE SUR LE CHEMIN', 3.0, (t) => withFX({ pathText: true }, () => scenes.map(Math.min(t, 2.7))));
add('A10', 'ANIMATION', 'BOUSSOLE', 2.8, (t) => withFX({ compass: true }, () => scenes.map(Math.min(t, 2.7))));
add('A3·A4', 'ANIMATION', 'LETTRES VIVANTES (×1 PUIS RALENTI ×0,5)', 3.2, (t) => withFX({ walkLetters: true, breathe: true }, () => {
  scenes.burst(t < 1.0 ? t : (t - 1.0) * 0.5);
}));
add('A8', 'ANIMATION', 'GROUPE DE MARCHEURS', 2.6, (t) => withFX({ hikers: true }, () => scenes.burst(1.5 + t)));
add('A6', 'ANIMATION', 'MESSAGE WHATSAPP', 3.0, (t) => scenes.chat(t));
add('A7', 'ANIMATION', 'NUMÉRO TAPÉ', 2.8, (t) => withFX({ typeNumber: true }, () => scenes.cta(1.0 + t)));

// ---------------------------------------------------------------- montage

const SLATE = 0.7;
let acc = 0;
for (const d of D) {
  d.start = acc;
  acc += SLATE + d.dur;
}
const DURATION = acc;

function slate(d, t) {
  ctx.fillStyle = '#050D09';
  ctx.fillRect(0, 0, W, H);
  const p = sp(t, 'card');
  text(d.kind, 70, 760, { family: TEXT, size: 40, weight: 700, ls: 10, color: 'rgba(241,236,223,0.6)' });
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 780, W, 360);
  ctx.clip();
  text(d.code, 62, 1100 + (1 - p) * 340, { size: 330, color: C.orange });
  ctx.restore();
  const s = Math.min(90, fitSize(d.name, 940));
  text(d.name, 70, 1260, { size: s, color: C.paper });
}

function label(d) {
  const str = `${d.code} · ${d.name}`;
  ctx.font = `700 34px ${TEXT}`;
  ctx.letterSpacing = '4px';
  const w = ctx.measureText(str).width + 56;
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.beginPath();
  ctx.roundRect(W / 2 - w / 2, 60, w, 72, 36);
  ctx.fill();
  ctx.fillStyle = C.paper;
  ctx.textAlign = 'center';
  ctx.fillText(str, W / 2, 108);
  ctx.letterSpacing = '0px';
}

function seek(t) {
  t = clamp(t, 0, DURATION - 1e-6);
  const d = D.find((x) => t >= x.start && t < x.start + SLATE + x.dur) || D[D.length - 1];
  const lt = t - d.start;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (lt < SLATE) slate(d, lt);
  else {
    ctx.fillStyle = C.forest;
    ctx.fillRect(0, 0, W, H);
    d.draw(lt - SLATE);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    label(d);
  }
  ctx.restore();
  drawGrain(t);
}

window.ready = window.ready.then(() => {
  window.seek = seek;
  window.duration = DURATION;
  window.demos = D.map((d) => ({ code: d.code, name: d.name, start: d.start + SLATE, dur: d.dur }));
  const scrub = document.getElementById('scrub');
  scrub.max = String(DURATION);
  scrub.addEventListener('input', () => seek(parseFloat(scrub.value)));
  seek(0);
  return true;
});
