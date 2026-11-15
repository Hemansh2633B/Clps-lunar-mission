// Shared Chromium launcher for the browser suites.
//
// CI (CHANDRA_BROWSER_CI=1) uses Playwright's own Chromium. Elsewhere — notably in
// sandboxes where Playwright's CDN is blocked — it falls back to the npm-distributed
// @sparticuz/chromium binary plus its Amazon Linux 2023 shared libraries, extracted once.
import { chromium as pw } from 'playwright';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';

export const CI_BROWSER = process.env.CHANDRA_BROWSER_CI === '1';

export async function launchBrowser() {
  if (CI_BROWSER) return pw.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const { default: sparticuz } = await import('@sparticuz/chromium');
  const lib = '/tmp/al2023/lib';
  if (!existsSync(join(lib, 'libnss3.so'))) {
    const bin = 'node_modules/@sparticuz/chromium/bin';
    for (const [file, dir] of [['al2023.tar.br', '/tmp/al2023'], ['fonts.tar.br', '/tmp/fonts']]) {
      mkdirSync(dir, { recursive: true });
      const tarPath = `/tmp/${file.replace('.br', '')}`;
      writeFileSync(tarPath, brotliDecompressSync(readFileSync(join(bin, file))));
      execSync(`tar -xf ${tarPath} -C ${dir}`);
    }
  }
  return pw.launch({
    executablePath: process.env.CHROMIUM_PATH || (await sparticuz.executablePath()),
    args: sparticuz.args,
    headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || lib, FONTCONFIG_PATH: '/tmp/fonts' },
  });
}
