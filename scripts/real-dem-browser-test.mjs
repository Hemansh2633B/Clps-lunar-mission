// Real-DEM integration smoke test. Requires:
//   .venv/bin/python scripts/fetch-lola-verification-fixture.py
//   npm run build
//   .venv/bin/python -m backend.server --dem-config data/verification/lola_verification_config.json --port 8001
// The fixture is a gap-filled third-party LOLA downsample for SOFTWARE verification only.
import { chromium as pw } from 'playwright';
import sparticuz from '@sparticuz/chromium';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:8001/';
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });
// CI mode uses Playwright's bundled Chromium; local sandbox mode uses the
// npm-distributed Sparticuz binary + Amazon Linux 2023 libraries (same contract
// as the other browser suites). The fixture itself is still required.
const CI_BROWSER = process.env.CHANDRA_BROWSER_CI === '1';
const LIB = '/tmp/al2023/lib';
if (!CI_BROWSER && !existsSync(join(LIB, 'libnss3.so'))) {
  const bin = 'node_modules/@sparticuz/chromium/bin';
  for (const [file, dir] of [['al2023.tar.br', '/tmp/al2023'], ['fonts.tar.br', '/tmp/fonts']]) {
    mkdirSync(dir, { recursive: true });
    const tarPath = `/tmp/${file.replace('.br', '')}`;
    writeFileSync(tarPath, brotliDecompressSync(readFileSync(join(bin, file))));
    execSync(`tar -xf ${tarPath} -C ${dir}`);
  }
}
const browser = CI_BROWSER
  ? await pw.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  : await pw.launch({
      executablePath: process.env.CHROMIUM_PATH || (await sparticuz.executablePath()),
      args: sparticuz.args,
      headless: true,
      env: { ...process.env, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || '/tmp/al2023/lib', FONTCONFIG_PATH: '/tmp/fonts' },
    });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
// The first-run welcome modal traps keyboard shortcuts; this smoke targets the
// configured-DEM Terrain Lab path, so dismiss onboarding deterministically.
await page.addInitScript(() => { window.localStorage.setItem('chandra-onboarded-v1', '1'); });
page.setDefaultTimeout(45000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const assert = (cond, msg) => { if (!cond) throw new Error(`ASSERT FAILED: ${msg}`); };
const state = () => page.evaluate(() => window.__CHANDRA_TERRAIN__);

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.keyboard.press('t');
  await page.waitForFunction(() => window.__CHANDRA_TERRAIN__?.mode === 'real' && window.__CHANDRA_TERRAIN__.gridSize === 257, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const real = await state();
  assert(real.mode === 'real', 'configured DEM auto-loads in real mode');
  assert(!(await page.locator('.terrain-synthetic-banner').isVisible()), 'no synthetic banner for real DEM');
  assert(await page.locator('text=Real DEM').count() > 0, 'real DEM chip visible');
  assert(await page.locator('text=LDEM_80S_20MPP_ADJ_512_verification.tif').count() > 0, 'source provenance visible');
  assert(await page.locator('.terrain-stats').innerText().then((t) => t.includes('100.0%')), 'real fixture disk coverage reported');
  await page.screenshot({ animations: 'disabled', path: `${OUT}/09-real-dem-lab.png` });

  await page.getByLabel('Azimuth bin').selectOption('10');
  await page.getByRole('button', { name: /Compute 360° horizon/ }).click();
  await page.waitForFunction(() => window.__CHANDRA_TERRAIN__?.horizon?.bins === 36, null, { timeout: 60000 });
  const hz = await state();
  assert(hz.horizon.coverage === 100, 'real fixture horizon coverage');
  assert(hz.horizon.importBlocked === null, 'complete real fixture horizon is importable');
  await page.getByRole('button', { name: /Use in mission/ }).click();
  await page.waitForTimeout(900);
  assert(await page.locator('.site-item', { hasText: 'DEM -89.50° 45.0°' }).count() > 0, 'real DEM horizon creates mission site');
  assert(await page.locator('text=Measured/sample elevations preserved').count() > 0, 'DEM provenance preserved in mission planner');
  assert(await page.locator('text=MOON_ME').count() > 0, 'source frame disclosed');
  assert(await page.locator('.status-bar').innerText().then((t) => t.includes('REAL DEM') && t.includes('FRAME VERIFIED')), 'status bar provenance reflects a frame-verified real DEM');
  await page.screenshot({ animations: 'disabled', path: `${OUT}/10-real-dem-mission-site.png` });
  assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);
  console.log('REAL DEM BROWSER TEST PASSED · projected lunar GeoTIFF → crop → horizon → mission site (verification fixture).');
} finally {
  await browser.close();
}
