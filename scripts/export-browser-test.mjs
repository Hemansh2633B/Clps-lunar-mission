/**
 * CHANDRA v1.11 — scientific-export browser personas (real UI, real downloads).
 *
 * Persona A · Scientist: runs an analysis, exports JSON + timeseries + events +
 *   energy history, and RECONCILES the exported energy trajectory with the
 *   report summary (final/min SOC, generated energy, deficit hours) and the
 *   refined event timestamps. Fingerprints link every CSV to the JSON report.
 * Persona B · Comparison: two valid scenarios + one blocked scenario; the
 *   comparison export carries explicit per-row states — the blocked row is never
 *   a zero-valued valid case.
 * Persona C · Persisted state: custom site survives reload inside the isolated
 *   training session; a valid v1 session migrates to v2; an out-of-range stored
 *   config is rejected safely with an actionable Rebuild/Exit recovery path.
 * Persona D · Data confidence: illustrative, synthetic and verified-DEM exports
 *   each carry provenance; confidence is never confused with mission performance.
 * Persona E · Accessibility: keyboard export initiation + refusal announcements
 *   (role=status), blocked-analysis notices, mobile layout, reduced motion.
 *
 * DEM responses are stubbed at the NETWORK BOUNDARY ONLY (NASA downloads are
 * unavailable in CI); frame classification, gating, guards and exports run live.
 * Playwright download events are asserted for every export — the app itself only
 * claims "initiated" (the browser save dialog is not observable from page script).
 */
import { chromium as pw } from 'playwright';
import sparticuz from '@sparticuz/chromium';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });
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
      args: sparticuz.args, headless: true,
      env: { ...process.env, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || '/tmp/al2023/lib', FONTCONFIG_PATH: '/tmp/fonts' },
    });

const assert = (cond, msg) => { if (!cond) throw new Error(`ASSERT FAILED: ${msg}`); };
const allErrors = [];
const allConsole = [];
const contexts = [];
async function newPage({ viewport = { width: 1600, height: 1000 } } = {}) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  contexts.push(ctx);
  // Single-process Sparticuz Chromium shares one profile across contexts; seed
  // deterministically ONCE per tab via a sessionStorage marker (tab-isolated,
  // survives reload). Harness quirk, not app behavior.
  await ctx.addInitScript(() => {
    if (window.sessionStorage.getItem('chandra-export-seeded')) return;
    window.localStorage.clear();
    window.localStorage.setItem('chandra-onboarded-v1', '1');
    window.sessionStorage.setItem('chandra-export-seeded', '1');
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  page.on('pageerror', (e) => allErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') allConsole.push(m.text()); });
  return page;
}
const shot = async (page, name) => {
  await page.waitForTimeout(1200);
  await page.screenshot({ animations: 'disabled', path: `${OUT}/${name}.png`, timeout: 25000 }).catch(() => {});
};
const resolved = (page) => page.waitForSelector('text=How this score is computed', { timeout: 60000 });
const selectSite = async (page, name) => {
  await page.locator('.site-item', { hasText: name }).first().click();
  await page.waitForTimeout(500);
};
const EXPORT_LABELS = {
  json: 'Mission report (.json)',
  summary: 'Window summary (.csv)',
  timeseries: 'Telemetry timeseries (.csv)',
  energy: 'Energy & battery history (.csv)',
  events: 'Visibility events (.csv)',
  horizon: 'Horizon mask (.csv)',
};
async function exportViaMenu(page, kind) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    (async () => {
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await page.getByRole('button', { name: EXPORT_LABELS[kind], exact: true }).click();
    })(),
  ]);
  const body = readFileSync(await dl.path(), 'utf8');
  return { filename: dl.suggestedFilename(), body };
}
/** CSV parse adequate for these exports: provenance columns are comma-free; the
 *  comparison CSV keeps free-text columns last. Quoted fields are unescaped. */
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const split = (line) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const header = split(lines[0]);
  return { header, rows: lines.slice(1).map((l) => { const cells = split(l); return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])); }) };
}
const toastText = (page) => page.locator('[role="status"]').last().innerText().catch(() => '');
const getSession = (page) => page.evaluate(() => { try { return JSON.parse(window.localStorage.getItem('chandra-story-session-v1')); } catch { return null; } });

/** Network-boundary DEM stub (identical contract to the story suite). */
async function setupRealDemMocks(page) {
  const SIZE = 129;
  const elevations = new Array(SIZE * SIZE).fill(0);
  const source = {
    filename: 'TEST_FIXTURE_ME.tif', lunar_radius_m: 1737400, elevation_reference_radius_m: 1737400,
    elevation_reference: 'mean radius', lunar_reference_frame: 'MOON_ME (JPL DE421)', synthetic: false,
  };
  const terrainPayload = {
    mode: 'real', synthetic: false, latitude: -89.5, longitude: 45, radius_km: 5,
    grid: { size: SIZE, spacing_m: 78.1, order: 'row-major north-to-south', elevations_m: elevations },
    landing_elevation_m: 0,
    statistics: { minimum_m: 0, maximum_m: 0, range_m: 0, coverage_percent: 100 },
    source,
  };
  const azimuths = Array.from({ length: 360 }, (_, i) => i);
  const horizonPayload = () => ({
    latitude: -89.5, longitude: 45, radius_km: 5, horizon_radius_km: 4.5, edge_inset_m: 28.3,
    sampling_step_m: 20, grid_size: SIZE, grid_spacing_m: 78.1, eye_height_m: 2, azimuth_step_deg: 1,
    azimuths_deg: azimuths, elevations_deg: azimuths.map(() => 0.5),
    ray_coverage_percent: azimuths.map(() => 100), max_obstacle_range_km: azimuths.map(() => 4),
    mean_coverage_percent: 100, synthetic: false,
    source, model: 'ray-marched local horizon', frame_note: 'Test fixture payload.',
  });
  await page.route('**/api/config', (r) => r.fulfill({ json: {
    dem_ready: true, source, dem_error: null, quality_grids: { low: 65, medium: 129, high: 257 },
    radius_limits_km: [0.5, 20], latitude_convention: 'planetocentric', longitude_convention: '0-360E',
    synthetic_warning: 'demo', render_coordinates: 'IAU', geometry_model: 'sphere',
  } }));
  await page.route('**/api/terrain', (r) => r.fulfill({ json: terrainPayload }));
  await page.route('**/api/horizon', (r) => r.fulfill({ json: horizonPayload() }));
  return {
    buildRealDem: async () => {
      await page.waitForSelector('.terrain-lab');
      await page.waitForFunction(() => document.querySelector('#terrain-mode')?.value === 'real', null, { timeout: 20000 });
      await page.locator('#terrain-mode').selectOption('real');
      await page.locator('.terrain-lab').getByRole('button', { name: 'Build terrain' }).click();
      await page.waitForFunction(() => window.__CHANDRA_TERRAIN__?.mode === 'real', null, { timeout: 30000 });
      await page.waitForSelector('text=TEST_FIXTURE_ME.tif', { timeout: 30000 });
    },
    computeHorizon: async () => {
      await page.getByRole('button', { name: /Compute 360° horizon/ }).click();
      await page.waitForFunction(() => window.__CHANDRA_TERRAIN__?.horizon?.bins === 360, null, { timeout: 30000 });
    },
    useInMission: async () => {
      await page.getByRole('button', { name: /Use in mission/ }).click();
      await page.waitForTimeout(800);
    },
  };
}

const DEFAULT_CFG = { durationDays: 10, arrayMode: 'vertical-tracking', arrayAreaM2: 6, cellEfficiency: 0.28, systemDerate: 0.85, fixedPanelAzimuthDeg: 0, loadW: 180, batteryCapacityKWh: 20, initialSocPct: 80, commsMarginDeg: 0, stepMinutes: 15 };
const ws = (over = {}) => ({
  selectedId: 'connecting-ridge', baselineMs: Date.parse('2026-09-01T00:00:00Z'), slipDays: 0,
  config: { ...DEFAULT_CFG }, viewDays: 30, timeMs: Date.parse('2026-09-03T00:00:00Z'),
  mode: 'planner', compareMode: false, terrainView: false, spaceView: false,
  scenarios: [], playing: false, speed: 3600, customSites: [], ...over,
});

const t0 = Date.now();
try {
  // ============ PERSONA A · Scientist: export + reconcile ============
  {
    const page = await newPage();
    await page.goto(BASE);
    await selectSite(page, 'de Gerlache Rim 2');
    await resolved(page);
    const report = JSON.parse((await exportViaMenu(page, 'json')).body);
    assert(report.applicationVersion === '1.11.0', 'A: report carries the application version');
    assert(report.reportSchemaVersion === '2.0.0' && report.reportSchemaVersion !== report.applicationVersion, 'A: independent report schema version');
    assert(/^[0-9a-f]{64}$/.test(report.analysisFingerprint), 'A: SHA-256 analysis fingerprint');
    assert(report.timeReference === 'UTC' && report.reproducibility.siteProvenance.siteId === 'de-gerlache-rim-2', 'A: UTC + site identity');
    assert(report.effectiveConfig && report.requestedConfig && report.configWasClamped === false, 'A: effective config recorded');
    assert(report.reproducibility.terrain.disclosure.includes('illustrative'), 'A: status-aware illustrative disclosure');
    assert(Array.isArray(report.energyHistory) && report.energyHistory.length > 2, 'A: engine energy history in the report');

    const energy = parseCSV((await exportViaMenu(page, 'energy')).body);
    const last = energy.rows[energy.rows.length - 1];
    const s = report.summary;
    assert(Math.abs(Number(last.battery_soc_pct) - s.finalBatterySocPct) < 0.002, 'A: final SOC reconciles with the summary');
    assert(Math.abs(Math.min(...energy.rows.map((r) => Number(r.battery_soc_pct))) - s.minBatterySocPct) < 0.002, 'A: min SOC reconciles');
    assert(Math.abs(Number(last.cumulative_generated_kwh) - s.selectedEnergyKWh) < 0.002, 'A: generated energy reconciles');
    assert(Math.abs(energy.rows.reduce((a, r) => a + Number(r.deficit_hours), 0) - s.depletionHours) < 0.005, 'A: deficit hours reconcile');
    assert(energy.rows.every((r) => r.analysis_fingerprint === report.analysisFingerprintShort), 'A: energy CSV fingerprint links to the report');
    assert(energy.rows[0].boundary === 'start' && last.boundary === 'end', 'A: trajectory spans the exact window');

    const events = parseCSV((await exportViaMenu(page, 'events')).body);
    assert(events.rows.length > 0, 'A: refined events exported');
    const reportTimes = report.events.map((e) => e.timeMs).sort((a, b) => a - b);
    const csvTimes = events.rows.map((r) => Number(r.event_time_ms)).sort((a, b) => a - b);
    assert(JSON.stringify(reportTimes) === JSON.stringify(csvTimes), 'A: event timestamps identical to the engine events (ms precision)');
    const sunRows = events.rows.filter((r) => r.body === 'sun');
    assert(sunRows.length > 0 && sunRows.every((r) => r.visible_before !== r.visible_after), 'A: pre/post visibility states');
    assert(energy.rows.some((r) => r.boundary === 'sun-event'), 'A: refined Sun transitions flagged in the energy history');

    const ts = parseCSV((await exportViaMenu(page, 'timeseries')).body);
    assert(ts.rows.length === report.reproducibility.sampling.sampleCount, 'A: timeseries sample count matches');
    assert(ts.rows.every((r) => r.analysis_fingerprint === report.analysisFingerprintShort && r.analysis_status === 'ILLUSTRATIVE'), 'A: timeseries provenance on every row');
    await shot(page, 'v111-a-scientist-reconciled');
    console.log('PERSONA A (scientist: JSON + timeseries + events + energy exported and RECONCILED with the summary) PASSED');
  }

  // ============ PERSONA B · Comparison: valid + blocked rows ============
  {
    const page = await newPage();
    await page.goto(BASE);
    await selectSite(page, 'de Gerlache Rim 2');
    await resolved(page);
    await page.locator('.story-title').click({ trial: true }).catch(() => {});
    await page.keyboard.press('p'); // pin valid #1
    await page.waitForTimeout(600);
    await page.keyboard.press('c'); // back to planner
    await selectSite(page, 'Cabeus B Peak');
    await resolved(page);
    await page.keyboard.press('p'); // pin valid #2
    await page.waitForTimeout(600);

    // Blocked scenario: verified ME DEM at an epoch outside the validated range.
    const dem = await setupRealDemMocks(page);
    await page.keyboard.press('c');
    await page.keyboard.press('t');
    await dem.buildRealDem();
    await dem.computeHorizon();
    await dem.useInMission();
    await page.getByLabel('Mission start date (UTC)').fill('2040-06-01');
    await page.getByLabel('Mission start date (UTC)').blur();
    await page.waitForSelector('[role="alert"]', { timeout: 30000 });
    await page.locator('.panel-title').first().click();
    await page.keyboard.press('p'); // pin blocked #3
    await page.waitForTimeout(1500);
    assert(await page.locator('text=3/4 pinned').count() > 0, 'B: three scenarios pinned');
    assert(await page.getByRole('note', { name: 'Comparison export policy' }).count() > 0, 'B: export policy stated in the UI');

    const [jsonDl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.panel-header').getByRole('button', { name: 'JSON', exact: true }).click(),
    ]);
    const comp = JSON.parse(readFileSync(await jsonDl.path(), 'utf8'));
    const states = comp.rows.map((r) => r.resolutionState);
    assert(states.filter((x) => x === 'ILLUSTRATIVE').length === 2 && states.includes('BLOCKED'), 'B: two valid + one blocked, explicit states');
    const blocked = comp.rows.find((r) => r.resolutionState === 'BLOCKED');
    assert(blocked.summary === null && blocked.analysisStatus === 'FRAME_MODEL_OUTSIDE_VALIDATED_RANGE', 'B: blocked row has the gate status, no summary');
    assert(blocked.failureReason && blocked.failureReason.length > 10, 'B: blocked row carries the failure reason');
    assert(comp.policy.includes('explicit') && comp.rankingNote.includes('never ranked'), 'B: policy + ranking note in the JSON');
    for (const r of comp.rows.filter((x) => x.resolutionState === 'ILLUSTRATIVE')) {
      assert(r.summary && /^[0-9a-f]{64}$/.test(r.analysisFingerprint) && r.siteProvenance, 'B: valid rows carry summary + fingerprint + provenance');
    }
    const [csvDl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.panel-header').getByRole('button', { name: 'CSV', exact: true }).click(),
    ]);
    const csv = parseCSV(readFileSync(await csvDl.path(), 'utf8'));
    const blockedRow = csv.rows.find((r) => r.resolution_state === 'BLOCKED');
    assert(blockedRow && blockedRow.illumination_pct === '' && blockedRow.score === '', 'B: blocked row is NOT a zero-valued valid case');
    assert(csv.rows.every((r) => r.resolution_state !== ''), 'B: no blank implicit statuses');
    await shot(page, 'v111-b-comparison-states');
    console.log('PERSONA B (comparison: valid/blocked rows exported with explicit states, never zero-filled) PASSED');
  }

  // ============ PERSONA C · Persisted state: migration + safe rejection ============
  {
    const page = await newPage();
    await page.goto(BASE);
    // Save a custom site through the real modal.
    await page.getByRole('button', { name: /Custom/ }).first().click();
    await page.waitForSelector('[role="dialog"]');
    await page.getByLabel('Site name').fill('Persisted Peak');
    await page.getByRole('button', { name: /Create site/ }).click();
    await page.waitForTimeout(500);
    assert(await page.locator('.site-item', { hasText: 'Persisted Peak' }).count() > 0, 'C: custom site created');

    // Start the isolated briefing, reach ch1, add a custom site INSIDE training.
    await page.locator('[data-tour="story-launch"]').click();
    await page.waitForSelector('.story-panel');
    await page.locator('.story-panel').getByRole('button', { name: 'Start the training mission' }).click();
    await page.waitForTimeout(900);
    await page.locator('.story-nav').getByRole('button', { name: 'Skip chapter' }).click();
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape'); // collapse the panel; keep the session
    await page.getByRole('button', { name: /Custom/ }).first().click();
    await page.waitForSelector('[role="dialog"]');
    await page.getByLabel('Site name').fill('Training Peak');
    await page.getByRole('button', { name: /Create site/ }).click();
    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForSelector('.site-rail');
    await page.waitForTimeout(1200);
    assert(await page.locator('.site-item', { hasText: 'Training Peak' }).count() > 0, 'C: training custom site survives reload (deep-validated)');
    let sess = await getSession(page);
    assert(sess && sess.v === 2, 'C: session persisted at schema v2');

    // Valid v1 legacy session migrates explicitly (one-shot init script: the app's
    // pagehide flush would otherwise overwrite an injected payload before reload).
    await page.evaluate(() => {
      window.sessionStorage.setItem('chandra-inject-v1', '1');
    });
    await page.addInitScript(({ user, training }) => {
      if (!window.sessionStorage.getItem('chandra-inject-v1')) return;
      window.sessionStorage.removeItem('chandra-inject-v1');
      window.localStorage.setItem('chandra-story-session-v1', JSON.stringify({ v: 1, user, training }));
      window.localStorage.setItem('chandra-story-v1', JSON.stringify({ v: 1, status: 'paused', chapter: 5, completed: [0, 1, 2, 3, 4], answers: {}, suggestionDismissed: true }));
    }, { user: ws(), training: ws({ slipDays: 7 }) });
    await page.reload();
    await page.waitForSelector('.site-rail');
    await page.waitForTimeout(1500);
    sess = await getSession(page);
    assert(sess && sess.v === 2 && sess.training.slipDays === 7, 'C: valid v1 session migrated to v2 with data intact');
    assert(!(await toastText(page)).includes('could not be restored'), 'C: no rejection notice for a valid migration');

    // Out-of-range stored config: rejected wholesale, never clamped, actionable recovery.
    await page.evaluate(() => { window.sessionStorage.setItem('chandra-inject-bad', '1'); });
    await page.addInitScript(() => {
      if (!window.sessionStorage.getItem('chandra-inject-bad')) return;
      window.sessionStorage.removeItem('chandra-inject-bad');
      try {
        const p = JSON.parse(window.localStorage.getItem('chandra-story-session-v1'));
        p.user.config.durationDays = 200; // beyond MISSION_LIMITS (90) — v1.9 wrongly allowed this
        p.training.config.durationDays = 200;
        window.localStorage.setItem('chandra-story-session-v1', JSON.stringify(p));
      } catch { /* ignore */ }
    });
    await page.reload();
    await page.waitForSelector('.site-rail');
    await page.waitForTimeout(1200);
    assert((await toastText(page)).includes('could not be restored'), 'C: rejected session is reported, not silently dropped');
    assert(await getSession(page) === null || (await getSession(page)).user?.config?.durationDays !== 200, 'C: out-of-range config never applied');
    await page.locator('[data-tour="story-launch"]').click();
    await page.waitForSelector('.story-panel');
    await page.waitForSelector('text=TRAINING CONTEXT UNAVAILABLE');
    const recovery = await page.locator('.story-objective').innerText();
    assert(recovery.includes('validation') && recovery.includes('Rebuild'), 'C: recovery explains the validation failure and offers Rebuild/Exit');
    await page.locator('.story-objective').getByRole('button', { name: 'Rebuild the training mission' }).click();
    await page.waitForTimeout(900);
    assert(await getSession(page) !== null, 'C: rebuild re-establishes a clean session');

    // v1.11: an oversized serialized payload is rejected before JSON.parse and
    // reported with the size-specific notice; the same Rebuild/Exit path applies.
    await page.evaluate(() => { window.sessionStorage.setItem('chandra-inject-large', '1'); });
    await page.addInitScript(() => {
      if (!window.sessionStorage.getItem('chandra-inject-large')) return;
      window.sessionStorage.removeItem('chandra-inject-large');
      const raw = window.localStorage.getItem('chandra-story-session-v1') ?? '{}';
      window.localStorage.setItem('chandra-story-session-v1', raw.padEnd(800001, ' '));
      window.localStorage.setItem('chandra-story-v1', JSON.stringify({ v: 1, status: 'paused', chapter: 5, completed: [0, 1, 2, 3, 4], answers: {}, suggestionDismissed: true }));
    });
    await page.reload();
    await page.waitForSelector('.site-rail');
    await page.waitForTimeout(1200);
    assert((await toastText(page)).includes('too large to restore safely'), 'C: oversized session reports the size-specific rejection');
    assert(await getSession(page) === null, 'C: oversized payload never applied and is cleared');
    await page.locator('[data-tour="story-launch"]').click();
    await page.waitForSelector('text=TRAINING CONTEXT UNAVAILABLE');
    await shot(page, 'v111-c-persisted-recovery');
    console.log('PERSONA C (persisted state: custom sites survive reload, v1→v2 migration, out-of-range + oversized rejected with recovery) PASSED');
  }

  // ============ PERSONA D · Data confidence: provenance on every output ============
  {
    const page = await newPage();
    await page.goto(BASE);
    await resolved(page); // default connecting-ridge = illustrative
    const ill = JSON.parse((await exportViaMenu(page, 'json')).body);
    assert(ill.reproducibility.analysisStatus.status === 'ILLUSTRATIVE', 'D: illustrative status');
    assert(ill.reproducibility.siteProvenance.dataConfidence === 'illustrative', 'D: illustrative confidence');
    assert(ill.reproducibility.warnings.some((w) => w.includes('heuristic')), 'D: heuristic-score warning');

    // Synthetic demo via Terrain Lab.
    await page.keyboard.press('t');
    await page.waitForSelector('.terrain-lab');
    await page.getByRole('button', { name: /Compute 360° horizon/ }).click();
    await page.waitForFunction(() => window.__CHANDRA_TERRAIN__?.horizon?.bins > 0, null, { timeout: 30000 });
    await page.getByRole('button', { name: /Use in mission/ }).click();
    await page.waitForTimeout(900);
    await resolved(page);
    const syn = JSON.parse((await exportViaMenu(page, 'json')).body);
    assert(syn.reproducibility.analysisStatus.status === 'SYNTHETIC_DEMO', 'D: synthetic status');
    assert(syn.summary.dataConfidence === 'synthetic', 'D: synthetic confidence separate from performance');
    assert(syn.reproducibility.terrain.disclosure.includes('NOT real lunar data'), 'D: synthetic disclosure');
    const synSummary = (await exportViaMenu(page, 'summary')).body;
    assert(synSummary.includes('SYNTHETIC_DEMO') && synSummary.includes('synthetic'), 'D: summary CSV carries the same confidence');

    // Verified ME DEM (network-boundary mock) → VALID / measured.
    const dem = await setupRealDemMocks(page);
    await page.keyboard.press('t');
    await dem.buildRealDem();
    await dem.computeHorizon();
    await dem.useInMission();
    await resolved(page);
    const me = JSON.parse((await exportViaMenu(page, 'json')).body);
    assert(me.reproducibility.analysisStatus.status === 'VALID', 'D: verified DEM status');
    assert(me.summary.dataConfidence === 'measured', 'D: measured confidence');
    assert(me.reproducibility.terrain.frameTransform === 'me' && me.reproducibility.terrain.disclosure.includes('constant'), 'D: applied transform disclosed');
    assert(me.reproducibility.terrain.validatedEpochRange.includes('2020'), 'D: validated epoch range disclosed');
    assert(me.summary.scoreBreakdown.heuristic === true, 'D: even measured terrain scores remain heuristic (confidence ≠ performance)');
    const meEvents = (await exportViaMenu(page, 'events')).body;
    assert(meEvents.split('\n')[0].includes('analysis_fingerprint'), 'D: events CSV carries provenance for the measured analysis');
    await shot(page, 'v111-d-confidence-provenance');
    console.log('PERSONA D (data confidence: illustrative/synthetic/measured exports each carry provenance; confidence ≠ performance) PASSED');
  }

  // ============ PERSONA E · Accessibility: export announcements + mobile ============
  {
    const page = await newPage();
    await page.goto(BASE);
    await resolved(page);
    // Keyboard-driven export initiation: focus the real control, operate by key.
    const exportBtn = page.getByRole('button', { name: 'Export', exact: true });
    await exportBtn.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const item = page.getByRole('button', { name: EXPORT_LABELS.json, exact: true });
    await item.focus();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
    assert(dl.suggestedFilename().endsWith('.json'), 'E: keyboard export initiates a real download');
    await page.waitForTimeout(400);
    const initiated = await toastText(page);
    assert(initiated.toLowerCase().includes('initiated'), 'E: status announcement says initiated (never claims the file was saved)');
    assert(!/\bsaved\b/i.test(initiated), 'E: no false file-save claim');

    // Refusal is announced through the same live region: blocked DEM at 2040.
    const dem = await setupRealDemMocks(page);
    await page.keyboard.press('t');
    await dem.buildRealDem();
    await dem.computeHorizon();
    await dem.useInMission();
    await page.getByLabel('Mission start date (UTC)').fill('2040-06-01');
    await page.getByLabel('Mission start date (UTC)').blur();
    await page.waitForSelector('[role="alert"]', { timeout: 30000 });
    let downloadFired = false;
    page.once('download', () => { downloadFired = true; });
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('button', { name: EXPORT_LABELS.json, exact: true }).click();
    await page.waitForTimeout(700);
    assert(!downloadFired, 'E: blocked analysis never downloads');
    const refusal = await toastText(page);
    assert(refusal.includes('blocked') || refusal.includes('BLOCKED') || refusal.includes('FRAME_MODEL'), 'E: refusal reason announced in the live region');
    assert(await page.locator('[role="alert"]').count() > 0, 'E: blocked-analysis notice present');
    await shot(page, 'v111-e-refusal-announced');

    // Mobile layout + reduced motion: export controls remain reachable.
    const mob = await newPage({ viewport: { width: 390, height: 844 } });
    await mob.emulateMedia({ reducedMotion: 'reduce' });
    await mob.goto(BASE);
    await mob.waitForSelector('.site-rail', { timeout: 30000 });
    const mExport = mob.getByRole('button', { name: 'Export', exact: true });
    assert(await mExport.count() > 0, 'E: export control present at 390px');
    await mExport.click();
    assert(await mob.getByRole('button', { name: EXPORT_LABELS.energy, exact: true }).count() > 0, 'E: energy-history export reachable on mobile');
    await mob.keyboard.press('Escape');
    await shot(mob, 'v111-e-mobile-390');
    console.log('PERSONA E (accessibility: keyboard initiation + refusal announcements, blocked notices, mobile + reduced motion) PASSED');
  }

  const realErrors = allConsole.filter((m) => !/Failed to load resource.*\b(400|404)\b/.test(m) && !/favicon/.test(m));
  assert(allErrors.length === 0, `no page errors (got: ${allErrors.slice(0, 3).join(' | ')})`);
  assert(realErrors.length === 0, `no unexpected console errors (got: ${realErrors.slice(0, 3).join(' | ')})`);
  console.log(`\nALL v1.11 EXPORT PERSONAS (A–E) PASSED in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
} catch (err) {
  console.error(String(err));
  for (const ctx of contexts) {
    for (const p of ctx.pages()) await p.screenshot({ path: `${OUT}/v111-failure-${Date.now()}.png`, timeout: 10000 }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
