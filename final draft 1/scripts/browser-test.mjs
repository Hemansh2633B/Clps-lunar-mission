import { chromium as pw } from 'playwright';
import sparticuz from '@sparticuz/chromium';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

// The sandbox blocks Playwright's CDN. @sparticuz/chromium ships an npm-distributed
// binary plus Amazon Linux 2023 shared libraries; extract them once if missing.
const LIB = '/tmp/al2023/lib';
if (!existsSync(join(LIB, 'libnss3.so'))) {
  const bin = 'node_modules/@sparticuz/chromium/bin';
  for (const [file, dir] of [['al2023.tar.br', '/tmp/al2023'], ['fonts.tar.br', '/tmp/fonts']]) {
    mkdirSync(dir, { recursive: true });
    const tarPath = `/tmp/${file.replace('.br', '')}`;
    writeFileSync(tarPath, brotliDecompressSync(readFileSync(join(bin, file))));
    execSync(`tar -xf ${tarPath} -C ${dir}`);
  }
}

const exe = process.env.CHROMIUM_PATH || (await sparticuz.executablePath());
const browser = await pw.launch({
  executablePath: exe,
  args: sparticuz.args,
  headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || '/tmp/al2023/lib', FONTCONFIG_PATH: '/tmp/fonts' },
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(String(e)));
const assert = (cond, msg) => { if (!cond) throw new Error(`ASSERT FAILED: ${msg}`); };
const setRange = (locator, value) => locator.evaluate((el, v) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, value);


try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=SELENE');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/01-workspace.png` });
  assert(await page.locator('.site-item').count() >= 10, 'catalog has 10+ sites');

  await page.locator('.site-item', { hasText: 'Apollo 11' }).click();
  await page.waitForTimeout(900);
  assert(await page.locator('text=Tranquility Base').count() > 0, 'Apollo 11 selected');
  await page.screenshot({ path: `${OUT}/02-apollo11.png` });

  await page.locator('.site-item', { hasText: "Chang'e 4" }).click();
  await page.waitForTimeout(900);
  assert(await page.locator('text=NEVER').count() > 0, 'far side reports NEVER');
  await page.screenshot({ path: `${OUT}/03-farside.png` });

  await page.keyboard.press('c');
  await page.getByRole('button', { name: /Pin current/ }).click();
  await page.locator('.site-item', { hasText: 'Shackleton Rim' }).click();
  await page.locator('.site-rail').getByRole('button', { name: 'Pin', exact: true }).click();
  await page.waitForTimeout(1500);
  assert(await page.locator('text=Scenario comparison').count() > 0, 'comparison open');
  await page.screenshot({ path: `${OUT}/04-comparison.png` });
  await page.keyboard.press('c');

  await page.keyboard.press('e');
  assert(await page.locator('text=Educator mode active').count() > 0, 'educator banner');
  await page.keyboard.press('g');
  await page.locator('text=Why is the South Pole so different').click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/05-educator.png` });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /Custom/ }).first().click();
  await page.locator('input[value="Custom polar site"]').fill('Test Ridge Alpha');
  await page.getByRole('button', { name: /Create site/ }).click();
  await page.waitForTimeout(700);
  assert(await page.locator('text=Test Ridge Alpha').count() > 0, 'custom site created');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Export' }).click();
      await page.getByRole('button', { name: 'Mission report (.json)' }).click();
    })(),
  ]);
  assert(download.suggestedFilename().endsWith('.json'), 'JSON export downloads');

  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  assert(await page.locator('text=RUNNING').count() > 0, 'playback runs');
  await page.keyboard.press('Space');

  // Terrain Lab: ported prototype capabilities.
  await page.keyboard.press('t');
  await page.waitForFunction(() => window.__SELENE_TERRAIN__ && window.__SELENE_TERRAIN__.gridSize === 257, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const initialTerrain = await page.evaluate(() => window.__SELENE_TERRAIN__);
  assert(initialTerrain.mode === 'synthetic', 'terrain lab starts in labeled synthetic mode');
  assert(JSON.stringify(initialTerrain.landingPosition) === JSON.stringify([0, 0, 0]), 'landing vertex is exact origin');
  assert(initialTerrain.triangles > 100000 && initialTerrain.triangles < 135000, 'medium grid triangle budget');
  assert(await page.locator('.terrain-synthetic-banner').isVisible(), 'synthetic warning visible');
  await page.screenshot({ path: `${OUT}/06-terrain-lab.png` });

  const canvas = page.locator('.terrain-viewport canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForTimeout(300);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForTimeout(200);
  assert(await page.locator('.terrain-inspection').innerText().then((t) => t.includes('PINNED')), 'surface inspection pins');

  const ranges = page.locator('.terrain-lab-controls input[type="range"]');
  await setRange(ranges.nth(2), 4);
  await page.waitForTimeout(200);
  const exaggerated = await page.evaluate(() => window.__SELENE_TERRAIN__);
  assert(exaggerated.exaggeration === 4, 'exaggeration updates');
  assert(JSON.stringify(exaggerated.landingPosition) === JSON.stringify([0, 0, 0]), 'exaggeration preserves landing origin');
  await setRange(ranges.nth(2), 1);

  assert((await page.evaluate(() => window.__SELENE_TERRAIN__)).shadows === true, 'shadows default on');
  const shadowOn = await canvas.screenshot();
  await page.locator('.terrain-lab-controls input[type="checkbox"]').uncheck();
  await page.waitForTimeout(350);
  assert((await page.evaluate(() => window.__SELENE_TERRAIN__)).shadows === false, 'shadow toggle works');
  const shadowOff = await canvas.screenshot();
  assert(!shadowOn.equals(shadowOff), 'shadow toggle changes rendered terrain pixels');
  await page.locator('.terrain-lab-controls input[type="checkbox"]').check();
  await setRange(ranges.nth(0), 283);
  await page.waitForTimeout(200);
  assert((await page.evaluate(() => window.__SELENE_TERRAIN__)).sun.azimuthDeg === 283, 'manual Sun azimuth works');

  await page.getByRole('button', { name: /Compute 360° horizon/ }).click();
  await page.waitForSelector('.terrain-lab-controls svg rect');
  assert(await page.locator('text=Ray coverage').count() > 0, 'horizon mask computed');

  await page.locator('.terrain-lab select').first().selectOption('real');
  await page.getByRole('button', { name: /Build terrain/ }).click();
  await page.waitForSelector('text=No DEM configured');
  assert(await page.locator('[role="alert"]').innerText().then((t) => t.includes('No DEM configured')), 'real mode never silently falls back');
  await page.locator('.terrain-lab select').first().selectOption('synthetic');
  await page.getByRole('button', { name: /Build terrain/ }).click();
  await page.waitForFunction(() => window.__SELENE_TERRAIN__ && window.__SELENE_TERRAIN__.gridSize === 257);
  await page.keyboard.press('t');

  const unexpectedConsole = consoleErrors.filter((e) => !e.includes('status of 400')); // real-DEM-without-DEM 400 is an expected, tested safeguard
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  assert(unexpectedConsole.length === 0, `console errors: ${unexpectedConsole.join(' | ')}`);
  console.log('BROWSER TESTS PASSED · mission console + Terrain Lab · screenshots in', OUT);
} finally {
  await browser.close();
}
