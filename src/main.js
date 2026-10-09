// Randonnée du Cercle — moteur de rendu déterministe.
// Chaque image est une fonction pure du temps : window.seek(t) dessine l'instant t.
// Aucun timer, aucun Math.random(), aucune transition CSS.

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const W = 1080, H = 1920;

const C = {
  forest: '#0B2318',
  canopy: '#143B2B',
  paper: '#F1ECDF',
  orange: '#FF5B1F',
  ink: '#0A0A0A',
};
const DISPLAY = 'Anton';
const TEXT = '"Archivo Narrow"';

// ---------------------------------------------------------------- utilitaires

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
const easeInCubic = (x) => x * x * x;
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const DEG = Math.PI / 180;

// Réponse indicielle d'un oscillateur amorti (ressort) : 0 → 1, avec dépassement si z < 1.
// f : fréquence propre (Hz) — rigidité perçue ; z : amortissement.
function spring(t, f = 2, z = 0.6) {
  if (t <= 0) return 0;
  const w = 2 * Math.PI * f;
  if (z >= 1) return 1 - Math.exp(-w * t) * (1 + w * t);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
}

// Intensités de ressort par famille d'éléments.
const SPR = {
  type: [1.5, 0.62],   // grande typo : masse lourde, léger dépassement
  word: [3.2, 0.72],   // mots de la rafale : sec et nerveux
  card: [2.2, 0.68],   // cartes / blocs éditoriaux
  ui: [4.0, 0.85],     // petites étiquettes : quasi sans rebond
  cam: [0.9, 1.0],     // caméra : critique, jamais de rebond
};
const sp = (t, kind) => spring(t, SPR[kind][0], SPR[kind][1]);

// PRNG déterministe (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Secousse amortie après une coupe (en px).
const shake = (dt, amp = 6) => (dt < 0 ? 0 : amp * Math.exp(-dt * 28) * Math.sin(dt * 95));

function font(family, size, weight = 400) {
  return `${weight} ${size}px ${family}`;
}

function text(str, x, y, { family = DISPLAY, size = 100, weight = 400, color = C.paper, align = 'left', ls = 0 } = {}) {
  ctx.font = font(family, size, weight);
  ctx.letterSpacing = `${ls}px`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
  ctx.letterSpacing = '0px';
}

function measure(str, { family = DISPLAY, size = 100, weight = 400, ls = 0 } = {}) {
  ctx.font = font(family, size, weight);
  ctx.letterSpacing = `${ls}px`;
  const m = ctx.measureText(str);
  ctx.letterSpacing = '0px';
  return { w: m.width - ls, asc: m.actualBoundingBoxAscent, desc: m.actualBoundingBoxDescent, left: m.actualBoundingBoxLeft };
}

// Taille de police pour que `str` occupe exactement `width` px.
function fitSize(str, width, opts = {}) {
  const m = measure(str, { ...opts, size: 100 });
  return (100 * width) / m.w;
}

// Texte révélé par un masque : il monte depuis sous sa ligne de base.
function maskedText(str, x, y, opts, p) {
  const m = measure(str, opts);
  const top = y - m.asc - 8;
  const h = m.asc + m.desc + 16;
  ctx.save();
  ctx.beginPath();
  const x0 = opts.align === 'center' ? x - m.w / 2 - 20 : opts.align === 'right' ? x - m.w - 20 : x - 20;
  ctx.rect(x0, top, m.w + 40, h);
  ctx.clip();
  text(str, x, y + (1 - p) * h, opts);
  ctx.restore();
  return m;
}

function fillBg(color) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
}

function hairline(x0, y, x1, p, color, w = 2) {
  if (p <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(x0, y - w / 2, (x1 - x0) * p, w);
}

// ---------------------------------------------------------------- ressources

const assets = {};

function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}

function tint(img, color) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

// Géométrie du logo source (refs/logo.jpg, 1280×1280).
const LOGO = { ringC: [639, 639.5], ringR: 448, dotC: [639.5, 621.8], dotR: 104 };

// Courbes de niveau : bruit de valeur fractal + marching squares, calculés une seule fois.
function buildContours(w, h, seed, levels, color, lineW) {
  const cell = 12;
  const nx = Math.ceil(w / cell) + 1, ny = Math.ceil(h / cell) + 1;
  const r = rng(seed);
  const G = 64;
  const grid = new Float32Array(G * G).map(() => r());
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const s = (v) => v * v * (3 - 2 * v);
    const g = (i, j) => grid[((j % G) + G) % G * G + (((i % G) + G) % G)];
    const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
    return lerp(lerp(a, b, s(xf)), lerp(c, d, s(xf)), s(yf));
  };
  const field = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = (i * cell) / 520, y = (j * cell) / 520;
      field[j * nx + i] = vnoise(x, y) * 0.6 + vnoise(x * 2.1 + 7, y * 2.1 + 3) * 0.28 + vnoise(x * 4.3 + 1, y * 4.3 + 9) * 0.12;
    }
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.strokeStyle = color;
  g.lineWidth = lineW;
  g.lineCap = 'round';
  for (let L = 0; L < levels; L++) {
    const iso = 0.22 + (0.56 * L) / (levels - 1);
    g.lineWidth = L % 5 === 0 ? lineW * 2 : lineW;
    g.beginPath();
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const v = [field[j * nx + i], field[j * nx + i + 1], field[(j + 1) * nx + i + 1], field[(j + 1) * nx + i]];
        const P = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
        const pts = [];
        for (let e = 0; e < 4; e++) {
          const a = v[e], b = v[(e + 1) % 4];
          if ((a < iso) !== (b < iso)) {
            const k = (iso - a) / (b - a);
            const pa = P[e], pb = P[(e + 1) % 4];
            pts.push([lerp(pa[0], pb[0], k) * cell, lerp(pa[1], pb[1], k) * cell]);
          }
        }
        for (let k = 0; k + 1 < pts.length; k += 2) {
          g.moveTo(pts[k][0], pts[k][1]);
          g.lineTo(pts[k + 1][0], pts[k + 1][1]);
        }
      }
    }
    g.stroke();
  }
  return c;
}

// Boucle du sentier : forme organique fermée (somme de sinusoïdes, déterministe).
function buildTrail(cx, cy, R) {
  const pts = [];
  const N = 480;
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI / 2 - (i / N) * Math.PI * 2;
    const r = R * (1 + 0.13 * Math.sin(2 * a + 0.6) + 0.08 * Math.sin(3 * a + 1.9) + 0.045 * Math.cos(5 * a + 0.4) + 0.02 * Math.sin(9 * a));
    pts.push([cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 1.22]);
  }
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, len, total: len[len.length - 1] };
}

function grainTiles() {
  const tiles = [];
  for (let k = 0; k < 6; k++) {
    const c = document.createElement('canvas');
    c.width = 540;
    c.height = 960;
    const g = c.getContext('2d');
    const im = g.createImageData(540, 960);
    const r = rng(1000 + k);
    for (let i = 0; i < im.data.length; i += 4) {
      const v = r() * 255;
      im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
      im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    tiles.push(c);
  }
  return tiles;
}

async function load() {
  const fonts = [
    new FontFace('Anton', 'url(../assets/fonts/Anton-latin.woff2)'),
    new FontFace('Archivo Narrow', 'url(../assets/fonts/ArchivoNarrow-latin.woff2)', { weight: '400 700' }),
  ];
  for (const f of fonts) document.fonts.add(await f.load());
  await document.fonts.ready;

  const [ring, text, dot] = await Promise.all(['ring', 'text', 'dot'].map((n) => loadImage(`../assets/logo/${n}.png`)));
  assets.ringPaper = tint(ring, C.paper);
  assets.textPaper = tint(text, C.paper);
  assets.ringForest = tint(ring, C.forest);
  assets.ringOrange = tint(ring, C.orange);
  assets.textForest = tint(text, C.forest);
  assets.contours = buildContours(W, H + 600, 7, 22, 'rgba(241,236,223,0.16)', 1.6);
  assets.trail = buildTrail(560, 730, 258);
  assets.grain = grainTiles();
  assets.timeline = await (await fetch('./timeline.json')).json();
}

// ---------------------------------------------------------------- éléments partagés

// Dessine l'anneau ensō révélé par un balayage angulaire (comme un coup de pinceau).
function enso(img, cx, cy, diameter, p) {
  if (p <= 0) return;
  const k = diameter / (LOGO.ringR * 2);
  const start = -78 * DEG;
  const end = start - p * 372 * DEG;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, diameter, start, end, true);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, cx - LOGO.ringC[0] * k, cy - LOGO.ringC[1] * k, img.width * k, img.height * k);
  ctx.restore();
}

// Point qui tombe puis s'écrase (squash & stretch amorti).
function droppingDot(cx, cy, r, t, tLand, fallDur, color) {
  const tf = t - (tLand - fallDur);
  if (tf < 0) return;
  let y = cy, sx = 1, sy = 1;
  if (t < tLand) {
    const u = tf / fallDur;
    y = lerp(cy - 1100, cy, u * u);
    sy = 1 + 0.25 * u;
    sx = 1 / sy;
  } else {
    const d = t - tLand;
    const q = 0.32 * Math.exp(-d * 7) * Math.cos(d * 22);
    sy = 1 - q;
    sx = 1 + q;
    y = cy + r * (1 - sy);
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, y, r * sx, r * sy, 0, 0, Math.PI * 2);
  ctx.fill();
}

function contours(offset, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const y = -(offset % 600);
  ctx.drawImage(assets.contours, 0, y);
  ctx.restore();
}

// ---------------------------------------------------------------- plans

const scenes = {};

// P1 — accroche : l'ensō se trace, le point tombe, on plonge dedans.
scenes.hook = (t) => {
  fillBg(C.forest);
  const cx = 540, cy = 900;
  const push = easeInCubic(prog(t, 1.5, 2.0));
  const zoom = Math.pow(26, push);
  const rot = lerp(5, 0, easeOutCubic(prog(t, 0, 0.9))) * DEG;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(zoom, zoom);
  ctx.rotate(rot);
  ctx.translate(-cx, -cy);

  contours(t * 30, 0.5);
  enso(assets.ringPaper, cx, cy, 960, 0.06 + 0.94 * easeOutCubic(prog(t, 0, 0.62)));

  const lp = sp(t - 0.3, 'ui');
  maskedText('LE CERCLE PRÉSENTE', 70, 250, { family: TEXT, size: 40, weight: 700, ls: 7, color: C.paper }, lp);
  maskedText('08.11.26', 1010, 250, { family: TEXT, size: 40, weight: 700, ls: 7, color: C.orange, align: 'right' }, sp(t - 0.38, 'ui'));
  maskedText('RANDONNÉE · PARC DU BANCO', 70, 1560, { family: TEXT, size: 40, weight: 700, ls: 7, color: C.paper }, sp(t - 0.46, 'ui'));

  droppingDot(cx, cy, 92, t, 1.0, 0.24, C.orange);
  ctx.restore();
};

// P2 — « 7 KM » : typographie massive sur l'orange.
scenes.km = (t) => {
  fillBg(C.orange);
  const drift = -t * 22;
  const s7 = 1480;
  const m7 = measure('7', { size: s7 });
  const rise = (1 - sp(t, 'type')) * 1300;
  const top = 300;
  const x7 = -24;
  text('7', x7, top + m7.asc + rise + drift, { size: s7, color: C.forest });

  const colX = x7 + m7.w + 34;
  const colW = W - 60 - colX;
  const sK = fitSize('KM', colW);
  const mK = measure('KM', { size: sK });
  maskedText('KM', colX, top + mK.asc + drift * 0.6, { size: sK, color: C.forest }, sp(t - 0.05, 'card'));

  const yA = top + mK.asc + 60 + drift * 0.6;
  hairline(colX, yA - 30, colX + colW, easeOutCubic(prog(t, 0.2, 0.6)), C.forest, 4);

  // « DE FORÊT / PRIMAIRE » en typo verticale qui remplit la colonne, sur le temps fort (3,0 s)
  const gap = 22;
  const capRatio = measure('E', { size: 100 }).asc / 100;
  const avail = 1500 + drift * 0.6 - yA;
  let sV = (colW - gap) / 2 / capRatio;
  const longest = Math.max(measure('DE FORÊT', { size: sV }).w, measure('PRIMAIRE', { size: sV }).w);
  if (longest > avail) sV *= avail / longest;
  const capV = sV * capRatio;
  ctx.save();
  ctx.translate(colX, yA + avail);
  ctx.rotate(-90 * DEG);
  maskedText('DE FORÊT', 0, capV, { size: sV, color: C.forest }, sp(t - 1.0, 'card'));
  maskedText('PRIMAIRE', 0, capV * 2 + gap, { size: sV, color: C.forest }, sp(t - 1.06, 'card'));
  ctx.restore();
};

// P3 — la carte : courbes de niveau, la boucle se trace.
scenes.map = (t) => {
  fillBg(C.forest);
  const cam = lerp(1.1, 1.0, sp(t, 'cam'));
  ctx.save();
  ctx.translate(540, 900);
  ctx.scale(cam, cam);
  ctx.translate(-540, -900);
  contours(120 + t * 45, 1);

  const tr = assets.trail;
  const p = easeInOutCubic(prog(t, 0.1, 2.3));
  const L = p * tr.total;
  ctx.strokeStyle = C.orange;
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let head = tr.pts[0];
  for (let i = 0; i < tr.pts.length; i++) {
    if (tr.len[i] > L) {
      const k = (L - tr.len[i - 1]) / (tr.len[i] - tr.len[i - 1]);
      head = [lerp(tr.pts[i - 1][0], tr.pts[i][0], k), lerp(tr.pts[i - 1][1], tr.pts[i][1], k)];
      ctx.lineTo(head[0], head[1]);
      break;
    }
    head = tr.pts[i];
    i === 0 ? ctx.moveTo(head[0], head[1]) : ctx.lineTo(head[0], head[1]);
  }
  if (p > 0) ctx.stroke();

  // départ
  const s0 = tr.pts[0];
  const sm = sp(t - 0.9, 'card');
  ctx.fillStyle = C.paper;
  ctx.beginPath();
  ctx.arc(s0[0], s0[1], 14 * sm, 0, Math.PI * 2);
  ctx.fill();
  hairline(s0[0] + 24, s0[1], s0[0] + 24 + 120, easeOutCubic(prog(t, 0.95, 1.2)), C.paper, 2);
  maskedText('DÉPART · 08H', s0[0] + 160, s0[1] + 12, { family: TEXT, size: 38, weight: 700, ls: 5, color: C.paper }, sp(t - 1.0, 'ui'));

  // la boucle se referme : onde depuis le départ
  const wv = prog(t, 2.3, 2.85);
  if (wv > 0 && wv < 1) {
    ctx.strokeStyle = C.orange;
    ctx.lineWidth = 6 * (1 - wv);
    ctx.beginPath();
    ctx.arc(s0[0], s0[1], 20 + 150 * easeOutCubic(wv), 0, Math.PI * 2);
    ctx.stroke();
  }
  if (p >= 1) {
    ctx.fillStyle = C.orange;
    ctx.beginPath();
    ctx.arc(s0[0], s0[1], 20, 0, Math.PI * 2);
    ctx.fill();
  }

  // coureur
  if (p > 0 && p < 1) {
    ctx.fillStyle = C.orange;
    ctx.strokeStyle = C.forest;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(head[0], head[1], 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  // typographie hors caméra
  const km = (7 * p).toFixed(1).replace('.', ',');
  text(`${km} KM`, 1010, 290, { size: 96, color: C.orange, align: 'right' });
  maskedText('ABIDJAN · CÔTE D’IVOIRE', 70, 250, { family: TEXT, size: 38, weight: 700, ls: 6, color: C.paper }, sp(t - 0.1, 'ui'));
  maskedText('5°23′N  4°03′W', 70, 292, { family: TEXT, size: 38, weight: 500, ls: 6, color: 'rgba(241,236,223,0.6)' }, sp(t - 0.18, 'ui'));

  const sB = fitSize('BANCO', 880);
  maskedText('PARC NATIONAL DU', 70, 1222, { family: TEXT, size: 46, weight: 700, ls: 12, color: C.paper }, sp(t - 0.04, 'ui'));
  maskedText('BANCO', 66, 1250 + measure('BANCO', { size: sB }).asc, { size: sB, color: C.paper }, sp(t, 'word'));

  // volet de sortie
  const wp = easeInCubic(prog(t, 2.72, 3.0));
  if (wp > 0) {
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, H * (1 - wp), W, H * wp);
  }
};

// P4 — rafale : un mot par temps, coupes sèches.
const BURST = [
  { w: 'MARCHE.', bg: C.paper, fg: C.forest, y: 760, t0: 0.0 },
  { w: 'RESPIRE.', bg: C.forest, fg: C.paper, y: 1110, t0: 0.5 },
  { w: 'PARTAGE.', bg: C.orange, fg: C.forest, y: 1440, t0: 1.0 },
  { w: 'ENSEMBLE.', bg: C.forest, fg: C.paper, y: 1060, t0: 1.5 },
];

function wordWithDot(word, x, y, size, color, dotColor, p) {
  const body = word.slice(0, -1);
  const m = measure(body, { size });
  maskedText(body, x, y, { size, color }, p);
  maskedText('.', x + m.w, y, { size, color: dotColor }, p);
}

scenes.burst = (t) => {
  if (t < 2.0) {
    const i = Math.min(3, Math.floor(t / 0.5));
    const b = BURST[i];
    const lt = t - b.t0;
    fillBg(b.bg);
    ctx.save();
    ctx.translate(shake(lt, 9), shake(lt - 0.01, 7));
    const size = fitSize(b.w, 950);
    wordWithDot(b.w, 62, b.y, size, b.fg, i === 3 ? C.orange : b.fg, sp(lt, 'word'));
    const lab = `0${i + 1} / 04`;
    text(lab, 70, 250, { family: TEXT, size: 38, weight: 700, ls: 6, color: b.fg });
    hairline(70, 280, 1010, 1, b.fg, 2);
    ctx.restore();
    return;
  }
  // empilement final
  const lt = t - 2.0;
  fillBg(C.forest);
  ctx.save();
  ctx.translate(0, shake(lt, 8));
  const lines = BURST.map((b) => b.w);
  const sizes = lines.map((w) => fitSize(w, 950));
  const ascs = lines.map((w, k) => measure(w, { size: sizes[k] }).asc);
  const gap = 26;
  const total = ascs.reduce((a, b) => a + b, 0) + gap * 3;
  let y = 900 - total / 2;
  lines.forEach((w, k) => {
    y += ascs[k];
    const p = sp(lt - k * 0.05, 'word');
    if (k < 3) {
      const m = measure(w, { size: sizes[k] });
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y - ascs[k] - 6, W, ascs[k] + 12);
      ctx.clip();
      ctx.font = font(DISPLAY, sizes[k]);
      ctx.textAlign = 'left';
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.paper;
      ctx.strokeText(w, 62, y + (1 - p) * (ascs[k] + 12));
      ctx.restore();
      void m;
    } else {
      wordWithDot(w, 62, y, sizes[k], C.orange, C.paper, p);
    }
    y += gap;
  });
  ctx.restore();
  text('04 / 04', 70, 250, { family: TEXT, size: 38, weight: 700, ls: 6, color: C.paper });
  hairline(70, 280, 1010, 1, C.paper, 2);
};

// P5 — la date : mise en page éditoriale.
scenes.date = (t) => {
  fillBg(C.paper);
  const dx = lerp(8, -8, t / 3);
  ctx.save();
  ctx.translate(dx, 0);
  const slide = (d) => (1 - sp(t - d, 'card')) * 140;

  maskedText('RENDEZ-VOUS', 70, 240, { family: TEXT, size: 40, weight: 700, ls: 8, color: C.forest }, sp(t, 'ui'));
  maskedText('2026', 1010, 240, { family: TEXT, size: 40, weight: 700, ls: 8, color: C.forest, align: 'right' }, sp(t - 0.04, 'ui'));
  hairline(70, 272, 1010, easeOutExpo(prog(t, 0, 0.5)), C.forest, 3);

  const sD = fitSize('DIMANCHE', 940);
  const mD = measure('DIMANCHE', { size: sD });
  const yD = 300 + mD.asc;
  ctx.save();
  ctx.translate(slide(0.06), 0);
  maskedText('DIMANCHE', 70, yD, { size: sD, color: C.forest }, sp(t - 0.06, 'card'));
  ctx.restore();

  const s08 = fitSize('08', 900);
  const m08 = measure('08', { size: s08 });
  const y08 = yD + 30 + m08.asc;
  maskedText('08', 64, y08, { size: s08, color: C.forest }, sp(t - 0.12, 'type'));

  const sN = fitSize('NOVEMBRE', 940);
  const mN = measure('NOVEMBRE', { size: sN });
  const yN = y08 + 30 + mN.asc;
  ctx.save();
  ctx.translate(slide(0.2), 0);
  maskedText('NOVEMBRE', 70, yN, { size: sN, color: C.orange }, sp(t - 0.2, 'card'));
  ctx.restore();

  // on entoure la date au pinceau, comme sur un calendrier (11,5 s)
  const ep = easeOutCubic(prog(t, 1.5, 1.95));
  if (ep > 0) {
    const ecx = 64 + m08.w / 2, ecy = y08 - m08.asc / 2;
    ctx.save();
    ctx.translate(ecx, ecy);
    ctx.rotate(-6 * DEG);
    ctx.scale(1, (m08.asc + 90) / 1090);
    ctx.translate(-ecx, -ecy);
    enso(assets.ringOrange, ecx, ecy, 1090, ep);
    ctx.restore();
  }

  const yL = yN + 36;
  hairline(70, yL, 1010, easeOutExpo(prog(t, 0.35, 0.85)), C.forest, 3);

  // horloge
  const ck = [130, yL + 96];
  const cs = sp(t - 0.45, 'card');
  ctx.strokeStyle = C.forest;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(ck[0], ck[1], 54 * cs, 0, Math.PI * 2);
  ctx.stroke();
  const steps = Math.floor(t * 2);
  const frac = t * 2 - steps;
  const ang = (steps + sp(frac / 2, 'ui')) * 30 * DEG - 90 * DEG;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ck[0], ck[1]);
  ctx.lineTo(ck[0] + Math.cos(ang) * 38 * cs, ck[1] + Math.sin(ang) * 38 * cs);
  ctx.moveTo(ck[0], ck[1]);
  ctx.lineTo(ck[0], ck[1] - 26 * cs);
  ctx.stroke();
  maskedText('DÉPART 08H00', 220, yL + 96 + 44, { size: 124, color: C.forest }, sp(t - 0.5, 'card'));
  ctx.restore();

  // iris de sortie depuis l'horloge
  const ip = easeInCubic(prog(t, 2.7, 3.0));
  if (ip > 0) {
    ctx.fillStyle = C.forest;
    ctx.beginPath();
    ctx.arc(ck[0] + dx, ck[1], ip * 2300, 0, Math.PI * 2);
    ctx.fill();
  }
};

// P6 — le ticket.
function barcode(x, y, w, h, color) {
  const r = rng(42);
  ctx.fillStyle = color;
  let cx = x;
  while (cx < x + w) {
    const bw = 2 + Math.floor(r() * 4) * 2;
    if (r() > 0.4) ctx.fillRect(cx, y, Math.min(bw, x + w - cx), h);
    cx += bw + 3;
  }
}

scenes.ticket = (t) => {
  fillBg(C.forest);
  contours(300 + t * 30, 0.55);

  const zoom = lerp(1.0, 1.05, easeInOutCubic(t / 3));
  ctx.save();
  ctx.translate(540, 900);
  ctx.scale(zoom, zoom);
  ctx.translate(-540, -900);

  const enter = sp(t, 'card');
  const rot = lerp(-9, 0, spring(t, 1.3, 0.5)) * DEG;
  const tw = 840, mainH = 820, stubH = 300, notch = 34;
  const x0 = 540 - tw / 2;
  const y0 = 320 + (1 - enter) * 1500 + 150 * sp(t - 1.55, 'card');

  // recul du ticket au détachement de la souche
  const tear = 1.5;
  const thud = shake(t - 2.0, 7);
  const recoil = thud + (t > tear ? -18 * Math.exp(-(t - tear) * 6) * Math.sin((t - tear) * 18) : 0);

  ctx.save();
  ctx.translate(540, y0 + mainH / 2);
  ctx.rotate(rot);
  ctx.translate(-540, -(y0 + mainH / 2));

  // corps principal
  ctx.save();
  ctx.translate(0, recoil);
  ctx.fillStyle = C.paper;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + tw, y0);
  ctx.lineTo(x0 + tw, y0 + mainH - notch);
  ctx.arc(x0 + tw, y0 + mainH, notch, -Math.PI / 2, Math.PI / 2, true);
  ctx.lineTo(x0 + tw, y0 + mainH);
  ctx.lineTo(x0, y0 + mainH);
  ctx.arc(x0, y0 + mainH, notch, Math.PI / 2, -Math.PI / 2, true);
  ctx.closePath();
  ctx.fill();

  const ix = x0 + 60;
  text('PARTICIPATION', ix, y0 + 100, { family: TEXT, size: 40, weight: 700, ls: 8, color: C.forest });
  hairline(ix, y0 + 190, x0 + tw - 60, easeOutExpo(prog(t, 0.1, 0.6)), C.forest, 3);

  const sP = fitSize('5 000', tw - 120);
  const mP = measure('5 000', { size: sP });
  const yP = y0 + 230 + mP.asc;
  maskedText('5 000', ix - 6, yP, { size: sP, color: C.forest }, sp(t - 0.12, 'type'));
  maskedText('FCFA', ix, yP + 190, { size: 170, color: C.orange }, sp(t - 0.2, 'card'));
  // tampon (15,0 s)
  const stT = 2.0;
  if (t > stT - 0.09) {
    const a = t < stT ? lerp(2.4, 1, easeInCubic(prog(t, stT - 0.09, stT))) : 1 + 0.07 * Math.exp(-(t - stT) * 9) * Math.cos((t - stT) * 30);
    const scx = x0 + tw - 150, scy = y0 + 110;
    ctx.save();
    ctx.translate(scx, scy);
    ctx.rotate(-14 * DEG);
    ctx.scale(a, a);
    ctx.globalCompositeOperation = 'multiply';
    enso(assets.ringOrange, 0, 0, 230, 1);
    text('08.11', 0, 22, { size: 74, color: C.orange, align: 'center' });
    text('BANCO', 0, 64, { family: TEXT, size: 26, weight: 700, ls: 6, color: C.orange, align: 'center' });
    ctx.restore();
  }
  maskedText('PAR PERSONNE', x0 + tw - 60, yP + 190, { family: TEXT, size: 36, weight: 700, ls: 6, color: C.forest, align: 'right' }, sp(t - 0.28, 'ui'));
  ctx.restore();

  // souche
  const st = Math.max(0, t - tear);
  const fall = st > 0 ? 0.5 * 3600 * st * st + 120 * st : 0;
  const srot = st > 0 ? (st * 14 + 3 * (1 - Math.exp(-st * 10))) * DEG : 0;
  const sy0 = y0 + mainH;
  ctx.save();
  ctx.translate(x0, sy0 + fall);
  ctx.rotate(srot);
  ctx.translate(-x0, -sy0);
  ctx.fillStyle = C.paper;
  ctx.beginPath();
  ctx.moveTo(x0 + notch, sy0);
  ctx.lineTo(x0 + tw - notch, sy0);
  ctx.arc(x0 + tw, sy0, notch, Math.PI, Math.PI / 2, true);
  ctx.lineTo(x0 + tw, sy0 + stubH);
  ctx.lineTo(x0, sy0 + stubH);
  ctx.lineTo(x0, sy0 + notch);
  ctx.arc(x0, sy0, notch, Math.PI / 2, 0, true);
  ctx.closePath();
  ctx.fill();
  // perforation
  ctx.fillStyle = C.forest;
  for (let px = x0 + notch + 20; px < x0 + tw - notch - 10; px += 26) ctx.fillRect(px, sy0 - 2, 12, 4);
  text('RANDONNÉE DU CERCLE', ix, sy0 + 110, { size: 64, color: C.forest });
  text('DIM. 08 NOV · 08H00 · BANCO', ix, sy0 + 168, { family: TEXT, size: 38, weight: 700, ls: 5, color: C.forest });
  barcode(ix, sy0 + 200, 420, 56, C.forest);
  text('7 KM', x0 + tw - 60, sy0 + 256, { size: 90, color: C.orange, align: 'right' });
  ctx.restore();

  ctx.restore();
  ctx.restore();
};

// P7 — appel à l'action.
scenes.cta = (t) => {
  fillBg(C.forest);
  const lc = [540, 520];
  const d = 600;
  const k = d / (LOGO.ringR * 2);
  enso(assets.ringPaper, lc[0], lc[1], d, easeOutCubic(prog(t, 0, 0.6)));

  // texte du logo : balayage gauche → droite
  const tp = easeInOutCubic(prog(t, 0.35, 0.85));
  if (tp > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(lc[0] - d / 2, lc[1] - d / 2, d * tp + 1, d);
    ctx.clip();
    ctx.drawImage(assets.textPaper, lc[0] - LOGO.ringC[0] * k, lc[1] - LOGO.ringC[1] * k, 1280 * k, 1280 * k);
    ctx.restore();
  }
  const dc = [lc[0] + (LOGO.dotC[0] - LOGO.ringC[0]) * k, lc[1] + (LOGO.dotC[1] - LOGO.ringC[1]) * k];
  droppingDot(dc[0], dc[1], LOGO.dotR * k, t, 1.0, 0.24, C.orange);

  const s1 = 150;
  const y1 = 950;
  maskedText('ENTRE DANS', 540, y1, { size: s1, color: C.paper, align: 'center' }, sp(t - 1.0, 'card'));
  const m2 = measure('LE CERCLE.', { size: s1 });
  const p2 = sp(t - 1.15, 'card');
  const x2 = 540 - m2.w / 2;
  maskedText('LE CERCLE', x2, y1 + 160, { size: s1, color: C.paper }, p2);
  maskedText('.', x2 + measure('LE CERCLE', { size: s1 }).w, y1 + 160, { size: s1, color: C.orange }, p2);

  const yW = 1220;
  hairline(70, yW - 70, 1010, easeOutExpo(prog(t, 1.5, 2.0)), 'rgba(241,236,223,0.35)', 2);
  const lp = sp(t - 1.6, 'ui');
  // bulle de discussion
  ctx.save();
  ctx.globalAlpha = clamp(lp);
  const bx = 92, by = yW - 13;
  ctx.fillStyle = C.orange;
  ctx.beginPath();
  ctx.arc(bx, by, 20, 0, Math.PI * 2);
  ctx.moveTo(bx - 16, by + 12);
  ctx.lineTo(bx - 22, by + 26);
  ctx.lineTo(bx - 4, by + 19);
  ctx.fill();
  ctx.restore();
  maskedText('INSCRIPTIONS SUR WHATSAPP', 130, yW, { family: TEXT, size: 38, weight: 700, ls: 6, color: C.orange }, lp);

  const num = '+225 07 08 21 42 54';
  const sNum = fitSize(num, 940);
  const mNum = measure(num, { size: sNum });
  maskedText(num, 70, yW + 40 + mNum.asc, { size: sNum, color: C.paper }, sp(t - 1.75, 'card'));
  const yI = yW + 40 + mNum.asc + 40;
  hairline(70, yI, 1010, easeOutExpo(prog(t, 1.85, 2.3)), 'rgba(241,236,223,0.35)', 2);
  maskedText('DIM. 08 NOV · DÉPART 08H00', 70, yI + 58, { family: TEXT, size: 40, weight: 700, ls: 4, color: C.paper }, sp(t - 1.9, 'ui'));
  maskedText('PARC DU BANCO · 5 000 FCFA', 70, yI + 110, { family: TEXT, size: 40, weight: 700, ls: 4, color: C.paper }, sp(t - 1.96, 'ui'));
};

// ---------------------------------------------------------------- horloge maîtresse

function drawGrain(t) {
  const f = Math.floor(t * 60);
  const tile = assets.grain[f % assets.grain.length];
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.globalCompositeOperation = 'overlay';
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tile, 0, 0, W, H);
  ctx.restore();
}

function seek(t) {
  const tl = assets.timeline;
  t = clamp(t, 0, tl.duration - 1e-6);
  const s = tl.scenes.find((x) => t >= x.start && t < x.end) || tl.scenes[tl.scenes.length - 1];
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  scenes[s.id](t - s.start, t);
  ctx.restore();
  drawGrain(t);
}

window.ready = load().then(() => {
  window.seek = seek;
  window.duration = assets.timeline.duration;
  seek(0);
  const scrub = document.getElementById('scrub');
  scrub.addEventListener('input', () => seek(parseFloat(scrub.value)));
  if (new URLSearchParams(location.search).has('render')) document.body.classList.add('render');
  return true;
});
