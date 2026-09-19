// Run: node tools/visual-test/render-regression.mjs [base URL]
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end(); return;
  }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wav': 'audio/wav' };
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
if (!process.argv[2]) await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = process.argv[2] || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/?q=standard&still&t=4&hud=0&post.grain=0`);
  await page.waitForFunction(() => window.GARGANTUA);
  assert.equal(await page.locator('#hud').isVisible(), false);
  assert.equal((await page.evaluate(() => GARGANTUA.getStats())).tier, 'standard');
  const output = '/tmp/blackhole-regression';
  fs.mkdirSync(output, { recursive: true });
  for (const preset of ['orbit', 'pole', 'edge', 'cine']) {
    await page.evaluate(p => GARGANTUA.setPreset(p), preset);
    const url = await page.evaluate(() => GARGANTUA.screenshot());
    const buf = Buffer.from(url.split(',')[1], 'base64');
    fs.writeFileSync(`${output}/${preset}.png`, buf);
    const png = PNG.sync.read(buf);
    assert(png.data.some((v, i) => i % 4 !== 3 && v > 40), `${preset}: visible emission`);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const tier of ['high', 'cinematic']) {
    await page.evaluate(q => { GARGANTUA.setPreset('orbit'); GARGANTUA.setQuality(q); }, tier);
    const url = await page.evaluate(() => GARGANTUA.screenshot());
    assert.equal((await page.evaluate(() => GARGANTUA.getStats())).tier, tier);
    const buf = Buffer.from(url.split(',')[1], 'base64');
    fs.writeFileSync(`${output}/${tier}.png`, buf);
    const png = PNG.sync.read(buf);
    let clipped = 0, warm = 0, dark = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const [r, g, b] = png.data.subarray(i, i + 3);
      if (Math.min(r, g, b) > 245) clipped++;
      if (r > b * 1.15 && r > 30) warm++;
      if (Math.max(r, g, b) < 12) dark++;
    }
    const pixels = png.width * png.height;
    assert(clipped / pixels < 0.12, `${tier}: highlights obscure disk detail`);
    assert(warm / pixels > 0.05, `${tier}: outer disk loses its color gradient`);
    assert(dark / pixels > 0.01, `${tier}: missing deep shadow`);
    console.log(`${tier}: clipped=${(clipped / pixels * 100).toFixed(1)}%, warm=${(warm / pixels * 100).toFixed(1)}%`);
  }
  // Exercise the actual GPU composite with constant HDR input, including zero.
  const samples = await page.evaluate(async () => {
    const { Pipeline } = await import('/src/core/renderer.js');
    const THREE = await import('three');
    const canvas = document.createElement('canvas');
    const pipeline = new Pipeline(canvas);
    pipeline.resize(8, 8, 1, false);
    pipeline.compMat.uniforms.uBloomStr.value = 0;
    pipeline.compMat.uniforms.uVignette.value = 0;
    pipeline.compMat.uniforms.uGrain.value = 0;
    pipeline.compMat.uniforms.uExposure.value = 1;
    const camera = new THREE.PerspectiveCamera();
    const result = [];
    for (const value of [0, 0.01, 0.18, 1, 4]) {
      pipeline.sceneMat.fragmentShader = `precision highp float; out vec4 fragColor; void main() { fragColor = vec4(vec3(${value.toFixed(3)}), 1.0); }`;
      pipeline.sceneMat.needsUpdate = true;
      pipeline.renderFrame(camera, 0, 0);
      const pixel = new Uint8Array(4);
      pipeline.gl.readPixels(4, 4, 1, 1, pipeline.gl.RGBA, pipeline.gl.UNSIGNED_BYTE, pixel);
      result.push({ value, rgb: Array.from(pixel.slice(0, 3)) });
    }
    pipeline.dispose();
    return result;
  });
  for (const { value: x, rgb } of samples) {
    const linear = Math.min(1, x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14));
    const srgb = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
    for (const v of rgb) assert(Math.abs(v - srgb * 255) < 3, `HDR ${x}: ${rgb}, expected ${srgb * 255}`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: GPU black level, HDR/sRGB reference values, URL quality/HUD, four presets and three quality tiers; no browser errors.');
  console.log(output);
} finally {
  await browser.close();
  server.close();
}
