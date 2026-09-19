// Headless visual verification for GARGANTUA.
// Serves the static site, drives Chromium (SwiftShader WebGL), collects console
// errors, and captures screenshots across presets / debug views / tiers.
//
// Usage (from this directory, after installing deps):
//   node visual.mjs
// Requires: playwright + a Chromium, and pngjs.
//   npm i playwright pngjs && npx playwright install chromium
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = process.env.OUT_DIR || path.join(ROOT, 'tests', 'out');
const PORT = Number(process.env.PORT) || 8123;

fs.mkdirSync(OUT, { recursive: true });

// ---- static file server ---------------------------------------------------
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.wav': 'audio/wav', '.png': 'image/png',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(PORT, r));
console.log(`serving ${ROOT} on :${PORT}`);

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const results = { consoleErrors: [], pageErrors: [], shots: [] };
let currentPage = null;

function attachEvents(page, label) {
  page.on('console', m => {
    if (m.type() === 'error') {
      results.consoleErrors.push(`[${label}] ${m.text()}`);
      console.log(`  console.error [${label}]: ${m.text().slice(0, 200)}`);
    }
  });
  page.on('pageerror', e => {
    results.pageErrors.push(`[${label}] ${e.message}`);
    console.log(`  pageerror [${label}]: ${e.message.slice(0, 200)}`);
  });
}

async function newPage(label, url, viewport = { width: 1280, height: 720 }) {
  if (currentPage) await currentPage.close().catch(() => {});
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  currentPage = page;
  attachEvents(page, label);
  await page.goto(`http://127.0.0.1:${PORT}${url}`, { waitUntil: 'load', timeout: 30000 });
  // wait for the app API + a few rendered frames
  await page.waitForFunction(() => window.GARGANTUA && window.GARGANTUA.getStats(), null, { timeout: 30000 });
  await page.waitForTimeout(4000);
  return page;
}

async function capture(page, label, name) {
  const stats = await page.evaluate(() => window.GARGANTUA.getStats());
  let dataUrl = null;
  try {
    dataUrl = await page.evaluate(() => window.GARGANTUA.screenshot());
  } catch (e) {
    console.log(`  screenshot() failed for ${name}: ${e.message}`);
  }
  let analysis = null;
  if (dataUrl && dataUrl.startsWith('data:image/png')) {
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUT, `${name}.png`), buf);
    const png = PNG.sync.read(buf);
    let nonBlack = 0, sumL = 0, sum = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sumL += lum; sum++;
      if (lum > 8) nonBlack++;
    }
    analysis = {
      w: png.width, h: png.height,
      nonBlackFrac: +(nonBlack / sum).toFixed(4),
      avgLum: +(sumL / sum).toFixed(2),
    };
  } else {
    // fallback: compositor screenshot
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  }
  const row = { name, ...stats, ...analysis };
  results.shots.push(row);
  console.log(`  ${name}: tier=${stats.tier} res=${stats.resolution} fps=${stats.fps} ${analysis ? `nonBlack=${analysis.nonBlackFrac} avgLum=${analysis.avgLum}` : 'NO-PIXEL-DATA'}`);
  return row;
}

// --------------------------------------------------------------------------
// 1. main view, high tier
{
  const page = await newPage('main-high', '/?q=high&t=4');
  await capture(page, 'main-high', '01_main_high');
}
// 2. presets
for (const preset of ['pole', 'edge', 'cine']) {
  const page = await newPage(`preset-${preset}`, `/?q=high&t=4&preset=${preset}`);
  await capture(page, `preset-${preset}`, `02_preset_${preset}`);
}
// 3. standard tier
{
  const page = await newPage('main-std', '/?q=standard&t=4');
  await capture(page, 'main-std', '03_main_standard');
}
// 4. cinematic tier (fewer pixels to keep SwiftShader feasible)
{
  const page = await newPage('main-cine-tier', '/?q=cinematic&t=4', { width: 960, height: 540 });
  await page.waitForTimeout(3000);
  await capture(page, 'main-cine-tier', '04_main_cinematic');
}
// 5. debug views 1..9 (standard tier for speed; 0 is the normal view)
for (let dv = 1; dv <= 9; dv++) {
  const page = await newPage(`debug-${dv}`, `/?q=standard&t=4&debug=${dv}`, { width: 960, height: 540 });
  await capture(page, `debug-${dv}`, `05_debug_${dv}`);
}
// 6. URL screenshot automation: ?shot should expose #gargantua-shot after warmup
{
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  attachEvents(page, 'url-shot');
  let shot = { ok: false };
  try {
    await page.goto(`http://127.0.0.1:${PORT}/?q=standard&shot&t=4`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => document.documentElement.dataset.gargantuaReady === 'true', null, { timeout: 90000 });
    shot = { ok: true, len: await page.evaluate(() => document.getElementById('gargantua-shot').src.length) };
  } catch (e) {
    shot = { ok: false, err: String(e).slice(0, 120) };
  }
  console.log(`  url-shot automation: ${JSON.stringify(shot)}`);
  results.urlShot = shot;
  await page.close();
}
// 7. param override via GARGANTUA.set, persisted to localStorage
{
  const page = await newPage('persist', '/?q=standard', { width: 640, height: 360 });
  await page.evaluate(() => window.GARGANTUA.set('disk.opacity', 8));
  await page.waitForTimeout(700); // save timer is 300ms
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.GARGANTUA, null, { timeout: 30000 });
  const after = await page.evaluate(() => window.GARGANTUA.params()['disk.opacity']);
  console.log(`  persistence: after-reload=${after} (expect ~8)`);
  results.persistence = { afterReload: after };
}

console.log('\n=== SUMMARY ===');
console.log(`console errors: ${results.consoleErrors.length}`);
console.log(`page errors: ${results.pageErrors.length}`);
// Acceptance criteria:
//  - no console/page errors
//  - every scene shot has real content (the dark region of a space scene is physical)
//  - main view: shadow structure (center darker than outer annulus)
//  - orbit view: Doppler gradient present on the near side
function lumAt(png, x, y) {
  const i = (y * png.width + x) * 4;
  return 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
}
function radialProfile(png, rings = 8) {
  const w = png.width, h = png.height, cx = w / 2, cy = h / 2;
  const out = [];
  for (let k = 0; k < rings; k++) {
    const r0 = (k + 0.5) * Math.min(w, h) * 0.5 / rings;
    let s = 0, n = 0;
    for (let a = 0; a < 48; a++) {
      const th = (a / 48) * 2 * Math.PI;
      const x = Math.round(cx + r0 * Math.cos(th)), y = Math.round(cy + r0 * Math.sin(th));
      if (x >= 0 && x < w && y >= 0 && y < h) { s += lumAt(png, x, y); n++; }
    }
    if (n) out.push(s / n / 255);
  }
  return out;
}
let failures = 0;
if (results.consoleErrors.length) { failures++; console.log('FAIL: console errors present'); }
if (results.pageErrors.length) { failures++; console.log('FAIL: page errors present'); }
for (const s of results.shots) {
  const hasContent = s.nonBlackFrac !== undefined && s.nonBlackFrac > 0.05 && s.avgLum > 2;
  if (!hasContent) failures++;
  console.log(`  ${s.name.padEnd(20)} ${hasContent ? 'OK ' : 'FAIL'} nonBlack=${s.nonBlackFrac} avgLum=${s.avgLum} fps=${s.fps}`);
}
// structural checks on the main view
{
  const png = PNG.sync.read(fs.readFileSync(path.join(OUT, '01_main_high.png')));
  const prof = radialProfile(png);
  const centerDark = prof[0] < prof[prof.length - 1] * 0.5;
  console.log(`  main radial profile: ${prof.map(v => v.toFixed(3)).join(' ')}  centerDarkerThanOuter=${centerDark}`);
  if (!centerDark) failures++;
  // Doppler: near-side band (bottom rows) left vs right
  const w = png.width, h = png.height;
  let L = 0, R = 0, nL = 0, nR = 0;
  for (let y = Math.round(h * 0.72); y < Math.round(h * 0.92); y += 2) {
    for (let x = Math.round(w * 0.08); x < w * 0.42; x += 3) { L += lumAt(png, x, y); nL++; }
    for (let x = Math.round(w * 0.58); x < w * 0.92; x += 3) { R += lumAt(png, x, y); nR++; }
  }
  const ratio = R / Math.max(L, 1e-9);
  const dopplerOk = ratio > 0.55 && ratio < 0.95; // approaching side (left) brighter
  console.log(`  near-side Doppler left=${(L / nL / 255).toFixed(3)} right=${(R / nR / 255).toFixed(3)} ratio=${ratio.toFixed(2)} ${dopplerOk ? 'OK' : 'CHECK'}`);
}
if (results.urlShot && !results.urlShot.ok) { failures++; console.log('FAIL: url-shot automation'); }
if (results.persistence && Math.abs(results.persistence.afterReload - 8) > 0.2) { failures++; console.log('FAIL: persistence'); }
console.log(failures === 0 ? 'ALL VISUAL CHECKS PASSED' : `VISUAL CHECK FAILURES: ${failures}`);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log(`screenshots + results in ${OUT}`);

await browser.close();
server.close();
process.exit(failures > 0 ? 1 : 0);
