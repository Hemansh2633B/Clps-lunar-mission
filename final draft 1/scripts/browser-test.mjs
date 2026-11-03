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
page.setDefaultTimeout(45000);
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

const comparePng = (a, b) => page.evaluate(async ([first, second]) => {
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
const terrainState = () => page.evaluate(() => window.__CHANDRA_TERRAIN__);
const buildTerrain = async ({ mode, quality, radius } = {}) => {
  if (mode) await page.getByLabel('Source', { exact: true }).selectOption(mode);
  if (quality) await page.getByLabel('Grid', { exact: true }).selectOption(quality);
  if (radius != null) await page.getByLabel('Radius km', { exact: true }).fill(String(radius));
  const expected = quality === 'low' ? 129 : quality === 'high' ? 513 : 257;
  await page.getByRole('button', { name: /Build terrain/ }).click();
  await page.waitForFunction((n) => window.__CHANDRA_TERRAIN__?.gridSize === n && !document.querySelector('.terrain-loading'), expected, { timeout: 30000 });
  await page.waitForTimeout(250);
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.app-header .display');
  assert(await page.locator('.app-header .display').innerText().then((t) => t.includes('CHANDRA')), 'header brand renders');
  await page.waitForTimeout(1200);
  await page.screenshot({ animations: 'disabled', path: `${OUT}/01-workspace.png` });
  assert(await page.locator('.site-item').count() >= 10, 'catalog has 10+ sites');

  await page.locator('.site-item', { hasText: 'Apollo 11' }).click();
  await page.waitForTimeout(900);
  assert(await page.locator('text=Tranquility Base').count() > 0, 'Apollo 11 selected');
  await page.screenshot({ animations: 'disabled', path: `${OUT}/02-apollo11.png` });

  await page.locator('.site-item', { hasText: "Chang'e 4" }).click();
  await page.waitForTimeout(900);
  assert(await page.locator('text=NEVER').count() > 0, 'far side reports NEVER');
  await page.screenshot({ animations: 'disabled', path: `${OUT}/03-farside.png` });

  await page.keyboard.press('c');
  await page.getByRole('button', { name: /Pin current/ }).click();
  await page.locator('.site-item', { hasText: 'Shackleton Rim' }).click();
  await page.locator('.site-rail').getByRole('button', { name: 'Pin', exact: true }).click();
  await page.waitForTimeout(1500);
  assert(await page.locator('text=Scenario comparison').count() > 0, 'comparison open');
  await page.screenshot({ animations: 'disabled', path: `${OUT}/04-comparison.png` });
  await page.keyboard.press('c');

  await page.keyboard.press('e');
  assert(await page.locator('text=Educator mode active').count() > 0, 'educator banner');
  await page.keyboard.press('g');
  await page.locator('text=Why is the South Pole so different').click();
  await page.waitForTimeout(900);
  await page.screenshot({ animations: 'disabled', path: `${OUT}/05-educator.png` });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /Custom/ }).first().click();
  await page.locator('input[value="Custom polar site"]').fill('Test Ridge Alpha');
  await page.getByRole('button', { name: /Create site/ }).click();
  await page.waitForTimeout(700);
  assert(await page.locator('text=Test Ridge Alpha').count() > 0, 'custom site created');

  // Modal keyboard guard: global shortcuts must not fire while a dialog is open.
  await page.getByRole('button', { name: /Custom/ }).first().click();
  await page.waitForSelector('[role="dialog"]');
  await page.keyboard.press('t');
  await page.waitForTimeout(200);
  assert(await page.locator('.terrain-lab').count() === 0, 'global shortcuts are suppressed while a modal is open');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert(await page.locator('[role="dialog"]').count() === 0, 'Escape closes the modal');

  // Export is intentionally blocked while the mission window is computing (never
  // stale), so wait for the active scenario to resolve before exporting.
  await page.waitForSelector('text=How this score is computed', { timeout: 30000 });
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

  // Terrain Lab: ported prototype capabilities + integrated DEM workflow.
  await page.keyboard.press('t');
  await page.waitForFunction(() => window.__CHANDRA_TERRAIN__ && window.__CHANDRA_TERRAIN__.gridSize === 257, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const initialTerrain = await terrainState();
  assert(initialTerrain.mode === 'synthetic', 'terrain lab starts in labeled synthetic mode');
  assert(JSON.stringify(initialTerrain.landingPosition) === JSON.stringify([0, 0, 0]), 'landing vertex is exact origin');
  assert(initialTerrain.triangles > 100000 && initialTerrain.triangles < 135000, 'medium grid triangle budget');
  assert(await page.locator('.terrain-synthetic-banner').isVisible(), 'synthetic warning visible');
  await page.screenshot({ animations: 'disabled', path: `${OUT}/06-terrain-lab.png` });

  const canvas = page.locator('.terrain-viewport canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForTimeout(300);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForTimeout(200);
  assert(await page.locator('.terrain-inspection').innerText().then((t) => t.includes('PINNED')), 'surface inspection pins');

  // OrbitControls drag + reset.
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.57, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction((before) => JSON.stringify(window.__CHANDRA_TERRAIN__?.camera) !== before, JSON.stringify(initialTerrain.camera), { timeout: 5000 });
  assert(JSON.stringify((await terrainState()).camera) !== JSON.stringify(initialTerrain.camera), 'drag orbits camera');
  await page.getByRole('button', { name: /Reset view/ }).click();
  await page.waitForTimeout(300);

  // Keyboard camera controls do not leak into the global mission-clock shortcuts.
  await canvas.focus();
  const beforeKey = await terrainState();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((before) => JSON.stringify(window.__CHANDRA_TERRAIN__?.camera) !== before, JSON.stringify(beforeKey.camera), { timeout: 5000 });
  assert(JSON.stringify((await terrainState()).camera) !== JSON.stringify(beforeKey.camera), 'arrow key orbits focused viewport');
  await page.keyboard.press('Home');
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  await page.waitForFunction(() => { const c = window.__CHANDRA_TERRAIN__?.camera; return c && c[1] > Math.abs(c[0]) * 5; }, null, { timeout: 5000 });
  const top = await terrainState();
  assert(top.camera[1] > Math.abs(top.camera[0]) * 5, 'top-down preset');
  await page.getByRole('button', { name: 'Oblique', exact: true }).click();
  await page.waitForTimeout(250);

  const statsBefore = await page.locator('.terrain-stats').innerText();
  await setRange(page.getByLabel('Vertical relief exaggeration'), 4);
  await page.waitForTimeout(200);
  const exaggerated = await terrainState();
  assert(exaggerated.exaggeration === 4, 'exaggeration updates');
  assert(JSON.stringify(exaggerated.landingPosition) === JSON.stringify([0, 0, 0]), 'exaggeration preserves landing origin');
  assert(await page.locator('.terrain-stats').innerText() === statsBefore, 'exaggeration leaves reported elevations unchanged');
  await setRange(page.getByLabel('Vertical relief exaggeration'), 1);

  assert((await terrainState()).shadows === true, 'shadows default on');
  const shadowOn = await canvas.screenshot();
  await page.locator('.terrain-lab-controls input[type="checkbox"]').uncheck();
  await page.waitForFunction(() => window.__CHANDRA_TERRAIN__?.shadows === false);
  await page.waitForTimeout(600);
  assert((await terrainState()).shadows === false, 'shadow toggle works');
  const shadowOff = await canvas.screenshot();
  const shadowDiff = await comparePng(shadowOn, shadowOff);
  assert(shadowDiff.changed > 50 && shadowDiff.brighter > 50, `shadow toggle changes and brightens terrain pixels: ${JSON.stringify(shadowDiff)}`);
  await page.locator('.terrain-lab-controls input[type="checkbox"]').check();
  await page.waitForFunction(() => window.__CHANDRA_TERRAIN__?.shadows === true);
  await page.waitForTimeout(400);
  await setRange(page.getByLabel(/Azimuth ·/), 283);
  await page.waitForTimeout(500);
  assert((await terrainState()).sun.azimuthDeg === 283, 'manual Sun azimuth works');
  const reversed = await canvas.screenshot();
  const azDiff = await comparePng(shadowOn, reversed);
  assert(azDiff.changed > 300, `Sun azimuth changes rendered shadows: ${JSON.stringify(azDiff)}`);
  await setRange(page.getByLabel(/Elevation ·/), -10);
  assert((await terrainState()).sunDirection[1] < 0, 'negative Sun elevation points below horizon');
  await setRange(page.getByLabel(/Elevation ·/), 90);
  assert(Math.abs((await terrainState()).sunDirection[1] - 1) < 1e-9, 'zenith Sun direction');
  await setRange(page.getByLabel(/Azimuth ·/), 103);
  await setRange(page.getByLabel(/Elevation ·/), 2.5);

  // All prototype grid qualities and radius control.
  await buildTerrain({ quality: 'low', radius: 2 });
  assert((await terrainState()).gridSize === 129, 'low quality grid');
  await buildTerrain({ quality: 'high', radius: 2 });
  const high = await terrainState();
  assert(high.gridSize === 513 && high.triangles < 525000, 'high quality grid triangle budget');
  await buildTerrain({ quality: 'medium', radius: 5 });

  // Horizon ray-marching with configurable bins/eye height, CSV export, and mission import.
  await page.getByLabel('Azimuth bin').selectOption('10');
  await page.getByLabel('Eye height m').fill('5');
  await page.getByRole('button', { name: /Compute 360° horizon/ }).click();
  await page.waitForFunction(() => window.__CHANDRA_TERRAIN__?.horizon?.bins === 36, null, { timeout: 30000 });
  const hz = await terrainState();
  assert(hz.horizon.coverage === 100, 'complete synthetic disk has full ray coverage after edge inset');
  assert(hz.horizon.importBlocked === null, 'synthetic demo import is allowed but labeled');
  assert(await page.locator('text=Horizon radius').count() > 0, 'edge inset disclosed');
  const [hzDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'CSV', exact: true }).click(),
  ]);
  assert(hzDownload.suggestedFilename().startsWith('chandra-dem-horizon'), 'horizon CSV export');
  await page.getByRole('button', { name: /Use in mission/ }).click();
  await page.waitForTimeout(700);
  assert(await page.locator('.site-item', { hasText: 'Demo -89.50° 45.0°' }).count() > 0, 'DEM/demo horizon creates mission site');
  assert(await page.locator('text=Synthetic demo samples').count() > 0, 'imported synthetic horizon stays labeled');
  await page.screenshot({ animations: 'disabled', path: `${OUT}/07-dem-horizon-site.png` });

  // Real mode never silently falls back when no DEM is configured.
  await page.keyboard.press('t');
  await page.waitForFunction(() => window.__CHANDRA_TERRAIN__?.gridSize === 257, null, { timeout: 30000 });
  await page.getByLabel('Source', { exact: true }).selectOption('real');
  await page.getByRole('button', { name: /Build terrain/ }).click();
  await page.waitForSelector('text=No DEM configured');
  assert(await page.locator('[role="alert"]').first().innerText().then((t) => t.includes('No DEM configured')), 'real mode never silently falls back');
  await page.getByLabel('Source', { exact: true }).selectOption('synthetic');
  await page.getByRole('button', { name: /Build terrain/ }).click();
  await page.waitForFunction(() => window.__CHANDRA_TERRAIN__?.gridSize === 257);

  // Mobile layout: no horizontal overflow, viewport still usable.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => { const c = document.querySelector('.terrain-viewport canvas'); return c && c.getBoundingClientRect().width <= 391; }, null, { timeout: 5000 });
  await page.waitForTimeout(400);
  await page.screenshot({ animations: 'disabled', path: `${OUT}/08-terrain-mobile.png`, fullPage: true });
  const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth, wide: [...document.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 8).map((el) => `${el.tagName}.${el.className} ${Math.round(el.getBoundingClientRect().right)}`) }));
  assert(overflow.scroll <= overflow.inner, `mobile terrain layout has no horizontal overflow: ${JSON.stringify(overflow)}`);
  assert(await canvas.isVisible(), 'mobile terrain canvas visible');
  const radiusBox = await page.getByLabel('Radius km', { exact: true }).boundingBox();
  assert(radiusBox && radiusBox.x + radiusBox.width <= 391, 'mobile terrain controls remain inside the viewport');
  const canvasBox = await canvas.boundingBox();
  assert(canvasBox && canvasBox.width <= 391, 'mobile WebGL canvas resizes to the viewport');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.keyboard.press('t');

  // ---- v1.5 Space views: planet time-lapse + fleet hangar ----
  const planetState = () => page.evaluate(() => window.__CHANDRA_PLANET__);
  const fleetState = () => page.evaluate(() => window.__CHANDRA_FLEET__);
  await page.keyboard.press('o');
  await page.waitForFunction(() => window.__CHANDRA_PLANET__ && window.__CHANDRA_PLANET__.sites > 0, null, { timeout: 30000 });
  await page.waitForTimeout(1400); // let the Moon texture decode
  assert(await page.locator('.planet-viewport canvas').isVisible(), 'planet viewport renders');
  assert((await planetState()).sites >= 10, 'planet shows the site catalog markers');
  assert(await page.locator('.planet-label.site').count() > 0, 'selected-site label present');
  await page.screenshot({ animations: 'disabled', path: `${OUT}/09-planet.png` });

  // Time-lapse advances the real ephemeris (sub-solar point sweeps).
  const beforeLapse = await planetState();
  await page.getByLabel('Time-lapse speed').selectOption('4'); // 7 days / s
  await page.locator('.timelapse-bar button').first().click();
  await page.waitForFunction(() => window.__CHANDRA_PLANET__?.playing === true, null, { timeout: 5000 });
  await page.waitForTimeout(1300);
  const duringLapse = await planetState();
  assert(duringLapse.timeMs > beforeLapse.timeMs, 'time-lapse advances the clock');
  assert(Math.abs(duringLapse.subsolar[1] - beforeLapse.subsolar[1]) > 5 || Math.abs(duringLapse.subsolar[0] - beforeLapse.subsolar[0]) > 1, 'sub-solar point moves during time-lapse');
  await page.locator('.timelapse-bar button').first().click(); // pause
  await page.waitForFunction(() => window.__CHANDRA_PLANET__?.playing === false, null, { timeout: 5000 });
  // Camera presets reposition the camera.
  const camBefore = (await planetState()).camera;
  await page.getByRole('button', { name: 'South pole', exact: true }).click();
  await page.waitForFunction((before) => JSON.stringify(window.__CHANDRA_PLANET__?.camera) !== before, JSON.stringify(camBefore), { timeout: 5000 });
  assert((await planetState()).camera[1] < -2, 'south-pole preset looks up at the pole');

  // Fleet hangar tab.
  await page.getByRole('tab', { name: /Fleet hangar/ }).click();
  await page.waitForFunction(() => window.__CHANDRA_FLEET__ && window.__CHANDRA_FLEET__.parts > 1, null, { timeout: 30000 });
  await page.waitForTimeout(700);
  assert((await fleetState()).vehicle === 'starship-stack', 'fleet defaults to the Starship stack');
  assert(await page.locator('.fleet-viewport canvas').isVisible(), 'fleet viewport renders');
  assert(await page.locator('.fleet-part').count() >= 2, 'fleet part callouts listed');
  assert(await page.locator('.fleet-disclaimer').isVisible(), 'stylized-model disclaimer visible');
  await page.screenshot({ animations: 'disabled', path: `${OUT}/10-fleet-stack.png` });

  // Stage separation slider moves the upper stage.
  await setRange(page.locator('.fleet-controls input[type="range"]'), 0.8);
  await page.waitForFunction(() => window.__CHANDRA_FLEET__?.separation > 0.5, null, { timeout: 5000 });
  assert((await fleetState()).separation > 0.5, 'stage separation slider works');
  // Engine plume toggle.
  await page.getByRole('button', { name: /Ignite engines/ }).click();
  await page.waitForFunction(() => window.__CHANDRA_FLEET__?.plume === true, null, { timeout: 5000 });
  assert((await fleetState()).plume === true, 'engine plume ignites');

  // Switch to the HLS lunar lander, then the CLPS lander.
  await page.getByRole('button', { name: 'STARSHIP HLS', exact: true }).click();
  await page.waitForFunction(() => window.__CHANDRA_FLEET__?.vehicle === 'starship-hls', null, { timeout: 10000 });
  await page.waitForTimeout(600);
  assert((await fleetState()).vehicle === 'starship-hls', 'HLS lander loads');
  await page.screenshot({ animations: 'disabled', path: `${OUT}/11-fleet-hls.png` });
  await page.getByRole('button', { name: 'CLPS LANDER', exact: true }).click();
  await page.waitForFunction(() => window.__CHANDRA_FLEET__?.vehicle === 'clps-lander', null, { timeout: 10000 });
  assert((await fleetState()).vehicle === 'clps-lander', 'CLPS lander loads');

  // Hover a part for a KSP-style callout (scan a few points to guarantee a hit).
  const fbox = await page.locator('.fleet-viewport canvas').boundingBox();
  let hoverHit = false;
  for (const [fx, fy] of [[0.5, 0.45], [0.5, 0.6], [0.45, 0.5], [0.55, 0.35]]) {
    await page.mouse.move(fbox.x + fbox.width * fx, fbox.y + fbox.height * fy);
    await page.waitForTimeout(180);
    if ((await fleetState()).hovered) { hoverHit = true; break; }
  }
  assert(hoverHit, 'hovering a vehicle part shows a callout');

  // Close Space views and confirm the console returns.
  await page.keyboard.press('o');
  await page.waitForTimeout(400);
  assert(await page.locator('.planet-viewport').count() === 0, 'Space views close back to the console');
  assert(await page.locator('.app-header .display').innerText().then((t) => t.includes('CHANDRA')), 'brand survives view switching');

  // ---- Audit features: Artemis catalogue, UTC selector, provenance, score transparency ----
  await page.locator('.site-item', { hasText: 'Shackleton Rim' }).click();
  await page.waitForTimeout(600);

  // Artemis III tab lists exactly the nine NASA Oct-2024 candidate regions.
  await page.getByRole('button', { name: 'Artemis III', exact: true }).click();
  await page.waitForTimeout(300);
  const artemisCount = await page.locator('.site-item').count();
  assert(artemisCount === 9, `Artemis III tab shows nine regions (got ${artemisCount})`);
  for (const region of ['Cabeus B', 'Haworth', 'Malapert', 'Mouton', 'Nobile', 'de Gerlache', 'Slater']) {
    assert(await page.locator('.site-item', { hasText: region }).count() > 0, `Artemis region present: ${region}`);
  }
  assert(await page.locator('.site-item', { hasText: 'region approx.' }).count() > 0, 'Artemis regions labeled region-approximate, not surveyed');
  await page.screenshot({ animations: 'disabled', path: `${OUT}/12-artemis-catalogue.png` });
  await page.getByRole('button', { name: 'all', exact: true }).click();
  await page.waitForTimeout(200);

  // Persistent provenance indicator reflects the illustrative default site.
  assert(await page.locator('.provenance').count() > 0, 'provenance indicator present');
  assert(await page.locator('text=ILLUSTRATIVE TERRAIN').count() > 0, 'illustrative provenance state shown');

  // UTC mission-start selector exists and drives a recompute (no stale results).
  const startInput = page.getByLabel('Mission start date and time (UTC)');
  assert(await startInput.count() === 1, 'UTC mission-start selector present');
  await startInput.fill('2027-03-01T00:00');
  await startInput.dispatchEvent('change');
  await page.waitForSelector('text=How this score is computed', { timeout: 30000 });
  assert(await startInput.inputValue() === '2027-03-01T00:00', 'UTC start selector retains the chosen value');
  assert(await page.locator('text=SAMPLING').count() > 0, 'sampling disclosure strip present');

  // Score transparency: expand the heuristic breakdown and check components + confidence.
  await page.locator('text=How this score is computed').click();
  await page.waitForTimeout(300);
  assert(await page.locator('text=Simultaneous Sun + Earth visibility').count() > 0, 'score components shown');
  assert(await page.locator('text=Application-defined heuristic').count() > 0, 'score disclosed as heuristic');
  assert(await page.locator('text=not an RF link budget').count() > 0, 'geometric LOS != RF disclosed');
  await page.screenshot({ animations: 'disabled', path: `${OUT}/13-provenance-score.png` });

  const unexpectedConsole = consoleErrors.filter((e) => !e.includes('status of 400')); // real-DEM-without-DEM 400 is an expected, tested safeguard
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  assert(unexpectedConsole.length === 0, `console errors: ${unexpectedConsole.join(' | ')}`);
  console.log('BROWSER TESTS PASSED · mission console + Terrain Lab + Space views (planet time-lapse, fleet hangar) · screenshots in', OUT);
} catch (err) {
  await page.screenshot({ animations: 'disabled', path: `${OUT}/99-browser-failure.png`, fullPage: true }).catch(() => {});
  console.error('BROWSER FAILURE STATE', JSON.stringify(await terrainState().catch(() => null)), 'console:', consoleErrors, 'page:', pageErrors);
  throw err;
} finally {
  await browser.close();
}
