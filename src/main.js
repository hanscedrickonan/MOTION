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
// Effets optionnels (catalogue de démo). Désactivés par défaut : la vidéo finale
// n'active que ceux qui ont été validés.
export const FX = {
  footprints: true,   // A1 empreintes de pas sur la boucle
  pathText: false,    // A5 texte qui suit le chemin
  compass: false,     // A10 boussole
  walkLetters: true,  // A3 « MARCHE. » qui marche
  breathe: true,      // A4 « RESPIRE. » qui respire
  hikers: true,       // A8 groupe de marcheurs
  typeNumber: false,  // A7 numéro tapé
  ctaRingDrawn: true, // l'ensō final est déjà là (il arrive par le raccord T1)
  photo: new URLSearchParams(location.search).get('photo'), // 'a' | 'b' | null : photo du Banco en fond
};

let nowT = 0; // temps global courant (pour le lent travelling de la photo de fond)

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
  if (color === C.forest && FX.photo && assets.photos) photoBg(assets.photos[FX.photo]);
}

// Photo du Banco traitée en ambiance : bichromie verte, flou léger, assombrie pour la lisibilité.
// Les sources font 450 px : on assume une image douce plutôt qu'une photo nette agrandie.
const PHOTO_K = 1.15;
function buildPhoto(img, focusX) {
  const c = document.createElement('canvas');
  c.width = Math.round(W * PHOTO_K);
  c.height = Math.round(H * PHOTO_K);
  const g = c.getContext('2d');
  const sh = img.height, sw = (sh * c.width) / c.height;
  const sx = clamp(img.width * focusX - sw / 2, 0, img.width - sw);
  g.filter = 'grayscale(1) contrast(1.3) brightness(1.05) blur(4px)';
  g.drawImage(img, sx, 0, sw, sh, -20, -20, c.width + 40, c.height + 40);
  g.filter = 'none';
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = '#3C8A62';
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = 'rgba(11,35,24,0.5)';
  g.fillRect(0, 0, c.width, c.height);
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, 'rgba(11,35,24,0.55)');
  grad.addColorStop(0.35, 'rgba(11,35,24,0)');
  grad.addColorStop(0.65, 'rgba(11,35,24,0)');
  grad.addColorStop(1, 'rgba(11,35,24,0.7)');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

function photoBg(ph) {
  // lent travelling avant sur toute la durée : on « marche » dans la forêt
  const u = nowT / (assets.timeline?.duration || 1);
  const sc = lerp(1 / PHOTO_K, 1, u) * PHOTO_K;
  const w = (ph.width * sc) / PHOTO_K, h = (ph.height * sc) / PHOTO_K;
  ctx.drawImage(ph, (W - w) / 2, (H - h) / 2, w, h);
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
  if (FX.photo) {
    const [pa, pb] = await Promise.all(['a', 'b'].map((n) => loadImage(`../assets/photos/banco_${n}.jpg`)));
    assets.photos = { a: buildPhoto(pa, 0.47), b: buildPhoto(pb, 0.45) };
  }
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
  ctx.globalAlpha = alpha * (FX.photo ? 0.4 : 1);
  const y = -(offset % 600);
  ctx.drawImage(assets.contours, 0, y);
  ctx.restore();
}

// Point du tracé à l'abscisse curviligne s : [x, y, angle de la tangente].
function trailAt(s) {
  const tr = assets.trail;
  s = clamp(s, 0, tr.total);
  let lo = 0, hi = tr.len.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    tr.len[m] < s ? (lo = m) : (hi = m);
  }
  const a = tr.pts[lo], b = tr.pts[hi];
  const k = (s - tr.len[lo]) / (tr.len[hi] - tr.len[lo] || 1);
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), Math.atan2(b[1] - a[1], b[0] - a[0])];
}

// A1 — empreintes alternées gauche / droite le long du tracé.
function footprints(L, t) {
  const step = 36;
  for (let s = 0, n = 0; s <= L; s += step, n++) {
    const [x, y, a] = trailAt(s);
    const side = n % 2 ? 1 : -1;
    const age = (L - s) / 260;
    const pop = clamp(age * 4);
    const px = x + Math.cos(a + Math.PI / 2) * 11 * side;
    const py = y + Math.sin(a + Math.PI / 2) * 11 * side;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a + side * 0.12);
    ctx.scale(pop, pop);
    ctx.fillStyle = C.orange;
    ctx.beginPath();
    ctx.ellipse(4, 0, 11, 6.5, 0, 0, Math.PI * 2);
    ctx.ellipse(-12, 0, 5.5, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  void t;
}

// A5 — texte qui court le long du chemin, à l'extérieur de la boucle.
function pathText(L, t) {
  const str = 'PARC NATIONAL DU BANCO · 7 KM · DIMANCHE 08H · ';
  ctx.font = font(TEXT, 30, 700);
  ctx.fillStyle = C.paper;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let s = (t * 70) % 40;
  let i = 0;
  while (s < L - 10) {
    const ch = str[i % str.length];
    const w = ctx.measureText(ch).width + 4;
    const [x, y, a] = trailAt(s + w / 2);
    ctx.save();
    ctx.translate(x + Math.cos(a - Math.PI / 2) * 30, y + Math.sin(a - Math.PI / 2) * 30);
    ctx.rotate(a);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    s += w;
    i++;
  }
}

// A10 — boussole : l'aiguille oscille (ressort peu amorti) puis se fige vers le Banco.
function compass(cx, cy, t) {
  const sc = sp(t - 0.2, 'card');
  if (sc <= 0) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(sc, sc);
  ctx.strokeStyle = C.paper;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 70, 0, Math.PI * 2);
  ctx.stroke();
  for (let k = 0; k < 12; k++) {
    const a = (k * 30) * DEG;
    const r0 = k % 3 === 0 ? 54 : 61;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * 67, Math.sin(a) * 67);
    ctx.stroke();
  }
  text('N', 0, -80, { family: TEXT, size: 28, weight: 700, color: C.paper, align: 'center' });
  const target = -38 * DEG, from = 150 * DEG;
  const ang = lerp(from, target, spring(t - 0.35, 0.9, 0.18));
  ctx.rotate(ang + Math.PI / 2);
  ctx.fillStyle = C.orange;
  ctx.beginPath();
  ctx.moveTo(0, -52); ctx.lineTo(10, 0); ctx.lineTo(-10, 0); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.paper;
  ctx.beginPath();
  ctx.moveTo(0, 52); ctx.lineTo(10, 0); ctx.lineTo(-10, 0); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.forest;
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();
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
  ctx.strokeStyle = FX.footprints ? 'rgba(255,91,31,0.22)' : C.orange;
  ctx.lineWidth = FX.footprints ? 4 : 10;
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
  if (FX.footprints) footprints(L, t);
  if (FX.pathText) pathText(L, t);

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
  if (p > 0 && p < 1 && !FX.footprints) {
    ctx.fillStyle = C.orange;
    ctx.strokeStyle = C.forest;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(head[0], head[1], 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
  if (FX.compass) compass(915, 1080, t);

  // typographie hors caméra
  const km = (7 * p).toFixed(1).replace('.', ',');
  text(`${km} KM`, 1010, 290, { size: 96, color: C.orange, align: 'right' });
  maskedText('ABIDJAN · CÔTE D’IVOIRE', 70, 250, { family: TEXT, size: 38, weight: 700, ls: 6, color: C.paper }, sp(t - 0.1, 'ui'));
  maskedText('5°23′N  4°03′W', 70, 292, { family: TEXT, size: 38, weight: 500, ls: 6, color: 'rgba(241,236,223,0.6)' }, sp(t - 0.18, 'ui'));

  const sB = fitSize('BANCO', 880);
  maskedText('PARC NATIONAL DU', 70, 1222, { family: TEXT, size: 46, weight: 700, ls: 12, color: C.paper }, sp(t - 0.04, 'ui'));
  maskedText('BANCO', 66, 1250 + measure('BANCO', { size: sB }).asc, { size: sB, color: C.paper }, sp(t, 'word'));

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

// A3 — chaque lettre entre en sautillant, puis « marche » sur place (balancement alterné).
function walkingWord(word, x, y, size, color, lt) {
  let cx = x;
  [...word].forEach((ch, j) => {
    const w = measure(ch, { size }).w;
    const d = j * 0.035;
    const e = sp(lt - d, 'word');
    const hop = -Math.sin(Math.PI * clamp((lt - d) / 0.16)) * 45;
    const bob = Math.sin(lt * 4 * Math.PI + j * Math.PI) * 5 * clamp((lt - d - 0.16) * 6);
    const tilt = Math.sin(lt * 4 * Math.PI + j * Math.PI) * 1.2 * DEG;
    if (lt - d > 0) {
      ctx.save();
      ctx.translate(cx + w / 2, y + hop + bob + (1 - e) * 260);
      ctx.rotate(tilt);
      text(ch, -w / 2, 0, { size, color });
      ctx.restore();
    }
    cx += w;
  });
}

// A8 — pictogramme de randonneur (style signalétique de sentier), cycle de marche.
function hiker(x, y, h, phase, color, stick) {
  const k = h / 160;
  const sw = Math.sin(phase);
  ctx.save();
  ctx.translate(x, y + Math.abs(Math.cos(phase)) * -4 * k);
  ctx.scale(k, k);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  // jambes
  ctx.lineWidth = 15;
  for (const sgn of [1, -1]) {
    const a = sgn * sw * 28 * DEG;
    ctx.beginPath();
    ctx.moveTo(0, -62);
    ctx.lineTo(Math.sin(a) * 30, -62 + Math.cos(a) * 30);
    ctx.lineTo(Math.sin(a * 0.6) * 30 + Math.sin(a) * 30, -2);
    ctx.stroke();
  }
  // sac à dos
  ctx.fillRect(-26, -128, 18, 46);
  // torse
  ctx.lineWidth = 22;
  ctx.beginPath();
  ctx.moveTo(4, -122);
  ctx.lineTo(0, -64);
  ctx.stroke();
  // bras
  ctx.lineWidth = 11;
  const aa = -sw * 30 * DEG;
  ctx.beginPath();
  ctx.moveTo(4, -114);
  ctx.lineTo(4 + Math.sin(aa) * 40, -114 + Math.cos(aa) * 40);
  ctx.stroke();
  if (stick) {
    ctx.lineWidth = 5;
    const hx = 4 + Math.sin(aa) * 40, hy = -114 + Math.cos(aa) * 40;
    ctx.beginPath();
    ctx.moveTo(hx, hy - 10);
    ctx.lineTo(hx + 22, 0);
    ctx.stroke();
  }
  // tête
  ctx.beginPath();
  ctx.arc(8, -146, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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
    if (FX.walkLetters && i === 0) {
      walkingWord(b.w, 62, b.y, size, b.fg, lt);
    } else if (FX.breathe && i === 1) {
      // A4 — inspiration / expiration
      const br = Math.sin(Math.PI * clamp((lt - 0.06) / 0.42));
      const cx = 62 + 475, cy = b.y - size * 0.36;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1 + 0.04 * br, 1 + 0.24 * br);
      ctx.translate(-cx, -cy);
      wordWithDot(b.w, 62, b.y, size, b.fg, b.fg, sp(lt, 'word'));
      ctx.restore();
    } else {
      wordWithDot(b.w, 62, b.y, size, b.fg, i === 3 ? C.orange : b.fg, sp(lt, 'word'));
    }
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
  let y = (FX.hikers ? 800 : 900) - total / 2;
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
  if (FX.hikers) {
    const gy = 1500;
    hairline(0, gy + 2, W, easeOutExpo(prog(lt, 0, 0.4)), 'rgba(241,236,223,0.35)', 2);
    for (let k = 0; k < 6; k++) {
      const x = -140 + k * 190 + lt * 150 - (1 - sp(lt - k * 0.04, 'card')) * 260;
      hiker(x, gy, 150 + (k % 2) * 12, lt * 2 * Math.PI * 1.6 + k * 1.7, k === 3 ? C.orange : C.paper, k % 2 === 0);
    }
  }
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
  enso(assets.ringPaper, lc[0], lc[1], d, FX.ctaRingDrawn ? 1 : easeOutCubic(prog(t, 0, 0.6)));

  // texte du logo : balayage gauche → droite
  const tp = FX.ctaRingDrawn ? easeInOutCubic(prog(t, 0.05, 0.5)) : easeInOutCubic(prog(t, 0.35, 0.85));
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
  if (FX.typeNumber) {
    const n = clamp(Math.floor((t - 1.7) / 0.05) + 1, 0, num.length);
    const shown = num.slice(0, n);
    const yN = yW + 40 + mNum.asc;
    text(shown, 70, yN, { size: sNum, color: C.paper });
    const typing = n < num.length;
    if (t > 1.6 && (typing || Math.floor(t * 3) % 2 === 0) && t < 3.2) {
      const cx = 70 + measure(shown, { size: sNum }).w + 10;
      ctx.fillStyle = C.orange;
      ctx.fillRect(cx, yN - mNum.asc, 8, mNum.asc);
    }
  } else {
    maskedText(num, 70, yW + 40 + mNum.asc, { size: sNum, color: C.paper }, sp(t - 1.75, 'card'));
  }
  const yI = yW + 40 + mNum.asc + 40;
  hairline(70, yI, 1010, easeOutExpo(prog(t, 1.85, 2.3)), 'rgba(241,236,223,0.35)', 2);
  maskedText('DIM. 08 NOV · DÉPART 08H00', 70, yI + 58, { family: TEXT, size: 40, weight: 700, ls: 4, color: C.paper }, sp(t - 1.9, 'ui'));
  maskedText('PARC DU BANCO · 5 000 FCFA', 70, yI + 110, { family: TEXT, size: 40, weight: 700, ls: 4, color: C.paper }, sp(t - 1.96, 'ui'));
};

// A6 — discussion WhatsApp : question reçue, réponse envoyée, coches qui passent à l'orange.
function bubble(x, y, w, h, color, tailRight, p) {
  if (p <= 0) return;
  const ox = tailRight ? x + w : x, oy = y + h;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(p, p);
  ctx.translate(-ox, -oy);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 34);
  ctx.moveTo(tailRight ? x + w - 30 : x + 30, y + h);
  ctx.lineTo(tailRight ? x + w + 18 : x - 18, y + h + 4);
  ctx.lineTo(tailRight ? x + w - 4 : x + 4, y + h - 34);
  ctx.fill();
  ctx.restore();
}

function ticks(x, y, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const dx of [0, 16]) {
    ctx.beginPath();
    ctx.moveTo(x + dx, y);
    ctx.lineTo(x + dx + 9, y + 9);
    ctx.lineTo(x + dx + 26, y - 10);
    ctx.stroke();
  }
}

scenes.chat = (t) => {
  fillBg(C.forest);
  contours(200 + t * 25, 0.45);
  maskedText('INSCRIPTIONS SUR WHATSAPP', 70, 250, { family: TEXT, size: 40, weight: 700, ls: 6, color: C.orange }, sp(t, 'ui'));
  hairline(70, 282, 1010, easeOutExpo(prog(t, 0, 0.5)), 'rgba(241,236,223,0.35)', 2);

  const f = { family: TEXT, size: 74, weight: 700 };
  // reçu
  const p1 = sp(t - 0.1, 'card');
  bubble(70, 520, 900, 300, C.canopy, false, p1);
  if (p1 > 0.6) {
    text('Dimanche 8h au Banco,', 125, 640, { ...f, color: C.paper });
    text('tu viens ?', 125, 735, { ...f, color: C.paper });
    text('07:58', 925, 795, { family: TEXT, size: 32, weight: 500, color: 'rgba(241,236,223,0.55)', align: 'right' });
  }
  // en train d'écrire
  if (t > 0.65 && t < 1.15) {
    bubble(770, 960, 240, 140, C.paper, true, sp(t - 0.65, 'ui'));
    for (let k = 0; k < 3; k++) {
      const yy = 1030 - Math.max(0, Math.sin((t * 10 - k * 0.8) * Math.PI / 2)) * 16;
      ctx.fillStyle = C.forest;
      ctx.beginPath();
      ctx.arc(840 + k * 50, yy, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // envoyé
  const p2 = sp(t - 1.15, 'card');
  bubble(150, 960, 860, 300, C.orange, true, p2);
  if (p2 > 0.6) {
    text('Je m’inscris !', 205, 1145, { family: DISPLAY, size: fitSize('Je m’inscris !', 740), color: C.forest });
    text('07:59', 895, 1232, { family: TEXT, size: 32, weight: 500, color: C.forest, align: 'right' });
    ticks(915, 1222, t > 1.8 ? C.paper : 'rgba(11,35,24,0.5)');
  }
};

// ---------------------------------------------------------------- tampons hors écran

const buffers = {};
function buffer(name) {
  if (!buffers[name]) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    buffers[name] = c;
  }
  return buffers[name];
}

// Dessine un plan sur le canvas principal puis le copie dans un tampon.
function shot(name, id, t) {
  ctx.save();
  scenes[id](t);
  ctx.restore();
  const b = buffer(name);
  const g = b.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.drawImage(canvas, 0, 0);
  return b;
}

// ---------------------------------------------------------------- outils de transition

// Trait de pinceau sec : une bande de « poils » de longueurs inégales, inclinée.
const BRISTLES = (() => {
  const r = rng(77);
  return Array.from({ length: 110 }, () => ({ lag: r() * 340 + (r() > 0.85 ? 200 : 0), gap: r() > 0.93 }));
})();
function brushPath(p, angle) {
  const n = BRISTLES.length;
  const band = 2900;
  const hgt = band / n;
  const m = ctx.getTransform();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(angle);
  ctx.beginPath();
  BRISTLES.forEach((b, i) => {
    const head = -1500 + p * 3400 - b.lag;
    if (head > -1500 && !(b.gap && p < 0.97)) ctx.rect(-1500, -band / 2 + i * hgt, head + 1500, hgt + 1.2);
  });
  ctx.setTransform(m);
}

// Feuille tropicale (silhouette + nervures).
function leaf(x, y, len, rot, body, vein) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(len, len);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0, -1);
  ctx.bezierCurveTo(0.46, -0.55, 0.42, 0.55, 0, 1);
  ctx.bezierCurveTo(-0.42, 0.55, -0.46, -0.55, 0, -1);
  ctx.fill();
  ctx.strokeStyle = vein;
  ctx.lineWidth = 0.018;
  ctx.beginPath();
  ctx.moveTo(0, -0.95);
  ctx.lineTo(0, 1.25);
  for (let k = -3; k <= 3; k++) {
    const yy = k * 0.24;
    ctx.moveTo(0, yy);
    ctx.quadraticCurveTo(0.18, yy - 0.12, 0.33, yy - 0.3 + Math.abs(k) * 0.05);
    ctx.moveTo(0, yy);
    ctx.quadraticCurveTo(-0.18, yy - 0.12, -0.33, yy - 0.3 + Math.abs(k) * 0.05);
  }
  ctx.stroke();
  ctx.restore();
}

const LEAVES = (() => {
  const r = rng(31);
  const cols = [['#06150E', '#123426'], ['#0E2C1F', '#1D4A36'], ['#143B2B', '#25573F']];
  return Array.from({ length: 14 }, (_, i) => {
    const a = r() * Math.PI * 2;
    return {
      a, d: 0.15 + r() * 0.55, t0: 0.35 + i * 0.045 + r() * 0.08,
      rot: a + Math.PI / 2 + (r() - 0.5) * 0.9, col: cols[i % 3], len: 0.7 + r() * 0.6,
    };
  });
})();

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

// ---------------------------------------------------------------- transitions entre plans
// Chaque transition remplace le rendu des plans pendant sa fenêtre [a, b).
// Les temps sont lus dans la timeline (début des plans) pour rester synchrones.

const at = (id) => assets.timeline.scenes.find((x) => x.id === id).start;

const TRANSITIONS = [
  // T3 — traversée de canopée : 7 KM → carte
  { a: () => at('map') - 0.7, b: () => at('map') + 0.75, draw(t) {
    const o = at('map') - 1.05;
    if (t < at('map')) scenes.km(t - at('km'));
    else scenes.map(t - at('map'));
    for (const lf of LEAVES) {
      const u = (t - o - lf.t0) / 0.75;
      if (u <= 0 || u >= 1) continue;
      const z = Math.pow(u, 2.2);
      const r = lf.d * 900 + z * 2600;
      leaf(W / 2 + Math.cos(lf.a) * r, H / 2 + Math.sin(lf.a) * r * 1.2, (300 + z * 2600) * lf.len, lf.rot + z * 0.4, lf.col[0], lf.col[1]);
    }
  } },
  // T4 — plongée dans le « O » de BANCO : carte → rafale
  { a: () => at('burst') - 0.55, b: () => at('burst'), draw(t) {
    const sB = fitSize('BANCO', 880);
    const asc = measure('BANCO', { size: sB }).asc;
    const ox = 66 + measure('BANC', { size: sB }).w;
    const ow = measure('O', { size: sB }).w;
    const cx = ox + ow / 2, cy = 1250 + asc / 2;
    const s = easeInCubic(prog(t, at('burst') - 0.55, at('burst')));
    const Z = Math.pow(34, s);
    const b = shot('next', 'burst', 0);
    fillBg(C.forest);
    ctx.save();
    ctx.translate(lerp(cx, W / 2, s), lerp(cy, H / 2, s));
    ctx.scale(Z, Z);
    ctx.translate(-cx, -cy);
    scenes.map(t - at('map'));
    const cw = ow * 0.36, ch = asc * 0.66;
    ctx.beginPath();
    ctx.roundRect(cx - cw / 2, cy - ch / 2, cw, ch, cw / 2);
    ctx.restore();
    ctx.save();
    ctx.clip();
    ctx.drawImage(b, 0, 0);
    ctx.restore();
  } },
  // T2 — coup de pinceau : rafale → date
  { a: () => at('date') - 0.3, b: () => at('date') + 0.35, draw(t) {
    const t0 = at('date');
    const p1 = easeInOutCubic(prog(t, t0 - 0.3, t0));
    const p2 = easeInOutCubic(prog(t, t0, t0 + 0.35));
    const nx = p2 > 0 ? shot('next', 'date', t - t0) : null;
    scenes.burst(Math.min(t, t0 - 1e-3) - at('burst'));
    ctx.save();
    brushPath(p1, -11 * DEG);
    ctx.fillStyle = C.orange;
    ctx.fill();
    ctx.restore();
    if (nx) {
      ctx.save();
      brushPath(p2, 9 * DEG);
      ctx.clip();
      ctx.drawImage(nx, 0, 0);
      ctx.restore();
    }
  } },
  // T1 — raccord par le cercle : le tampon du ticket devient l'ensō de la signature
  { a: () => at('cta') - 0.65, b: () => at('cta'), draw(t) {
    const z0 = [804, 579], z1 = [540, 520];
    const s = easeInOutCubic(prog(t, at('cta') - 0.65, at('cta')));
    const Z = lerp(1, 600 / 236, s);
    fillBg(C.forest);
    ctx.save();
    ctx.translate(lerp(z0[0], z1[0], s), lerp(z0[1], z1[1], s));
    ctx.scale(Z, Z);
    ctx.rotate(lerp(0, 14, s) * DEG);
    ctx.translate(-z0[0], -z0[1]);
    scenes.ticket(Math.min(t - at('ticket'), 2.34)); // figé : le tampon reste sous la caméra
    ctx.restore();
  } },
];

function seek(t) {
  const tl = assets.timeline;
  t = clamp(t, 0, tl.duration - 1e-6);
  nowT = t;
  const s = tl.scenes.find((x) => t >= x.start && t < x.end) || tl.scenes[tl.scenes.length - 1];
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const tr = TRANSITIONS.find((x) => t >= x.a() && t < x.b());
  if (tr) tr.draw(t);
  else scenes[s.id](t - s.start, t);
  ctx.restore();
  drawGrain(t);
}

export {
  ctx, canvas, W, H, C, DISPLAY, TEXT, DEG, LOGO, assets, scenes,
  clamp, lerp, prog, easeOutCubic, easeInCubic, easeInOutCubic, easeOutExpo,
  spring, sp, rng, shake, text, measure, fitSize, maskedText, fillBg, hairline, enso, drawGrain,
  buffer, shot, brushPath, leaf, LEAVES,
};

window.ready = load().then(() => {
  window.seek = seek;
  window.duration = assets.timeline.duration;
  seek(0);
  const scrub = document.getElementById('scrub');
  scrub.addEventListener('input', () => seek(parseFloat(scrub.value)));
  if (new URLSearchParams(location.search).has('render')) document.body.classList.add('render');
  return true;
});
