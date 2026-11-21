// Browser end-to-end test for the v1.12 data features:
//   Polar Map orientation + live imagery layers, Lunar Data Hub, JPL Horizons
//   verification workspace, Terrain Lab datasets + bounded LOLA acquisition,
//   external-viewer links, and the static-only (no backend) deployment mode.
//
//   npm run build && npm run test:datahub
//
// Self-contained and network-free. The script starts
//   1. a loopback FIXTURE server that (a) replays the recorded JPL Horizons
//      responses in backend/horizons/testdata/*_x6.txt (see the README there for
//      how they were captured) for exactly the query they were recorded from and
//      refuses every other query, and (b) serves a synthetic COG with HTTP range
//      support in the PGDA directory layout;
//   2. the native API, serving dist/, pointed at that fixture server through the
//      CHANDRA_HORIZONS_BASE_URL / CHANDRA_LOLA_BASE_URL test hooks;
//   3. a static-only server whose /api/* answers with the HTML shell.
// NASA Moon Trek and LROC WMS hosts are intercepted in the browser. Tiles are
// synthesised from each tile's own ground coordinates, so tile registration is
// checked against first principles, not against the app's projection code.
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { buildCommand } from './go-bin.mjs';
import { launchBrowser } from './lib/browser.mjs';

const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });
const assert = (cond, msg) => { if (!cond) throw new Error(`ASSERT FAILED: ${msg}`); };
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg} (got ${a}, expected ${b} ± ${tol})`);
const passed = [];
const ok = (msg) => { passed.push(msg); console.log(`  ✓ ${msg}`); };

assert(existsSync('dist/index.html'), 'dist/ is missing — run `npm run build` first');

// ------------------------------------------------------------------ first-principles map geometry
const R_MOON = 1_737_400;
const SIZE = 560, RADIUS = 254; // canvas units used by the Polar Map
const DEG = Math.PI / 180;
const rho = (colatDeg) => 2 * R_MOON * Math.tan((colatDeg / 2) * DEG);
/** Moon 2000 south polar stereographic: X toward 90°E, Y toward 0°. */
const ground = (lat, lon) => ({ x: rho(90 + lat) * Math.sin(lon * DEG), y: rho(90 + lat) * Math.cos(lon * DEG) });
const SPAN0 = 30578404.0178571 * 0.00028 * 256; // one level-0 tile, metres (WMTS capabilities)
const TOP_LEFT = [-1095930, 1095930];

// ------------------------------------------------------------------ synthetic tile PNGs
function crc32(buf) { let crc = ~0; for (let n = 0; n < buf.length; n++) { let c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** Graticule drawn from the tile's own ground coordinates: red rings every 0.5°, blue meridians every 30°, green 0° meridian. */
function trekTile(z, row, col) {
  const n = 256, span = SPAN0 / 2 ** z, px = span / n, buf = Buffer.alloc(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = TOP_LEFT[0] + col * span + (i + 0.5) * px, y = TOP_LEFT[1] - row * span - (j + 0.5) * px;
    const r = Math.hypot(x, y), colat = (2 * Math.atan(r / (2 * R_MOON))) / DEG, lon = (Math.atan2(x, y) / DEG + 360) % 360;
    const ringW = (px / (R_MOON * DEG)) * 1.2, merW = r > 0 ? ((px * 1.2) / r) / DEG : 360;
    let c = [205, 200, 190];
    if (i === 0 || j === 0) c = [120, 120, 120];
    if (Math.abs(lon / 30 - Math.round(lon / 30)) * 30 < merW) c = [40, 70, 200];
    if (Math.abs(colat / 0.5 - Math.round(colat / 0.5)) * 0.5 < ringW && colat > 0.1) c = [210, 40, 40];
    if (Math.min(lon, 360 - lon) < merW * 2.5) c = [20, 150, 60];
    const o = (j * n + i) * 4; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255;
  }
  return png(n, n, buf);
}
const flatPng = (() => { const b = Buffer.alloc(64 * 64 * 4); for (let i = 0; i < b.length; i += 4) { b[i] = 150; b[i + 1] = 150; b[i + 2] = 160; b[i + 3] = 255; } return png(64, 64, b); })();

// ------------------------------------------------------------------ fixture server (Horizons replay + COG range mirror)
const HORIZONS_RECORDINGS = {
  "'10'": readFileSync('backend/horizons/testdata/sun_shackleton-me_2026-12-01_720m_x6.txt', 'utf8'),
  "'399'": readFileSync('backend/horizons/testdata/earth_shackleton-me_2026-12-01_720m_x6.txt', 'utf8'),
};
const RECORDED_QUERY = { CENTER: "'coord@301'", COORD_TYPE: "'GEODETIC'", SITE_COORD: "'359.450513,-89.900807,-1.2000'", START_TIME: "'2026-12-01 00:00'",
  STOP_TIME: "'2026-12-03 12:00'", STEP_SIZE: "'720 m'", QUANTITIES: "'4,20,30'", APPARENT: "'AIRLESS'", format: 'text' };
const COG = 'tests/golden/dem/extract_rough_spstere_20m.tif';
const cogSize = statSync(COG).size;
const fixtureLog = { horizonsServed: 0, horizonsRefused: 0, rangeRequests: 0, fullDownloads: 0 };
const fixture = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture');
  if (url.pathname === '/api/horizons.api') {
    const q = Object.fromEntries(url.searchParams);
    const body = HORIZONS_RECORDINGS[q.COMMAND];
    const matches = body && Object.entries(RECORDED_QUERY).every(([k, v]) => q[k] === v);
    if (!matches) { fixtureLog.horizonsRefused++; res.writeHead(503, { 'Content-Type': 'text/plain' }); res.end('no recording for this query'); return; }
    fixtureLog.horizonsServed++;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(body);
    return;
  }
  if (url.pathname.startsWith('/data/LOLA_20mpp/') && url.pathname.endsWith('.TIF')) {
    const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
    if (!m) { fixtureLog.fullDownloads++; res.writeHead(200, { 'Content-Length': cogSize }); createReadStream(COG).pipe(res); return; }
    const start = Number(m[1]), end = Math.min(Number(m[2]), cogSize - 1);
    fixtureLog.rangeRequests++;
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${cogSize}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ETag: '"fixture-v1"', 'Last-Modified': 'Fri, 02 Jan 2026 03:04:05 GMT' });
    createReadStream(COG, { start, end }).pipe(res);
    return;
  }
  res.writeHead(404); res.end('not found');
});
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const fixturePort = await listen(fixture);

// ------------------------------------------------------------------ static-only server (no backend: /api/* gets the HTML shell)
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.md': 'text/markdown' };
// It answers with the response headers vercel.json declares for each path (the production
// Content-Security-Policy included), so the console is exercised under the policy it is deployed with.
const vercelHeaderRules = JSON.parse(readFileSync('vercel.json', 'utf8')).headers.map((rule) => ({ match: new RegExp(`^${rule.source}$`), headers: rule.headers }));
const staticOnly = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://s').pathname);
  const file = path.join('dist', p);
  const found = !p.includes('..') && existsSync(file) && statSync(file).isFile();
  const headers = {};
  for (const rule of vercelHeaderRules) if (rule.match.test(p)) for (const h of rule.headers) headers[h.key] = h.value;
  if (!found && p.startsWith('/assets/')) { res.writeHead(404, headers); res.end('Not Found'); return; } // as on Vercel: never the HTML shell
  const target = found ? file : 'dist/index.html';
  res.writeHead(200, { ...headers, 'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream' });
  createReadStream(target).pipe(res);
});
const staticPort = await listen(staticOnly);

// ------------------------------------------------------------------ native API
const dataDir = mkdtempSync(path.join(tmpdir(), 'chandra-e2e-'));
const apiPort = await new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const api = spawn(buildCommand('chandra-api'), ['--host', '127.0.0.1', '--port', String(apiPort), '--static', 'dist'], {
  env: { ...process.env, LUNAR_DEM_PATH: '', LUNAR_DEM_CONFIG: '', CHANDRA_DATA_DIR: dataDir, CHANDRA_STORE: 'local',
    CHANDRA_HORIZONS_BASE_URL: `http://127.0.0.1:${fixturePort}/api/horizons.api`, CHANDRA_LOLA_BASE_URL: `http://127.0.0.1:${fixturePort}/data/LOLA_20mpp` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let apiLog = '';
api.stdout.on('data', (d) => { apiLog += d; });
api.stderr.on('data', (d) => { apiLog += d; });
const BASE = `http://127.0.0.1:${apiPort}/`;
for (let i = 0; ; i++) {
  try { const r = await fetch(`${BASE}api/health`); if (r.ok) break; } catch { /* not up yet */ }
  if (i > 100 || api.exitCode !== null) throw new Error(`native API did not start:\n${apiLog}`);
  await new Promise((r) => setTimeout(r, 100));
}

const browser = await launchBrowser();
const consoleErrors = [];
const pageErrors = [];
let exitCode = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.slice(0, -1) }).catch(() => {});
  await context.addInitScript(() => localStorage.setItem('chandra-onboarded-v1', '1'));
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  // Screenshots are evidence, not assertions: a software-rendered browser can be slow to
  // paint, so retry once and report (never hide) a capture that still fails.
  const missedShots = [];
  const shot = async (name) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await page.screenshot({ animations: 'disabled', timeout: 30000, path: `${OUT}/${name}.png` });
        return;
      } catch {
        await page.waitForTimeout(400);
      }
    }
    missedShots.push(name);
    console.log(`  · screenshot ${name} could not be captured (rendering timeout); assertions are unaffected`);
  };

  // Remote imagery hosts are intercepted; `tileMode` controls the simulated service state.
  const tileRequests = [];
  let tileMode = 'ok'; // ok | down | partial
  await page.route('https://trek.nasa.gov/**', async (route) => {
    const url = route.request().url();
    tileRequests.push(url);
    const m = /\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url);
    if (!m || tileMode === 'down' || (tileMode === 'partial' && (Number(m[2]) + Number(m[3])) % 2 === 0)) return route.fulfill({ status: 404, contentType: 'text/html', body: 'Not Found' });
    return route.fulfill({ status: 200, contentType: 'image/png', body: trekTile(Number(m[1]), Number(m[2]), Number(m[3])) });
  });
  const wmsRequests = [];
  let wmsMode = 'ok';
  await page.route('https://wms.im-ldi.com/**', async (route) => {
    wmsRequests.push(route.request().url());
    return wmsMode === 'ok' ? route.fulfill({ status: 200, contentType: 'image/png', body: flatPng }) : route.fulfill({ status: 503, body: 'unavailable' });
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Not now' }).click({ timeout: 3000 }).catch(() => {});

  const map = page.locator('[data-testid="polar-map"]');
  const canvas = page.locator('canvas[aria-label*="Stereographic map"]');
  const mapAttr = (name) => map.getAttribute(name);
  const waitStatus = (status) => page.waitForFunction((s) => document.querySelector('[data-testid="polar-map"]')?.getAttribute('data-layer-status') === s, status, { timeout: 20000 });
  // The planner's centre column scrolls; align the map panel with its top so the panel
  // header (zoom, overlays), the imagery selector and the whole map are in view together.
  const showMap = async () => { await map.evaluate((el) => el.scrollIntoView({ block: 'start' })); await page.waitForTimeout(300); };
  await showMap();
  /** CSS position of a selenographic point for a pole-centred view of `extent` degrees. */
  const cssPoint = async (lat, lon, extent) => {
    const b = await canvas.boundingBox();
    const k = b.width / SIZE;
    const g = ground(lat, lon);
    return { x: b.x + b.width / 2 + (g.x / rho(extent)) * RADIUS * k, y: b.y + b.height / 2 - (g.y / rho(extent)) * RADIUS * k, k, box: b };
  };
  const hoverCoord = async (x, y) => {
    await page.mouse.move(x, y);
    const text = await map.locator('.tooltip').innerText();
    const m = /([\d.]+)°([NS]),\s*([\d.]+)°([EW])/.exec(text);
    assert(m, `map tooltip shows a coordinate (got "${text}")`);
    return { lat: (m[2] === 'S' ? -1 : 1) * Number(m[1]), lon: ((m[4] === 'W' ? -1 : 1) * Number(m[3]) + 360) % 360 };
  };

  // ---------------------------------------------------------------- A. Polar Map orientation
  console.log('Polar Map');
  assert(await canvas.count() === 1, 'polar map canvas has a text alternative');
  assert((await canvas.getAttribute('aria-label')).includes('0 degrees longitude (the Earth-facing meridian) at the top'), 'text alternative states the orientation');
  assert(await mapAttr('data-layer') === 'lroc-wac-south-pole-400m' && await mapAttr('data-layer-status') === 'bundled', 'bundled imagery is the default and needs no network');
  assert(tileRequests.length === 0 && wmsRequests.length === 0, 'no remote imagery is requested until the user selects a remote layer');
  for (const [lat, lon] of [[-82, 0], [-82, 90], [-82, 180], [-82, 270], [-86.5, 135]]) {
    const p = await cssPoint(lat, lon, 10);
    const got = await hoverCoord(p.x, p.y);
    near(got.lat, lat, 0.06, `hover latitude at (${lat}, ${lon})`);
    near(Math.cos((got.lon - lon) * DEG), 1, 2e-4, `hover longitude at (${lat}, ${lon}) [cos Δλ]`);
  }
  const top = await cssPoint(-82, 0, 10);
  assert(top.y < top.box.y + top.box.height / 2 && Math.abs(top.x - (top.box.x + top.box.width / 2)) < 0.5, '0° meridian is at the top of the map');
  ok('pointer coordinates: 0° meridian up, 90°E right, 180° down, 270°E left');

  // Markers are drawn where first principles put them: clicking there selects the site.
  // (With the pre-1.12 mirrored drawing these clicks land on empty ground and create a custom site instead.)
  const railCount = async () => Number(await page.locator('.panel-header', { hasText: 'Landing sites' }).locator('.chip').first().innerText());
  const before = await railCount();
  for (const [name, lat, lon] of [['Cabeus B Peak', -82.5, 310], ['Slater Plain', -88.5, 223], ['Nobile Rim 1', -85.2, 53.5]]) {
    const p = await cssPoint(lat, lon, 10);
    await page.mouse.click(p.x, p.y);
    await page.waitForFunction((n) => document.querySelector('canvas[aria-label*="Stereographic map"]')?.getAttribute('aria-label')?.includes(`Selected site ${n}`), name, { timeout: 8000 })
      .catch(() => { throw new Error(`ASSERT FAILED: clicking the computed position of ${name} did not select it`); });
  }
  assert(await railCount() === before, 'marker clicks selected catalogue sites and created no custom site');
  ok('site markers sit at their published coordinates (click-to-select at first-principles positions)');

  // Zoom: "+" zooms IN and the pointer geometry follows (extent 10° → 5°).
  await map.getByRole('button', { name: 'Zoom in' }).click();
  assert(await mapAttr('data-extent-deg') === '5', 'zoom-in halves the extent');
  const z = await cssPoint(-87, 45, 5);
  const zc = await hoverCoord(z.x, z.y);
  near(zc.lat, -87, 0.03, 'zoomed hover latitude'); near(zc.lon, 45, 0.6, 'zoomed hover longitude');
  assert(await map.getByRole('button', { name: 'Zoom out' }).isEnabled(), 'zoom-out is available after zooming in');
  ok('zoom-in / zoom-out change the extent and keep pointer coordinates registered');

  // ---------------------------------------------------------------- B. Moon Trek WMTS layer
  await map.getByLabel('Polar map imagery layer').selectOption('trek-lola-shade-spole875-5m');
  await waitStatus('ready');
  // Independent expectation for a pole-centred 5° view: level, tile set and placement.
  const mpp = rho(5) / RADIUS;
  const level = Math.ceil(Math.log2(SPAN0 / 256 / mpp));
  const span = SPAN0 / 2 ** level;
  const lo = Math.floor((-75840 - TOP_LEFT[0]) / span), hi = Math.ceil((75840 - TOP_LEFT[0]) / span) - 1;
  const expected = [];
  for (let r = lo; r <= hi; r++) for (let c = lo; c <= hi; c++) expected.push(`${level}/${r}/${c}`);
  const requested = tileRequests.map((u) => /\/(\d+\/\d+\/\d+)\.png$/.exec(u)[1]).sort();
  assert(level === 4 && JSON.stringify(requested) === JSON.stringify([...expected].sort()), `requested tiles ${requested} equal the first-principles set ${expected}`);
  assert(tileRequests.every((u) => u.startsWith('https://trek.nasa.gov/tiles/Moon/SP/LRO_LOLA_Shade_SPole875_5mp_v04/1.0.0/default/default028mm/')), 'tile URLs follow the documented Trek REST template');
  const stage = await page.locator('.polar-stage').boundingBox();
  const kCss = stage.width / SIZE;
  for (const key of expected) {
    const [, r, c] = key.split('/').map(Number);
    const box = await page.locator(`img[data-tile="${key}"]`).boundingBox();
    const gx = TOP_LEFT[0] + c * span, gy = TOP_LEFT[1] - r * span;
    near(box.x - stage.x, (SIZE / 2 + (gx / rho(5)) * RADIUS) * kCss, 0.6, `tile ${key} left edge`);
    near(box.y - stage.y, (SIZE / 2 - (gy / rho(5)) * RADIUS) * kCss, 0.6, `tile ${key} top edge`);
    near(box.width, (span / rho(5)) * RADIUS * kCss, 0.6, `tile ${key} size`);
  }
  assert((await page.locator('[data-testid="polar-layer-status"]').innerText()).trim() === 'Live', 'status reads Live once every tile arrived');
  await showMap();
  const inView = await page.evaluate(() => {
    const visible = document.querySelector('.center-stack').getBoundingClientRect();
    const within = (el) => { const r = el.getBoundingClientRect(); return r.top >= visible.top - 0.5 && r.bottom <= visible.bottom + 0.5; };
    return within(document.querySelector('.polar-stage')) && within(document.querySelector('select[aria-label="Polar map imagery layer"]'))
      && within(document.querySelector('[data-testid="polar-map"] .panel-header'));
  });
  assert(inView, 'at 1600×1000 the map, its controls and the imagery selector fit in view together');
  await shot('v112-a-polar-map-trek-tiles');
  ok(`Moon Trek layer: level ${level}, ${expected.length} tiles, each placed within 0.6 px of its ground position`);

  // Service failure modes are reported, never hidden.
  tileMode = 'partial'; tileRequests.length = 0;
  await map.getByRole('button', { name: 'Zoom in' }).click(); // 2.5°: a new tile set
  await waitStatus('partial');
  assert(/Partly loaded · \d+\/\d+/.test(await page.locator('[data-testid="polar-layer-status"]').innerText()), 'partial coverage is reported with counts');
  tileMode = 'down'; tileRequests.length = 0;
  await map.getByRole('button', { name: 'Zoom in' }).click(); // 1.25°
  await waitStatus('unavailable');
  assert((await page.locator('[data-testid="polar-layer-status"]').innerText()).includes('Unavailable — showing bundled imagery'), 'an unavailable service falls back to bundled imagery and says so');
  ok('layer status distinguishes live / partly loaded / unavailable');

  // Outside the product footprint nothing is requested at all.
  tileMode = 'ok'; tileRequests.length = 0;
  await map.getByRole('button', { name: 'Reset map view' }).click();
  const cab = await cssPoint(-82.5, 310, 10);
  await page.mouse.click(cab.x, cab.y);
  await map.getByRole('button', { name: 'Centre map on the selected site' }).click();
  await map.getByRole('button', { name: 'Zoom in' }).click();
  await map.getByRole('button', { name: 'Zoom in' }).click();
  await map.getByRole('button', { name: 'Zoom in' }).click();
  await waitStatus('no-coverage');
  await page.waitForTimeout(300);
  const outside = tileRequests.filter((u) => /\/7\/|\/6\//.test(u));
  assert(outside.length === 0, 'no tiles are requested for a view outside the product footprint');
  ok('no-coverage views request nothing and say so');

  // ---------------------------------------------------------------- C. LROC WMS layer
  await map.getByRole('button', { name: 'Reset map view' }).click();
  await map.getByLabel('Polar map imagery layer').selectOption('lroc-lunaserv-wms-wac-global');
  await waitStatus('ready');
  const wms = new URL(wmsRequests.at(-1));
  const bbox = wms.searchParams.get('BBOX').split(',').map(Number);
  assert(wms.searchParams.get('SRS') === 'IAU2000:30120' && wms.searchParams.get('REQUEST') === 'GetMap' && wms.searchParams.get('LAYERS') === 'luna_wac_global', 'WMS GetMap uses the Moon south-polar SRS');
  near(bbox[0], -rho(10), 1, 'WMS bbox minx'); near(bbox[1], -rho(10), 1, 'WMS bbox miny'); near(bbox[2], rho(10), 1, 'WMS bbox maxx'); near(bbox[3], rho(10), 1, 'WMS bbox maxy');
  wmsMode = 'down';
  await map.getByRole('button', { name: 'Zoom in' }).click();
  await waitStatus('unavailable');
  ok('LROC WMS layer: correct GetMap request; outage reported with bundled fallback');
  await map.getByRole('button', { name: 'Reset map view' }).click();
  await map.getByLabel('Polar map imagery layer').selectOption('lroc-wac-south-pole-400m');

  // ---------------------------------------------------------------- D. External viewers
  const shack = await cssPoint(-89.9, 0, 10);
  await page.mouse.click(shack.x, shack.y);
  await page.waitForFunction(() => document.querySelector('canvas[aria-label*="Stereographic map"]')?.getAttribute('aria-label')?.includes('Selected site Shackleton Rim'));
  const viewers = page.locator('[data-testid="external-viewers"]');
  const links = await viewers.locator('a').evaluateAll((as) => as.map((a) => ({ href: a.href, target: a.target, rel: a.rel })));
  assert(links.length === 2 && links.some((l) => l.href === 'https://quickmap.lroc.asu.edu/') && links.some((l) => l.href === 'https://trek.nasa.gov/moon/'), 'QuickMap and Moon Trek links are offered');
  assert(links.every((l) => l.target === '_blank' && l.rel.includes('noopener') && l.rel.includes('noreferrer')), 'external links open safely in a new tab');
  await viewers.getByRole('button', { name: /Copy site coordinates/ }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (clip !== null) assert(clip === '-89.9000, 0.0000', `copied coordinates are decimal lat, lon (got "${clip}")`);
  ok(`external viewers: safe links${clip !== null ? ' and copied coordinates' : ' (clipboard not readable in this browser; copy button exercised)'}`);

  // ---------------------------------------------------------------- E. Data Hub
  console.log('Lunar Data Hub');
  await page.keyboard.press('d');
  const hub = page.locator('[data-testid="data-hub"]');
  await hub.waitFor();
  assert(await page.getByRole('button', { name: 'Data Hub' }).getAttribute('aria-pressed') === 'true', 'header button reflects the open hub');
  assert(await page.getByText('Mission timeline · synodic scrubber').count() === 0, 'the mission timeline yields its space to the hub');
  await page.waitForFunction(() => document.querySelector('[data-testid="hub-runtime"]')?.getAttribute('data-state') === 'online');
  const runtime = await page.locator('[data-testid="hub-runtime"]').innerText();
  assert(/BACKEND ONLINE · LOCAL/i.test(runtime) && /LOLA ACQUISITION ON/i.test(runtime) && /HORIZONS ON/i.test(runtime), 'hub reports what this backend can do');
  assert((await page.locator('[data-testid="hub-count"]').innerText()).trim() === '20 of 20 sources', 'all catalogue sources are listed');
  assert(await hub.locator('dd.unknown').count() > 20, 'unconfirmed metadata is shown as "Not confirmed"');
  assert((await hub.locator('dd.unknown').first().innerText()).trim() === 'Not confirmed', 'unknown values are labelled, not guessed');
  await hub.getByLabel('Search data sources').fill('horizons');
  assert(await hub.locator('[data-source-id="jpl-horizons"]').count() === 1, 'search finds JPL Horizons');
  const afterSearch = Number((await page.locator('[data-testid="hub-count"]').innerText()).split(' ')[0]);
  assert(afterSearch >= 1 && afterSearch < 20, 'search narrows the list');
  await hub.getByLabel('Search data sources').fill('zzz-nothing');
  assert(await hub.getByText('No source matches these filters.').isVisible(), 'an empty result explains itself');
  await hub.getByRole('button', { name: 'Clear filters' }).click();
  await hub.getByRole('button', { name: /Digital elevation models/ }).click();
  assert(await hub.locator('article[data-source-id]').count() === 5 && await hub.locator('article[data-category="dem"]').count() === 5, 'category filter shows the five LOLA DEM products');
  await hub.getByRole('button', { name: 'All', exact: true }).click();
  const hubLinks = await hub.locator('a[href^="http"]').evaluateAll((as) => as.map((a) => ({ href: a.href, target: a.target, rel: a.rel })));
  assert(hubLinks.length > 15 && hubLinks.every((l) => l.href.startsWith('https://') && l.target === '_blank' && l.rel.includes('noopener')), 'every hub link is HTTPS and opens safely');
  await shot('v112-b-data-hub-sources');
  ok('sources: runtime status, search, filters, "Not confirmed" labelling, safe links');

  // Tabs are keyboard operable.
  await page.locator('#hub-tab-sources').focus();
  await page.keyboard.press('ArrowRight');
  assert(await page.locator('#hub-tab-verification').getAttribute('aria-selected') === 'true', 'arrow keys move between hub tabs');
  await page.keyboard.press('ArrowRight');
  assert(await page.locator('#hub-tab-csa').getAttribute('aria-selected') === 'true', 'arrow keys reach the CSA tab');
  assert(await hub.locator('article[data-csa-id]').count() === 10, 'ten CSA references are listed');
  const csaText = await hub.locator('.hub-callout').innerText();
  assert(/Mission reference only/i.test(csaText) && /never stand in for LOLA or LROC/i.test(csaText), 'CSA material is labelled mission reference only');
  assert(await hub.getByRole('button', { name: /Acquire|Show on Polar Map/ }).count() === 0, 'CSA references offer no terrain or map-layer action');
  await shot('v112-c-data-hub-csa');
  ok('CSA references: listed, labelled mission-reference-only, no data actions');

  // "Show on Polar Map" routes a catalogue layer back to the planner.
  await page.locator('#hub-tab-sources').click();
  await hub.locator('[data-source-id="trek-wac-pole-illumination-south-100m"]').getByRole('button', { name: 'Show on Polar Map' }).click();
  await map.waitFor();
  assert(await mapAttr('data-layer') === 'trek-wac-pole-illumination-south-100m', 'catalogue action selects the layer on the Polar Map');
  assert((await map.innerText()).includes('not CHANDRA\'s result for this epoch'), 'published illumination is labelled as context, not a CHANDRA result');
  await map.getByLabel('Polar map imagery layer').selectOption('lroc-wac-south-pole-400m');
  ok('catalogue → Polar Map layer hand-off');

  // ---------------------------------------------------------------- F. Horizons verification
  console.log('JPL Horizons verification');
  await page.getByRole('button', { name: 'Data Hub' }).click();
  await page.locator('#hub-tab-verification').click();
  const recorded = page.locator('[data-testid="verification-summary"]').first();
  await recorded.waitFor();
  const recRows = await recorded.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => ({ target: tr.dataset.target, verdict: tr.dataset.verdict, cells: [...tr.cells].map((c) => c.innerText) })));
  assert(recRows.length === 2 && recRows.every((r) => r.verdict === 'agree' && r.cells[1] === '42'), 'recorded reference: Sun and Earth agree over 42 instants');
  const recSun = recRows.find((r) => r.target === 'sun'), recEarth = recRows.find((r) => r.target === 'earth');
  assert(parseFloat(recSun.cells[4]) < 0.01 && parseFloat(recEarth.cells[4]) < 0.004, 'recorded separations are within the documented accuracy');
  assert(parseFloat(recEarth.cells[6]) > 20, 'the Earth-range difference of the analytic lunar theory is shown, not hidden');
  await shot('v112-d-verification-recorded');
  ok(`recorded reference (offline): Sun max separation ${recSun.cells[4]}, Earth ${recEarth.cells[4]}, Earth range Δ ${recEarth.cells[6].split('(')[0].trim()}`);

  // Live path: browser → native API → (fixture) Horizons → validation → residuals.
  const live = page.locator('[data-testid="verification-live"]');
  const phase = (p) => page.waitForFunction((want) => document.querySelector('[data-testid="verification-live"]')?.getAttribute('data-phase') === want, p, { timeout: 60000 });
  await page.getByLabel('Verification start date (UTC)').fill('2026-12-01');
  await page.getByLabel('Verification start time (UTC)').fill('00:00');
  await page.locator('#verify-step').selectOption('720');
  await page.locator('#verify-samples').fill('401');
  assert(await page.getByRole('button', { name: 'Query JPL Horizons' }).isDisabled(), 'out-of-range sample counts are refused before any request');
  await page.locator('#verify-samples').fill('6');
  await page.getByRole('button', { name: 'Query JPL Horizons' }).click();
  await phase('done');
  const liveRows = await live.locator('[data-testid="verification-summary"] tbody tr').evaluateAll((trs) => trs.map((tr) => ({ target: tr.dataset.target, verdict: tr.dataset.verdict, cells: [...tr.cells].map((c) => c.innerText) })));
  assert(liveRows.length === 2 && liveRows.every((r) => r.verdict === 'agree' && r.cells[1] === '6'), 'live check: both targets agree over the 6 requested instants');
  const liveText = await live.innerText();
  assert(/cache miss/.test(liveText) && /MEAN_ME/.test(liveText) && /DE441/.test(liveText) && /SHA-256/.test(liveText), 'live result carries retrieval provenance (cache state, frame, ephemeris, checksum)');
  assert(/Horizons TDB − UT 69\.183 s/.test(liveText) && /TT − UT 7\d\.\d+ s/.test(liveText), 'time-scale difference between Horizons and the engine is disclosed');
  assert(fixtureLog.horizonsServed === 2, 'exactly one upstream request per target');
  const queryHref = await live.locator('a', { hasText: 'exact Horizons query' }).first().getAttribute('href');
  assert(queryHref.includes('/api/horizons.api?format=text') && queryHref.includes('SITE_COORD=%27359.450513%2C-89.900807%2C-1.2000%27'), 'the exact upstream query is shown for audit');
  await shot('v112-e-verification-live');
  // Report download
  const [download] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: /Download report/ }).click()]);
  const report = JSON.parse(readFileSync(await download.path(), 'utf8'));
  assert(report.kind === 'chandra-horizons-verification' && report.source === 'live' && report.targets.length === 2, 'verification report structure');
  assert(report.targets.every((t) => t.verdict === 'agree' && t.rows.length === 6 && /^[0-9a-f]{64}$/.test(t.horizons.response_sha256)), 'report carries rows and the response checksum');
  assert(report.site.horizonsMeanMe.frame === 'MOON_ME' && Math.abs(report.site.horizonsMeanMe.latitude_deg + 89.900807) < 1e-6, 'report records the frame-converted site');
  assert(report.conventions.some((c) => /Terrain is NOT verified/.test(c)), 'report states that terrain is not verified');
  // Cached repeat
  await page.getByRole('button', { name: 'Query JPL Horizons' }).click();
  await page.waitForFunction(() => /cache hit/.test(document.querySelector('[data-testid="verification-live"]')?.innerText ?? ''), null, { timeout: 30000 });
  assert(fixtureLog.horizonsServed === 2, 'a repeated query is served from the backend cache, not from Horizons');
  ok('live check: agreement, provenance, audit URL, cache, downloadable report');

  // Upstream failure: a query the fixture has no recording for.
  await page.locator('#verify-samples').fill('7');
  await page.getByRole('button', { name: 'Query JPL Horizons' }).click();
  await phase('error');
  const alert = live.locator('.hub-alert');
  assert(await alert.getAttribute('data-kind') === 'upstream', 'upstream failure is classified');
  const alertText = await alert.innerText();
  assert(/JPL Horizons unavailable/.test(alertText) && /nothing was compared/i.test(alertText) && /simulation is unaffected/i.test(alertText), 'upstream failure explains the consequence');
  assert(!/127\.0\.0\.1|http:\/\//.test(alertText), 'upstream errors do not leak internal addresses');
  assert(await page.locator('[data-testid="verification-summary"]').count() === 1, 'no stale live result is shown after a failure');
  ok('upstream failure: explained, nothing compared, no internal details leaked');

  // ---------------------------------------------------------------- G. Terrain Lab datasets + acquisition
  console.log('Terrain Lab datasets and LOLA acquisition');
  await page.keyboard.press('t');
  const panel = page.locator('[data-testid="terrain-data-panel"]');
  await panel.waitFor();
  await page.waitForFunction(() => document.querySelector('#terrain-dataset') !== null, null, { timeout: 30000 });
  assert((await page.locator('[data-testid="terrain-backend-chip"]').innerText()).trim().toUpperCase() === 'API ONLINE · NO DEM', 'backend without a DEM is reported as such');
  assert(/No DEM configured/.test(await panel.locator('[data-testid="dataset-not-ready"]').innerText()), 'the missing DEM is explained');
  assert(await panel.locator('[data-testid="model-eligibility"]').getAttribute('data-level') === 'demo', 'the synthetic model is labelled demonstration-only');
  // Real mode without a dataset fails loudly and never substitutes synthetic terrain.
  await page.locator('#terrain-mode').selectOption('real');
  await page.getByRole('button', { name: 'Build terrain' }).click();
  await page.locator('.terrain-lab [role="alert"]', { hasText: 'No DEM configured' }).waitFor();
  assert((await page.evaluate(() => window.__CHANDRA_TERRAIN__?.mode)) === 'synthetic', 'a failed real build leaves the labelled synthetic model in place');
  await page.locator('#terrain-mode').selectOption('synthetic');
  // Plan → download
  await page.locator('#terrain-radius').fill('2');
  assert(await panel.getByRole('button', { name: /Download subset/ }).isDisabled(), 'download requires an estimate first');
  await panel.getByRole('button', { name: 'Estimate download' }).click();
  const plan = panel.locator('[data-testid="acquire-plan"]');
  await plan.waitFor();
  const planText = await plan.innerText();
  assert(/292 × 292 px of 512 × 512/.test(planText) && /20 metre\/px/.test(planText), `plan reports the native window (got "${planText.replace(/\s+/g, ' ')}")`);
  assert(fixtureLog.fullDownloads === 0 && fixtureLog.rangeRequests > 0, 'planning used HTTP range requests only');
  const rangesBefore = fixtureLog.rangeRequests;
  await panel.getByRole('button', { name: /Download subset/ }).click();
  await panel.locator('[data-testid="acquire-done"]').waitFor({ timeout: 60000 });
  assert(fixtureLog.fullDownloads === 0 && fixtureLog.rangeRequests > rangesBefore, 'the subset was read by range requests; the full raster was never downloaded');
  // Success and selection are one UI update, so the selector already names the new dataset.
  const datasetId = await page.locator('#terrain-dataset').inputValue();
  assert(/^lola-ldem-80s-20mpp-adj-[0-9a-f]{12}$/.test(datasetId), `the acquired dataset is selected as soon as the download is reported done (got "${datasetId}")`);
  // The model on screen is now a real-mode extraction from exactly that dataset. (The fixture raster carries the
  // synthetic-fixture tag, so the lab keeps labelling it as demonstration terrain — asserted below.)
  await page.waitForFunction((id) => window.__CHANDRA_TERRAIN__?.requestMode === 'real' && window.__CHANDRA_TERRAIN__?.datasetId === id, datasetId, { timeout: 60000 });
  assert((await page.evaluate(() => window.__CHANDRA_TERRAIN__.mode)) === 'synthetic', 'a synthetic-tagged raster is never presented as real lunar terrain');
  const summary = await panel.locator('[data-testid="dataset-summary"]').innerText();
  assert(/MOON_ME/.test(summary) && /validated/i.test(summary) && /Synthetic fixture · demo only/i.test(summary), 'dataset summary shows frame status and the fixture label');
  assert(await panel.locator('[data-testid="model-eligibility"]').getAttribute('data-level') === 'demo', 'a synthetic-tagged raster stays demonstration-only even in real mode');
  assert((await page.locator('[data-testid="terrain-backend-chip"]').innerText()).toUpperCase().includes('1 ACQUIRED'), 'header reports the acquired dataset');
  await panel.getByRole('button', { name: /full metadata/ }).click();
  const meta = panel.locator('[data-testid="dataset-metadata"]');
  await meta.getByText('PROJECTION', { exact: false }).first().waitFor();
  const metaText = await meta.innerText();
  assert(/16-bit signed integer/.test(metaText) && /compression Deflate/.test(metaText) && /2020-01-01T00:00:00Z → 2035-12-31T23:59:59Z/.test(metaText) && /View only/i.test(metaText)
    && /product_id: lola-ldem-80s-20mpp-adj/.test(metaText) && /"source_pixel_window":\[110,110,292,292\]/.test(metaText) && /"sha256":"[0-9a-f]{64}"/.test(metaText), `full metadata shows raster, frame interval and acquisition provenance (got "${metaText.replace(/\s+/g, ' ').slice(0, 1800)}")`);
  const listed = await page.evaluate(() => fetch('/api/datasets').then((r) => r.json()));
  assert(listed.datasets.length === 2 && listed.datasets[1].ready === true && listed.datasets[1].source.provenance.product_id === 'lola-ldem-80s-20mpp-adj', 'the API lists the acquired dataset with provenance');
  // Horizon from the acquired dataset
  await page.getByRole('button', { name: 'Compute 360° horizon' }).click();
  await page.waitForFunction(() => (window.__CHANDRA_TERRAIN__?.horizon?.bins ?? 0) > 0, null, { timeout: 60000 });
  await shot('v112-f-terrain-lab-acquired');
  ok(`LOLA acquisition: plan → range-only download → dataset ${datasetId.slice(0, 34)}… → real-mode terrain, metadata, horizon`);

  // ---------------------------------------------------------------- H. Mobile layout
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  // scrollWidth alone misses content clipped by an overflow-hidden ancestor, so also require every
  // visible element to end inside the viewport. Exempt: the decorative ticker and tables that
  // scroll sideways inside their own marked region.
  const beyondViewport = () => page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.parentElement?.closest('[data-hscroll]')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || (r.right <= window.innerWidth + 1 && r.left >= -1)) continue;
      out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 24)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    }
    return out;
  });
  const fits = async (where) => { const wide = await beyondViewport(); assert(wide.length === 0, `${where}: nothing is cut off at the right edge on a phone (${wide.slice(0, 4).join(', ')})`); };
  await fits('Terrain Lab with the acquired dataset and its metadata'); // still open from the previous section
  await page.keyboard.press('d');
  await hub.waitFor();
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 1, `no horizontal page overflow on a phone-sized viewport (overflow ${overflow}px)`);
  await fits('hub sources');
  assert(await page.locator('#hub-tab-verification').isVisible(), 'hub tabs are reachable on mobile');
  await shot('v112-g-data-hub-mobile');
  await page.locator('#hub-tab-verification').click();
  await page.locator('[data-testid="verification-summary"]').waitFor();
  await fits('hub verification');
  await page.locator('#hub-tab-csa').click();
  await fits('hub CSA references');
  await page.keyboard.press('d');
  await hub.waitFor({ state: 'detached' });
  await map.waitFor(); // closing the hub returns to the planner
  await fits('planner with the Polar Map');
  await page.setViewportSize({ width: 1600, height: 1000 });
  ok('mobile viewport: Terrain Lab, hub, verification tables and the Polar Map fit a 390 px screen');

  // ---------------------------------------------------------------- I. Static-only deployment (no backend)
  console.log('Static-only hosting (no API function)');
  const staticPage = await context.newPage();
  const staticErrors = [];
  staticPage.on('pageerror', (e) => staticErrors.push(String(e)));
  // Record every Content-Security-Policy violation the page raises.
  await staticPage.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(`${e.effectiveDirective} ${e.blockedURI}`));
  });
  await staticPage.route('https://trek.nasa.gov/**', (route) => {
    const m = /\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(route.request().url());
    return m ? route.fulfill({ status: 200, contentType: 'image/png', body: trekTile(Number(m[1]), Number(m[2]), Number(m[3])) }) : route.fulfill({ status: 404, body: 'Not Found' });
  });
  await staticPage.route('https://wms.im-ldi.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: flatPng }));
  const staticResponse = await staticPage.goto(`http://127.0.0.1:${staticPort}/`, { waitUntil: 'networkidle' });
  const servedCsp = staticResponse.headers()['content-security-policy'] ?? '';
  assert(/default-src 'self'/.test(servedCsp) && /script-src 'self'/.test(servedCsp), 'the static server applies the production Content-Security-Policy from vercel.json');
  // Under that policy: the worker-computed analysis completes, and both remote imagery providers load.
  await staticPage.waitForFunction(() => /\d[\d,]* samples/.test(document.querySelector('.statusbar, footer')?.textContent ?? document.body.textContent), null, { timeout: 60000 });
  const staticMap = staticPage.locator('[data-testid="polar-map"]');
  const staticLayer = staticMap.getByLabel('Polar map imagery layer');
  const staticStatus = () => staticPage.locator('[data-testid="polar-layer-status"]').innerText().then((t) => t.trim());
  await staticLayer.selectOption('trek-lola-shade-spole875-5m');
  await staticPage.waitForFunction(() => document.querySelector('[data-testid="polar-layer-status"]')?.textContent?.trim() === 'Live', null, { timeout: 30000 });
  await staticLayer.selectOption('lroc-lunaserv-wms-wac-global');
  await staticPage.waitForFunction(() => document.querySelector('[data-testid="polar-layer-status"]')?.textContent?.trim() === 'Live', null, { timeout: 30000 });
  assert(await staticStatus() === 'Live', 'Moon Trek and LROC WMS imagery load under the production CSP');
  await staticLayer.selectOption('lroc-wac-south-pole-400m');
  assert(await staticPage.evaluate(() => window.__cspViolations.length) === 0, `the console raises no CSP violation in normal use (${await staticPage.evaluate(() => window.__cspViolations.join(' | '))})`);
  // Negative control: the policy is really enforced, so an image from any other host is refused.
  const refused = await staticPage.evaluate(() => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve('loaded');
    img.onerror = () => resolve('refused');
    img.src = 'https://imagery.example.org/tile.png';
    setTimeout(() => resolve('timeout'), 5000);
  }));
  const controlViolations = await staticPage.evaluate(() => window.__cspViolations.splice(0));
  assert(refused === 'refused' && controlViolations.length === 1 && controlViolations[0].startsWith('img-src') && controlViolations[0].includes('imagery.example.org'),
    `an image from a host outside the catalogue is blocked by the CSP (${refused}; ${controlViolations.join(' | ')})`);
  const missingAsset = await staticPage.evaluate(() => fetch('/assets/does-not-exist-00000000.js').then((r) => `${r.status} ${r.headers.get('content-type') ?? ''}`));
  assert(missingAsset.startsWith('404'), `a missing asset is a 404, not the HTML shell (${missingAsset})`);
  await staticPage.keyboard.press('d');
  await staticPage.waitForFunction(() => document.querySelector('[data-testid="hub-runtime"]')?.getAttribute('data-state') === 'offline', null, { timeout: 30000 });
  assert((await staticPage.locator('[data-testid="hub-count"]').innerText()).trim() === '20 of 20 sources', 'the bundled catalogue is complete without a backend');
  await staticPage.locator('#hub-tab-verification').click();
  assert(await staticPage.locator('[data-testid="verification-summary"] tr[data-verdict="agree"]').count() === 2, 'the recorded Horizons reference works offline');
  await staticPage.getByRole('button', { name: 'Query JPL Horizons' }).click();
  await staticPage.waitForFunction(() => document.querySelector('[data-testid="verification-live"]')?.getAttribute('data-phase') === 'error');
  assert(await staticPage.locator('.hub-alert').getAttribute('data-kind') === 'offline', 'an HTML answer on /api is recognised as "no backend", never parsed as data');
  await staticPage.keyboard.press('t');
  await staticPage.locator('[data-testid="datasets-offline"]').waitFor();
  assert((await staticPage.locator('[data-testid="terrain-backend-chip"]').innerText()).toUpperCase().includes('API OFFLINE'), 'Terrain Lab reports the missing backend');
  assert((await staticPage.evaluate(() => window.__CHANDRA_TERRAIN__?.mode)) === 'synthetic', 'the synthetic demo still works without a backend');
  assert(staticErrors.length === 0, `static-only mode raised page errors: ${staticErrors.join(' | ')}`);
  const lateViolations = await staticPage.evaluate(() => window.__cspViolations);
  assert(lateViolations.length === 0, `Data Hub and Terrain Lab raise no CSP violation (${lateViolations.join(' | ')})`);
  await staticPage.close();
  ok('static-only hosting: catalogue + recorded verification + synthetic demo work; live features say why they cannot');
  ok('production Content-Security-Policy: worker, WebGL and both imagery providers work; any other image host is refused');

  // ---------------------------------------------------------------- errors
  const unexpected = consoleErrors.filter((e) => !/Failed to load resource|status of (404|502|503|400)/.test(e));
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  assert(unexpected.length === 0, `unexpected console errors: ${unexpected.join(' | ')}`);
  ok('no uncaught page errors; console errors limited to the deliberately failed requests');
  console.log(`\nDATA HUB BROWSER TEST PASSED — ${passed.length} checks.`);
} catch (err) {
  exitCode = 1;
  console.error(`\n${err.stack ?? err}`);
  if (pageErrors.length) console.error('page errors:', pageErrors.slice(0, 5));
  if (apiLog) console.error(`--- native API log (tail) ---\n${apiLog.split('\n').slice(-15).join('\n')}`);
} finally {
  await browser.close().catch(() => {});
  api.kill('SIGTERM');
  fixture.close();
  staticOnly.close();
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(exitCode);
