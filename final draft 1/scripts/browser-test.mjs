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
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const assert = (cond, msg) => { if (!cond) throw new Error(`ASSERT FAILED: ${msg}`); };

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

  assert(errors.length === 0, `console errors: ${errors.join(' | ')}`);
  console.log('BROWSER TESTS PASSED · screenshots in', OUT);
} finally {
  await browser.close();
}
