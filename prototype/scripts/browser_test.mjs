// Run against a live local server. Uses installed Chromium when available.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const state = () => page.evaluate(async () => (await import('/frontend/app.js')).getDiagnostics());
const setSlider = (id, value) => page.locator(`#${id}`).evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input')); }, value);
const compare = async (a, b) => page.evaluate(async ([first, second]) => {
  async function decode(base64) {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
    const image = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    image.close();
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  }
  const left = await decode(first), right = await decode(second);
  let changed = 0, brighter = 0;
  for (let i = 0; i < left.length; i += 4) {
    const d = [right[i] - left[i], right[i + 1] - left[i + 1], right[i + 2] - left[i + 2]];
    if (Math.max(...d.map(Math.abs)) > 10) changed++;
    if ((d[0] + d[1] + d[2]) / 3 > 10) brighter++;
  }
  return { changed, brighter };
}, [a.toString('base64'), b.toString('base64')]);
const generate = async () => {
  const response = page.waitForResponse(r => r.url().endsWith('/api/terrain') && r.request().method() === 'POST');
  await page.locator('#generate').click();
  assert.equal((await response).status(), 200);
  await page.waitForFunction(() => document.querySelector('#loading').hidden && !document.querySelector('#generate').disabled);
};
try {
  await page.goto(process.env.LUNAR_TEST_URL || 'http://127.0.0.1:8000');
  await page.waitForFunction(() => ['Real DEM', 'Synthetic demo'].includes(document.querySelector('#render-status').textContent));
  const initial = await state();
  assert.equal(initial.gridSize, 257);
  assert.deepEqual(initial.landingPosition, [0, 0, 0]);
  assert(initial.triangles < 135000);
  assert.equal(await page.locator('#source-banner').isVisible(), initial.mode === 'synthetic');
  assert(await page.locator('#landing-label').isVisible());
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForFunction(() => document.querySelector('#inspection-text').textContent.includes('Elevation'));
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  assert((await page.locator('#inspection-text').innerText()).includes('PINNED'));
  const beforeStats = await page.locator('#stats').innerText();
  await page.locator('#exaggeration').evaluate(el => { el.value = '4'; el.dispatchEvent(new Event('input')); });
  assert.equal((await state()).exaggeration, 4);
  assert.deepEqual((await state()).landingPosition, [0, 0, 0]);
  assert.equal(await page.locator('#stats').innerText(), beforeStats);
  await page.locator('#exaggeration').evaluate(el => { el.value = '1'; el.dispatchEvent(new Event('input')); });
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.57, { steps: 6 });
  await page.mouse.up();
  assert.notDeepEqual((await state()).camera, initial.camera);
  await page.locator('#reset-view').click();
  mkdirSync('artifacts', { recursive: true });
  assert.equal((await state()).shadows, true);
  const shadowOn = await page.locator('canvas').screenshot({ path: 'artifacts/shadows-on.png' });
  await page.locator('#shadows').uncheck();
  assert.equal((await state()).shadows, false);
  const shadowOff = await page.locator('canvas').screenshot({ path: 'artifacts/shadows-off.png' });
  const shadowDifference = await compare(shadowOn, shadowOff);
  assert(shadowDifference.changed > 100, 'Shadow toggle must change terrain pixels.');
  assert(shadowDifference.brighter > 100, 'Disabling occlusion must brighten terrain pixels.');
  await page.locator('#shadows').check();
  await setSlider('sun-azimuth', 283);
  const reversed = await page.locator('canvas').screenshot({ path: 'artifacts/shadows-reversed.png' });
  assert((await compare(shadowOn, reversed)).changed > 1000, 'Sun azimuth must change the rendered terrain.');
  await setSlider('sun-elevation', -10);
  assert((await state()).sunDirection[1] < 0);
  await setSlider('sun-elevation', 90);
  assert(Math.abs((await state()).sunDirection[1] - 1) < 1e-10);
  await setSlider('sun-azimuth', 103);
  await setSlider('sun-elevation', 2.5);
  await page.screenshot({ path: 'artifacts/terrain-desktop.png' });
  await page.locator('#quality').selectOption('low');
  await page.locator('#radius').fill('2');
  await generate();
  assert.equal((await state()).gridSize, 129);
  assert((await page.locator('#view-metadata').innerText()).includes('Analysis radius: 2 km'));
  await page.locator('#quality').selectOption('high');
  await generate();
  assert.equal((await state()).gridSize, 513);
  assert((await state()).triangles < 525000);
  await page.locator('#mode').selectOption('synthetic');
  await page.locator('#quality').selectOption('medium');
  await page.locator('#radius').fill('5');
  await generate();
  assert(await page.locator('#source-banner').isVisible());
  assert((await page.locator('#source-banner').innerText()).includes('NOT REAL LUNAR DATA'));
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: 'artifacts/terrain-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: WebGL terrain, landing origin, inspection, camera, exaggeration, radius, all grid qualities, Sun extremes, shadow pixel changes, synthetic warning, and mobile layout.');
  console.log({ shadowDifference });
} finally { await browser.close(); }
