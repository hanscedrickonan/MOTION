// Rendu image par image : Chromium (Playwright) → PNG → FFmpeg.
//
//   node tools/render.mjs video  [out/final.mp4]      vidéo complète + bande-son
//   node tools/render.mjs stills out/stills 1.0 2.5   images fixes aux instants donnés
//
// PAGE=src/demos.html rend une autre page (catalogue de démo) ; AUDIO=none désactive le son.
//
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };

function serve() {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

async function open() {
  const server = await serve();
  const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e));
  const pg = process.env.PAGE || 'src/index.html';
  await page.goto(`http://127.0.0.1:${server.address().port}/${pg}${pg.includes('?') ? '&' : '?'}render`);
  await page.evaluate(() => window.ready);
  const timeline = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/timeline.json'), 'utf8'));
  timeline.duration = await page.evaluate(() => window.duration);
  const frame = async (t) => {
    const url = await page.evaluate((t) => {
      window.seek(t);
      return document.getElementById('c').toDataURL('image/png');
    }, t);
    return Buffer.from(url.split(',')[1], 'base64');
  };
  return { frame, timeline, close: async () => { await browser.close(); server.close(); } };
}

const [mode = 'video', ...rest] = process.argv.slice(2);
const r = await open();

if (mode === 'stills') {
  const [dir, ...times] = rest;
  fs.mkdirSync(dir, { recursive: true });
  for (const ts of times) {
    const t = parseFloat(ts);
    fs.writeFileSync(path.join(dir, `t${t.toFixed(2).padStart(5, '0')}.png`), await r.frame(t));
  }
  console.log(`${times.length} images → ${dir}`);
} else if (mode === 'frames') {
  // toutes les images en PNG (pour la planche contact ou un débogage)
  const [dir, step = '1'] = rest;
  fs.mkdirSync(dir, { recursive: true });
  const { fps, duration } = r.timeline;
  for (let f = 0; f < Math.round(duration * fps); f += parseInt(step, 10)) {
    fs.writeFileSync(path.join(dir, `f${String(f).padStart(5, '0')}.png`), await r.frame(f / fps));
  }
} else {
  const out = rest[0] || path.join(ROOT, 'out/final.mp4');
  const audio = process.env.AUDIO === 'none' ? '' : process.env.AUDIO || path.join(ROOT, 'out/soundtrack.wav');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const { fps, duration } = r.timeline;
  const n = Math.round(duration * fps);
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-'];
  if (audio && fs.existsSync(audio)) args.push('-i', audio, '-c:a', 'aac', '-b:a', '192k', '-shortest');
  args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-level', '4.2',
    '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-movflags', '+faststart', out);
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = 0; f < n; f++) {
    const buf = await r.frame(f / fps);
    if (!ff.stdin.write(buf)) await new Promise((res) => ff.stdin.once('drain', res));
    if (f % 120 === 0) console.log(`image ${f}/${n} — ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))));
  console.log(`vidéo → ${out}`);
}
await r.close();
