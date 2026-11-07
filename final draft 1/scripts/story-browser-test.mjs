/**
 * THE 14-DAY WINDOW — v1.9 story tutorial browser tests (personas A–E).
 *
 * Real interactions and state assertions, not text-presence checks:
 *   A  existing user — 3 pre-existing pins + custom config + playback → briefing
 *                      isolates a clean training workspace, ch7 demands NEW
 *                      distinct resolved scenarios (identical repeats refused),
 *                      completion restores the user's workspace EXACTLY
 *   B  export truth  — CSV exports never credit ch8; a blocked analysis never
 *                      downloads; only a guard-passing JSON report (provenance +
 *                      warnings verified in the file) earns credit
 *   C  refresh       — reload at ch5 and ch7 restores the exact training context
 *                      (slip, pins, chapter, baseline); corrupt/missing session →
 *                      explicit Rebuild/Exit recovery, never silent defaults
 *   D  invalid data  — genuine Real-DEM pipeline (API mocked at the network
 *                      boundary): ME import → epoch 2040 → blocked analysis,
 *                      export refusal, gated visual AND screen-reader descriptions,
 *                      withheld horizon clearances; unknown frame AND incomplete
 *                      coverage imports both refused with actionable alerts
 *   E  mobile a11y   — 390×844 + 320×568: keyboard-only activation, focus management,
 *                      modal focus trap + restore, Escape pause/resume, collapse,
 *                      reduced motion, contrast ratios, no horizontal overflow
 *
 * NOTE on persona D: NASA DEM downloads are unavailable in CI, so DEM API responses
 * are stubbed at the network boundary ONLY. Frame classification, ME→IAU conversion,
 * import gating, computation-boundary analysis status, narrative branching, a11y
 * descriptions and the export guard all run live in the browser. The deeper blocked
 * statuses unreachable through the UI (import gate fires first) are unit-tested.
 * Automated aria-label checks are NOT a screen-reader pass; see the manual NVDA/
 * VoiceOver checklist in docs/ACCESSIBILITY_AUDIT.md.
 *
 * Run: node scripts/story-browser-test.mjs   (needs npm run dev:full on :5173/:8000)
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
// IMPORTANT (single-process Chromium): never close extra contexts mid-run — the
// shared renderer teardown kills every page. All contexts close with browser.close().
const contexts = [];
async function newPage({ onboarded = true, story = null, viewport = { width: 1600, height: 1000 } } = {}) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  contexts.push(ctx);
  // Sparticuz --single-process Chromium shares one profile across contexts
  // (localStorage leaks between them). Seed deterministically ONCE per tab via a
  // sessionStorage marker (tab-isolated, survives reload) so reload-persistence
  // assertions still test the app's own writes. Harness quirk, not app behavior.
  await ctx.addInitScript(({ onboardedFlag, storyJson }) => {
    if (window.sessionStorage.getItem('chandra-test-seeded')) return;
    window.localStorage.clear();
    if (onboardedFlag) window.localStorage.setItem('chandra-onboarded-v1', '1');
    if (storyJson) window.localStorage.setItem('chandra-story-v1', storyJson);
    window.sessionStorage.setItem('chandra-test-seeded', '1');
  }, { onboardedFlag: onboarded, storyJson: story ? JSON.stringify(story) : null });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  page.on('pageerror', (e) => allErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') allConsole.push(m.text()); });
  return page;
}
const setRange = (loc, v) => loc.evaluate((el, val) => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(el, String(val)); el.dispatchEvent(new Event('input', { bubbles: true }));
}, v);
const title = (page) => page.locator('.story-title').innerText();
const nextEnabled = (page) => page.waitForFunction(() => {
  const b = [...document.querySelectorAll('.story-nav button')].find((x) => /Next chapter|Finish briefing/.test(x.textContent || ''));
  return !!b && !b.disabled;
}, null, { timeout: 30000 });
const clickNext = async (page) => { await nextEnabled(page); await page.locator('.story-nav button', { hasText: /Next chapter|Finish briefing/ }).click(); await page.waitForTimeout(350); };
const answerCheck = async (page, idx) => { await page.locator('.story-opt').nth(idx).click(); await page.waitForTimeout(150); };
const objectiveMet = (page) => page.waitForSelector('.story-objective.met', { timeout: 30000 });
const objectiveUnmet = async (page) => { await page.waitForTimeout(600); assert(await page.locator('.story-objective.met').count() === 0, 'objective must NOT be credited'); };
const skipChapters = async (page, n) => { for (let i = 0; i < n; i++) { await page.locator('.story-nav').getByRole('button', { name: 'Skip chapter' }).click(); await page.waitForTimeout(300); } };
const focusPress = async (loc, key = 'Enter') => { await loc.focus(); await loc.press(key); };
const getSession = (page) => page.evaluate(() => { try { return JSON.parse(window.localStorage.getItem('chandra-story-session-v1')); } catch { return null; } });
// Best-effort captures: let workers settle first (SwiftShader can stall captures
// mid-compute); the state assertions are the actual verification.
const shot = async (page, name) => {
  await page.waitForTimeout(1500);
  await page.screenshot({ animations: 'disabled', path: `${OUT}/${name}.png`, timeout: 25000 }).catch(() => {});
};
const startFromLauncher = async (page) => { await page.locator('[data-tour="story-launch"]').click(); await page.waitForSelector('.story-panel'); };
const chooseTraining = async (page) => {
  await page.locator('.story-panel').getByRole('button', { name: 'Start the training mission' }).click();
  await page.waitForTimeout(900);
};
const pinViaStory = async (page) => {
  await page.locator('.story-objective').getByRole('button', { name: 'Pin this window & compare' }).click();
  await page.waitForTimeout(700);
};

/**
 * Stub the DEM API at the NETWORK BOUNDARY ONLY (NASA downloads are unavailable in
 * CI). Everything downstream — frame classification, ME→IAU conversion, import
 * gating, analysis status, a11y descriptions, export guard — runs live. The explicit
 * buildRealDem workflow never relies on the auto-real race that broke v1.8 on CI.
 */
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
  let horizonFrame = 'MOON_ME (JPL DE421)';
  let horizonCoverage = 100;
  let horizonCalls = 0;
  let terrainCalls = 0;
  const horizonPayload = () => ({
    latitude: -89.5, longitude: 45, radius_km: 5, horizon_radius_km: 4.5, edge_inset_m: 28.3,
    sampling_step_m: 20, grid_size: SIZE, grid_spacing_m: 78.1, eye_height_m: 2, azimuth_step_deg: 1,
    azimuths_deg: azimuths, elevations_deg: azimuths.map(() => 0.5),
    ray_coverage_percent: azimuths.map(() => horizonCoverage), max_obstacle_range_km: azimuths.map(() => 4),
    mean_coverage_percent: horizonCoverage, synthetic: false,
    source: { ...source, lunar_reference_frame: horizonFrame },
    model: 'ray-marched local horizon', frame_note: 'Test fixture payload.',
  });
  await page.route('**/api/config', (r) => r.fulfill({ json: {
    dem_ready: true, source, dem_error: null, quality_grids: { low: 65, medium: 129, high: 257 },
    radius_limits_km: [0.5, 20], latitude_convention: 'planetocentric', longitude_convention: '0-360E',
    synthetic_warning: 'demo', render_coordinates: 'IAU', geometry_model: 'sphere',
  } }));
  await page.route('**/api/terrain', (r) => { terrainCalls += 1; return r.fulfill({ json: terrainPayload }); });
  await page.route('**/api/horizon', (r) => { horizonCalls += 1; return r.fulfill({ json: horizonPayload() }); });
  const buildRealDem = async () => {
    await page.waitForSelector('.terrain-lab');
    // Config arrival marks the backend online (and flips the source select to real).
    await page.waitForFunction(() => document.querySelector('#terrain-mode')?.value === 'real', null, { timeout: 20000 });
    await page.locator('#terrain-mode').selectOption('real');
    await page.locator('.terrain-lab').getByRole('button', { name: 'Build terrain' }).click();
    // The loaded model must be REAL DEM data before any horizon is computed.
    await page.waitForFunction(() => window.__CHANDRA_TERRAIN__?.mode === 'real', null, { timeout: 30000 });
    await page.waitForSelector('text=TEST_FIXTURE_ME.tif', { timeout: 30000 });
    assert(await page.locator('.terrain-lab').getByText('Real DEM', { exact: false }).count() > 0, 'model identified as real DEM');
  };
  return {
    buildRealDem,
    setFrame: (f) => { horizonFrame = f; },
    setCoverage: (c) => { horizonCoverage = c; },
    calls: () => ({ horizon: horizonCalls, terrain: terrainCalls }),
  };
}

try {
  // ============ PERSONA A · existing user: isolation + exact restore ============
  {
    const page = await newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    // Build a real user workspace: site + preset + 3 distinct pins + playback.
    await page.locator('.site-item', { hasText: 'Haworth' }).first().click();
    await page.locator('[aria-label="Mission parameters"]').click();
    await page.waitForSelector('[role="dialog"]');
    await page.locator('[role="dialog"]').getByRole('button', { name: /Small robotic lander/ }).click();
    await page.waitForTimeout(200);
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Done' }).click();
    const slip = page.locator('[data-tour="slip"]');
    for (const v of [3, 6, 9]) {
      await setRange(slip, v);
      await page.waitForTimeout(500);
      await page.keyboard.press('p');
      await page.waitForTimeout(500);
    }
    assert(await page.locator('text=3/4 pinned').count() > 0, 'A: three pre-existing user pins');
    await page.keyboard.press('c'); // back to planner
    await page.getByRole('button', { name: /^Play/ }).click(); // playback ON
    await page.waitForTimeout(300);
    assert(await page.getByRole('button', { name: /^Pause/ }).count() > 0, 'A: user playback running');

    await startFromLauncher(page);
    assert((await title(page)).includes('First shift'), 'A: ch0');
    await chooseTraining(page);
    // ISOLATION: training workspace is clean; the user's 3 pins are preserved, not merged.
    assert(await page.locator('.site-item.selected', { hasText: 'Connecting Ridge' }).count() > 0, 'A: training site loaded');
    assert(await page.getByRole('button', { name: /^Play/ }).count() > 0, 'A: playback paused for training');
    const sess = await getSession(page);
    assert(sess && sess.user.scenarios.length === 3 && sess.user.playing === true && sess.user.slipDays === 9, 'A: user workspace (3 pins, playback, slip) snapshotted');
    assert(sess.training.scenarios.length === 0, 'A: isolated training workspace starts empty');
    await page.keyboard.press('c');
    await page.waitForTimeout(400);
    assert(await page.locator('text=0/4 pinned').count() > 0, 'A: user pins invisible inside training');
    await page.keyboard.press('c');
    await shot(page, '15-story-isolation');

    // Advance to the comparison chapter; pre-existing pins must not credit it.
    await skipChapters(page, 6);
    assert((await title(page)).includes('Compare like with like'), 'A: ch7');
    await objectiveUnmet(page);
    assert(await page.locator('.story-panel').getByText('Nothing pinned in this briefing yet', { exact: false }).count() > 0, 'A: 3 user pins earn zero tutorial credit');
    await pinViaStory(page);
    await objectiveUnmet(page);
    await pinViaStory(page); // identical repeat — same site/start/config
    await objectiveUnmet(page);
    assert(await page.locator('.story-panel').getByText('One briefing window pinned', { exact: false }).count() > 0, 'A: identical repeat is not a comparison');
    assert(await page.locator('text=2/4 pinned').count() > 0, 'A: both pins really exist in the matrix');
    // A genuinely different window completes the pair; credit waits for resolution.
    await setRange(slip, 7);
    await page.waitForTimeout(900);
    await pinViaStory(page);
    await objectiveMet(page);
    const readouts = await page.locator('.story-readouts').innerText();
    assert(/Sun \+ Earth/.test(readouts) && /Confidence tiers/.test(readouts), 'A: narrative reads real resolved deltas');
    await shot(page, '16-story-ch7-compare');
    await answerCheck(page, 0);
    await clickNext(page);
    assert((await title(page)).includes('File the report'), 'A: ch8');
    await page.waitForFunction(() => document.querySelector('.story-readouts')?.textContent?.includes('Samples / effective step'), null, { timeout: 40000 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.story-objective').getByRole('button', { name: 'Export mission report (.json)' }).click(),
    ]);
    assert(download.suggestedFilename().endsWith('.json'), 'A: real report downloaded');
    await objectiveMet(page);
    await clickNext(page);
    await page.waitForSelector('text=Shift complete');
    await page.waitForTimeout(700);

    // EXACT RESTORE on completion: site, slip, config, pins, playback all return.
    assert(await page.locator('.site-item.selected', { hasText: 'Haworth' }).count() > 0, 'A: user site restored');
    assert(await slip.inputValue() === '9', 'A: user slip restored');
    assert(await page.getByRole('button', { name: /^Pause/ }).count() > 0, 'A: user playback restored');
    assert(await getSession(page) === null, 'A: training session cleared after completion');
    await page.keyboard.press('c');
    await page.waitForTimeout(400);
    assert(await page.locator('text=3/4 pinned').count() > 0, 'A: the user\'s exact 3 pins restored');
    await page.keyboard.press('c');
    await page.locator('[aria-label="Mission parameters"]').click();
    assert(await page.locator('[role="dialog"]').getByLabel('Array area', { exact: false }).inputValue() === '2', 'A: user config restored (2 m² preset)');
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Done' }).click();
    await shot(page, '17-story-restored');
    await page.locator('.story-panel').getByRole('button', { name: 'Explore the planner' }).click();
    await page.waitForTimeout(400);
    assert(await page.locator('.story-panel').count() === 0, 'A: debrief closes');
    const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('chandra-story-v1')));
    assert(stored.status === 'completed', 'A: completion persisted');
    console.log('PERSONA A (existing user: isolation + new-scenario witness + exact restore) PASSED');
  }

  // ============ PERSONA B · export correctness: CSV/blocked never credit ============
  {
    const page = await newPage();
    const dem = await setupRealDemMocks(page);
    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await startFromLauncher(page);
    await chooseTraining(page);
    // Import the (stubbed) ME-frame DEM so the blocked-export branch is reached
    // through the GENUINE pipeline: the constant ME→IAU correction is only
    // validated 2020–2035, so epoch 2040 blocks THIS site (illustrative IAU-frame
    // sites are correctly NOT epoch-gated — there is no correction to extrapolate).
    await page.keyboard.press('t');
    await dem.buildRealDem();
    await page.locator('.terrain-lab').getByRole('button', { name: 'Compute 360° horizon' }).click();
    await page.waitForSelector('button:has-text("Use in mission")');
    await page.locator('.terrain-lab').getByRole('button', { name: 'Use in mission' }).click();
    await page.waitForTimeout(900);
    await skipChapters(page, 7);
    assert((await title(page)).includes('File the report'), 'B: ch8');
    await page.waitForFunction(() => document.querySelector('.story-readouts')?.textContent?.includes('Samples / effective step'), null, { timeout: 40000 });

    // CSV exports are real downloads but NEVER credit the mission-report objective.
    for (const label of ['Telemetry timeseries (.csv)', 'Window summary (.csv)']) {
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      const [dl] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: label, exact: true }).click(),
      ]);
      assert(dl.suggestedFilename().endsWith('.csv'), `B: ${label} downloaded`);
      await objectiveUnmet(page);
    }
    assert(downloads.length === 2, 'B: both CSVs really downloaded');

    // Blocked analysis: the guard refuses the JSON report — no download, no credit.
    await page.getByLabel('Mission start date (UTC)').fill('2040-01-01');
    await page.getByLabel('Mission start date (UTC)').blur();
    await page.waitForFunction(() => document.querySelector('.story-readouts')?.textContent?.includes('FRAME_MODEL_OUTSIDE_VALIDATED_RANGE'), null, { timeout: 40000 });
    await page.locator('.story-objective').getByRole('button', { name: 'Export mission report (.json)' }).click();
    await page.waitForTimeout(1200);
    assert(downloads.length === 2, 'B: blocked analysis never downloads');
    assert(await page.locator('[role="status"]').innerText().then((t) => /Export blocked/.test(t)).catch(() => false), 'B: refusal explained');
    await objectiveUnmet(page);
    assert(await page.locator('.story-nav button', { hasText: 'Finish briefing' }).isDisabled(), 'B: cannot finish on refused/CSV exports');
    await shot(page, '18-story-export-blocked');

    // Valid window: the JSON report downloads WITH provenance + warnings, and credits.
    await page.getByLabel('Mission start date (UTC)').fill('2026-09-01');
    await page.getByLabel('Mission start date (UTC)').blur();
    await page.waitForFunction(() => document.querySelector('.story-readouts')?.textContent?.includes('Samples / effective step'), null, { timeout: 40000 });
    const [report] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.story-objective').getByRole('button', { name: 'Export mission report (.json)' }).click(),
    ]);
    assert(report.suggestedFilename().endsWith('.json'), 'B: JSON report downloaded');
    const body = readFileSync(await report.path(), 'utf8');
    const parsed = JSON.parse(body);
    assert(body.includes('siteProvenance') && body.includes('analysisStatus'), 'B: report carries provenance + analysis status');
    assert(Array.isArray(parsed.reproducibility?.warnings) && parsed.reproducibility.warnings.length > 0 && body.includes('LOCAL HORIZON'), 'B: report carries honest warnings');
    await objectiveMet(page);
    await clickNext(page);
    await page.waitForSelector('text=Shift complete');
    await page.locator('.story-panel').getByRole('button', { name: 'Explore the planner' }).click();
    await page.waitForTimeout(400);
    assert(await getSession(page) === null, 'B: session cleared on completion');
    console.log('PERSONA B (export correctness: CSV/blocked never credit, JSON provenance verified) PASSED');
  }

  // ============ PERSONA C · refresh/resume at ch5 + ch7, corrupt recovery ============
  {
    const page = await newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await startFromLauncher(page);
    // Explore-first leaves state untouched; Field Guide resumes at ch0.
    const before = await page.locator('.site-item.selected').innerText();
    await page.locator('.story-panel').getByRole('button', { name: 'Explore first' }).click();
    await page.waitForTimeout(400);
    assert(await page.locator('.story-panel').count() === 0, 'C: explore-first exits');
    assert((await page.locator('.site-item.selected').innerText()) === before, 'C: explore-first leaves state untouched');
    await page.locator('[aria-label="Field Guide"]').click();
    await page.locator('[data-tour="story-guide-card"]').getByRole('button', { name: 'Resume the briefing' }).click();
    await page.waitForSelector('.story-panel');
    await chooseTraining(page);
    await skipChapters(page, 4);
    assert((await title(page)).includes('The slip'), 'C: ch5');
    await setRange(page.locator('[data-tour="slip"]'), 14);
    await objectiveMet(page);
    await answerCheck(page, 1);
    await page.waitForTimeout(600); // allow debounced persist before reload

    // REFRESH at ch5: training context (site, slip, chapter, baseline) survives.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    assert(await page.locator('.story-panel').count() === 0, 'C: reload never force-opens the panel');
    assert(await page.locator('.story-suggestion').count() === 0, 'C: no repeated suggestion');
    assert(await page.locator('[data-tour="story-launch"]').innerText().then((t) => /Resume briefing/.test(t)), 'C: launcher offers Resume');
    assert(await page.locator('.site-item.selected', { hasText: 'Connecting Ridge' }).count() > 0, 'C: training site restored after refresh');
    assert(await page.locator('[data-tour="slip"]').inputValue() === '14', 'C: ch5 slip restored exactly');
    await startFromLauncher(page);
    assert((await title(page)).includes('The slip'), 'C: resumed at ch5');
    await objectiveMet(page); // persisted baseline keeps the slip change credited
    assert(await page.locator('.story-feedback').count() > 0, 'C: ch5 answer survived the refresh');
    await shot(page, '19-story-refresh-ch5');
    await clickNext(page); // ch6
    await answerCheck(page, 1);
    await clickNext(page); // ch7
    assert((await title(page)).includes('Compare like with like'), 'C: ch7');
    await pinViaStory(page);
    await setRange(page.locator('[data-tour="slip"]'), 0);
    await page.waitForTimeout(900);
    await pinViaStory(page);
    await objectiveMet(page);
    await page.waitForTimeout(600);

    // REFRESH at ch7: pins + chapter + witness survive; results re-resolve.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    assert(await page.locator('.story-panel').count() === 0, 'C: ch7 reload keeps panel closed');
    const sess7 = await getSession(page);
    assert(sess7 && sess7.training.scenarios.length === 2, 'C: both training pins persisted');
    // ch7 restores the COMPARISON view; the planner launcher isn't rendered there,
    // so resume via the Field Guide — the path that works from every view.
    await page.locator('[aria-label="Field Guide"]').click();
    await page.locator('[data-tour="story-guide-card"]').getByRole('button', { name: 'Resume the briefing' }).click();
    await page.waitForSelector('.story-panel');
    assert((await title(page)).includes('Compare like with like'), 'C: resumed at ch7');
    assert(await page.locator('text=2/4 pinned').count() > 0, 'C: pins restored into the matrix');
    await objectiveMet(page); // witness re-resolves the restored pins
    await answerCheck(page, 0);
    await clickNext(page); // ch8
    assert((await title(page)).includes('File the report'), 'C: ch8 after refresh-resume');

    // CORRUPT session: explicit recovery, never silent defaults. The app flushes
    // its live session on pagehide (correct behavior), so corruption must be
    // injected by a one-shot init script that runs BEFORE app code on the next
    // load — simulating real on-disk corruption, not fighting the flush.
    await page.addInitScript(() => {
      if (window.sessionStorage.getItem('chandra-corrupt-once')) return;
      window.localStorage.setItem('chandra-story-session-v1', '{corrupt');
      window.sessionStorage.setItem('chandra-corrupt-once', '1');
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await startFromLauncher(page);
    await page.waitForSelector('.story-panel [role="alert"]');
    assert(await page.locator('.story-panel [role="alert"]').innerText().then((t) => /TRAINING CONTEXT UNAVAILABLE/.test(t)), 'C: corrupt session surfaced honestly');
    assert(await page.locator('.story-nav button', { hasText: /Next chapter|Finish briefing/ }).count() === 0, 'C: no chapter navigation while context is lost');
    await shot(page, '20-story-recovery');
    await page.locator('.story-panel').getByRole('button', { name: 'Rebuild the training mission' }).click();
    await page.waitForTimeout(900);
    assert((await title(page)).includes('File the report'), 'C: rebuild keeps the saved chapter');
    assert(await page.locator('.site-item.selected', { hasText: 'Connecting Ridge' }).count() > 0, 'C: rebuild loads a fresh training mission');
    assert(await getSession(page) !== null, 'C: rebuild re-establishes the session');
    await page.locator('[aria-label="Exit briefing and restore my previous setup"]').click();
    await page.waitForTimeout(500);
    assert(await page.locator('.site-item.selected', { hasText: 'Shackleton' }).count() > 0, 'C: exit after rebuild restores the captured workspace');
    assert(await getSession(page) === null, 'C: exit clears the session');

    // v1.8 progress without any session key: same honest recovery path.
    await page.evaluate(() => {
      window.localStorage.removeItem('chandra-story-session-v1');
      window.localStorage.setItem('chandra-story-v1', JSON.stringify({ v: 1, status: 'paused', chapter: 5, completed: [0, 1, 2, 3, 4], answers: {}, suggestionDismissed: true }));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    assert(await page.locator('.story-panel').count() === 0, 'C: v1.8 save never force-opens');
    await startFromLauncher(page);
    await page.waitForSelector('.story-panel [role="alert"]');
    assert(await page.locator('.story-panel').getByText('predates v1.9', { exact: false }).count() > 0, 'C: v1.8 gap explained');
    await page.locator('.story-panel').getByRole('button', { name: 'Exit the briefing' }).click();
    await page.waitForTimeout(400);
    assert(await page.locator('.story-panel').count() === 0, 'C: recovery exit works');
    console.log('PERSONA C (refresh at ch5/ch7 + corrupt/v1.8 recovery) PASSED');
  }

  // ============ PERSONA D · invalid data: honest refusal everywhere ============
  {
    const page = await newPage();
    const dem = await setupRealDemMocks(page);

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await startFromLauncher(page);
    await chooseTraining(page);
    // Visit 1: allowlisted ME frame + full coverage imports through the REAL pipeline.
    await page.keyboard.press('t');
    await dem.buildRealDem();
    const callsBeforeFirst = dem.calls().horizon;
    await page.locator('.terrain-lab').getByRole('button', { name: 'Compute 360° horizon' }).click();
    await page.waitForSelector('button:has-text("Use in mission")');
    assert(dem.calls().horizon > callsBeforeFirst, 'D: real horizon API actually called (visit 1)');
    assert(dem.calls().terrain > 0, 'D: real terrain API actually called');
    const useBtn = page.locator('.terrain-lab').getByRole('button', { name: 'Use in mission' });
    assert(await useBtn.isEnabled(), 'D: allowlisted ME frame + full coverage imports');
    await useBtn.click();
    await page.waitForTimeout(900);
    await objectiveMet(page); // ch1: site changed to the DEM site
    await answerCheck(page, 1);
    await clickNext(page); // ch2
    await page.waitForFunction(() => document.querySelector('.story-readouts')?.textContent?.includes('Window illumination'), null, { timeout: 40000 });

    // Epoch 2040: outside the SPICE-validated range → everything gates consistently.
    await page.getByLabel('Mission start date (UTC)').fill('2040-01-01');
    await page.getByLabel('Mission start date (UTC)').blur();
    await page.waitForFunction(() => document.querySelector('.story-readouts')?.textContent?.includes('FRAME_MODEL_OUTSIDE_VALIDATED_RANGE'), null, { timeout: 40000 });
    const blockedText = await page.locator('.story-panel').innerText();
    assert(/blocked/i.test(blockedText), 'D: narrative says blocked');
    assert(/outside that range|only SPICE-validated/.test(blockedText), 'D: actual reason quoted');
    assert(!/Window illumination/.test(blockedText) && !/Verdict/.test(blockedText), 'D: no quantitative readouts or verdict while blocked');
    assert(await page.locator('.telemetry-rail .chip', { hasText: 'Visibility blocked' }).count() > 0, 'D: telemetry header gated');
    assert(await page.locator('.telemetry-rail').getByText('Window viable', { exact: false }).count() === 0, 'D: no Window-viable claim');
    assert(await page.locator('text=Sun visibility blocked').count() > 0, 'D: panorama Sun chip gated');
    assert(await page.locator('text=Earth visibility blocked').count() > 0, 'D: panorama Earth chip gated');
    // Screen-reader descriptions must not out-claim the visuals (automated label
    // check — NOT a screen-reader pass; manual checklist lives in the docs).
    const panoLabel = await page.getByRole('img', { name: /Local horizon panorama/ }).getAttribute('aria-label');
    assert(/BLOCKED/.test(panoLabel) && !/\bvisible\b/.test(panoLabel) && !/DTE open/.test(panoLabel), 'D: panorama aria-label claims positions only');
    const demNote = await page.getByRole('note', { name: 'Terrain data status' }).innerText();
    assert(/FRAME_MODEL_OUTSIDE_VALIDATED_RANGE/.test(demNote), 'D: DEM footer quotes the assessment');
    const tlLabel = await page.getByRole('img', { name: /Mission timeline/ }).getAttribute('aria-label');
    assert(/BLOCKED/.test(tlLabel) && !/percent sunlit/.test(tlLabel), 'D: timeline aria-label gated');
    const mapLabel = await page.getByRole('img', { name: /Stereographic map/ }).getAttribute('aria-label');
    assert(/unverified/.test(mapLabel), 'D: map aria-label flags azimuth-only vector');
    // Horizon table: clearance columns withheld, CSV disabled at the blocked epoch.
    await page.locator('.panel').getByRole('button', { name: 'Horizon table' }).first().click();
    await page.waitForSelector('[role="dialog"]');
    assert(await page.locator('[role="dialog"] td', { hasText: 'blocked' }).count() > 0, 'D: horizon table withholds clearances');
    assert(await page.locator('[role="dialog"]').getByRole('button', { name: 'CSV' }).isDisabled(), 'D: horizon CSV disabled at blocked epoch');
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Close dialog' }).click();
    await shot(page, '21-story-blocked');

    // ch8: the export guard refuses the blocked window.
    await skipChapters(page, 6);
    assert((await title(page)).includes('File the report'), 'D: reached ch8 via skips');
    let downloaded = false;
    page.on('download', () => { downloaded = true; });
    await page.locator('.story-objective').getByRole('button', { name: 'Export mission report (.json)' }).click();
    await page.waitForTimeout(1200);
    assert(!downloaded, 'D: blocked analysis never downloads');
    assert(await page.locator('[role="status"]').innerText().then((t) => /Export blocked/.test(t)).catch(() => false), 'D: export guard explains the refusal');
    await objectiveUnmet(page);
    assert(await page.locator('.story-nav button', { hasText: 'Finish briefing' }).isDisabled(), 'D: cannot finish via a refused export');

    // Visit 2: UNKNOWN frame — full explicit real workflow, import gate refuses.
    dem.setFrame('WEIRD_TEST_FRAME');
    await page.keyboard.press('t');
    await dem.buildRealDem();
    const callsBeforeSecond = dem.calls().horizon;
    await page.locator('.terrain-lab').getByRole('button', { name: 'Compute 360° horizon' }).click();
    await page.waitForSelector('.terrain-lab [role="alert"]');
    assert(dem.calls().horizon > callsBeforeSecond, 'D: mocked horizon endpoint exercised (visit 2)');
    const frameAlert = await page.locator('.terrain-lab [role="alert"]').innerText();
    assert(/FRAME UNVERIFIED/.test(frameAlert) && /WEIRD_TEST_FRAME/.test(frameAlert), 'D: unknown frame identified by name');
    assert(/allowlist|confirmed compatible/.test(frameAlert), 'D: frame warning actionable');
    assert(await page.locator('.terrain-lab').getByRole('button', { name: 'Use in mission' }).isDisabled(), 'D: unknown-frame import disabled');

    // Visit 3: allowlisted frame but INCOMPLETE ray coverage — import still refuses.
    await page.keyboard.press('t'); // close lab
    await page.waitForTimeout(400);
    dem.setFrame('MOON_ME (JPL DE421)');
    dem.setCoverage(92);
    await page.keyboard.press('t');
    await dem.buildRealDem();
    const callsBeforeThird = dem.calls().horizon;
    await page.locator('.terrain-lab').getByRole('button', { name: 'Compute 360° horizon' }).click();
    await page.waitForSelector('.terrain-lab [role="alert"]');
    assert(dem.calls().horizon > callsBeforeThird, 'D: mocked horizon endpoint exercised (visit 3)');
    const covAlert = await page.locator('.terrain-lab [role="alert"]').innerText();
    assert(/incomplete ray coverage/i.test(covAlert), 'D: incomplete coverage identified');
    assert(/wider crop|covered location/.test(covAlert), 'D: coverage warning actionable');
    assert(await page.locator('.terrain-lab').getByRole('button', { name: 'Use in mission' }).isDisabled(), 'D: incomplete-coverage import disabled');
    console.log('PERSONA D (unverified frame + incomplete coverage + out-of-range epoch + gated a11y) PASSED');
  }

  // ============ PERSONA E · mobile keyboard/focus/reduced-motion/contrast ============
  {
    const page = await newPage({ onboarded: false, viewport: { width: 390, height: 844 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    // Fresh mobile user: onboarding → suggestion → keyboard-only briefing start.
    await page.waitForSelector('[role="dialog"]');
    await focusPress(page.getByRole('button', { name: 'Skip for now' }));
    await page.waitForSelector('.story-suggestion');
    await focusPress(page.locator('.story-suggestion').getByRole('button', { name: 'Start the briefing' }));
    await page.waitForSelector('.story-panel');
    assert((await title(page)).includes('First shift'), 'E: ch0 via keyboard');
    await focusPress(page.locator('.story-panel').getByRole('button', { name: 'Start the training mission' }));
    await page.waitForTimeout(900);
    assert(await page.evaluate(() => document.activeElement?.className.includes('story-title')), 'E: focus lands on the chapter heading');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 1, `E: no horizontal overflow at 390px (${overflow}px)`);
    const box = await page.locator('.story-panel').boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= 391 && box.y + box.height <= 845, 'E: panel fits the viewport');
    // Collapse / expand with keyboard, aria-expanded tracked.
    await focusPress(page.locator('[aria-label="Collapse briefing panel"]'));
    assert(await page.locator('.story-panel.collapsed').count() === 1, 'E: collapses to header');
    assert(await page.locator('[aria-label="Expand briefing panel"]').getAttribute('aria-expanded') === 'false', 'E: aria-expanded false');
    await focusPress(page.locator('[aria-label="Expand briefing panel"]'));
    assert(await page.locator('.story-body').count() === 1, 'E: expands again');
    // Real site selection + check + navigation, all via keyboard.
    await focusPress(page.locator('.site-item', { hasText: 'Haworth' }).first());
    await objectiveMet(page);
    await focusPress(page.locator('.story-opt').nth(1));
    assert(await page.locator('.story-feedback').innerText().then((t) => t.startsWith('Correct.')), 'E: check answered via keyboard');
    await focusPress(page.locator('.story-nav button', { hasText: 'Next chapter' }));
    await page.waitForTimeout(400);
    assert((await title(page)).includes('Follow the Sun'), 'E: ch2 via keyboard');
    // Primary action focuses the REAL scrubber; native arrow keys do the work.
    await focusPress(page.locator('.story-objective').getByRole('button', { name: 'Focus the time scrubber' }));
    assert(await page.evaluate(() => document.activeElement?.getAttribute('data-tour')) === 'scrubber', 'E: primary focuses the real scrubber');
    for (let i = 0; i < 35; i++) await page.keyboard.press('ArrowRight');
    await objectiveMet(page);
    // Reduced motion: spotlight must not animate.
    const dur = await page.locator('.story-spotlight').evaluate((el) => getComputedStyle(el).transitionDuration);
    assert(dur === '0s', `E: reduced motion disables spotlight transition (${dur})`);
    // Contrast: dialogue + objective text ≥ 4.5:1 against the panel background.
    const ratios = await page.evaluate(() => {
      const lum = (rgb) => {
        const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => v / 255)
          .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (fg, bg) => { const a = lum(fg); const b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
      const panelBg = getComputedStyle(document.querySelector('.story-panel')).backgroundColor;
      const line = document.querySelector('.story-line p');
      const obj = document.querySelector('.story-objective p');
      return {
        dialogue: ratio(getComputedStyle(line).color, panelBg),
        objective: ratio(getComputedStyle(obj).color, panelBg),
      };
    });
    assert(ratios.dialogue >= 4.5 && ratios.objective >= 4.5, `E: text contrast ≥ 4.5 (${ratios.dialogue.toFixed(2)}, ${ratios.objective.toFixed(2)})`);
    // Modal focus trap + restore (Settings via the header control).
    await page.locator('[aria-label="Mission parameters"]').click();
    await page.waitForSelector('[role="dialog"]');
    assert(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), 'E: focus enters the dialog');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
    assert(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), 'E: Tab stays trapped');
    await page.keyboard.press('Shift+Tab');
    assert(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), 'E: Shift+Tab stays trapped');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert(await page.locator('[role="dialog"]').count() === 0, 'E: Escape closes the dialog');
    assert(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Mission parameters', 'E: focus restored to the opener');
    // Escape pauses the briefing (focus off inputs first, as a keyboard user would).
    await page.locator('.story-title').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert(await page.locator('.story-panel').count() === 0, 'E: Escape pauses');
    await startFromLauncher(page);
    assert((await title(page)).includes('Follow the Sun'), 'E: resume keeps chapter');
    await objectiveMet(page);
    // Go deeper → glossary deep-link → return without progress loss.
    await page.locator('.story-deeper summary').click();
    await page.locator('.story-deeper').getByRole('button', { name: 'Open in the Field Guide glossary' }).click();
    await page.waitForSelector('.drawer');
    assert((await page.locator('[aria-label="Search the glossary"]').inputValue()).length > 0, 'E: glossary deep-linked');
    await page.locator('[aria-label="Close field guide"]').click();
    await page.waitForTimeout(300);
    assert((await title(page)).includes('Follow the Sun'), 'E: chapter preserved after glossary');
    // Narrow viewport (small phone / zoomed layout): still no horizontal overflow.
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(500);
    const overflow320 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow320 <= 1, `E: no horizontal overflow at 320px (${overflow320}px)`);
    const box320 = await page.locator('.story-panel').boundingBox();
    assert(box320 && box320.x >= 0 && box320.x + box320.width <= 321, 'E: panel fits 320px');
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, '22-story-mobile');
    console.log('PERSONA E (mobile keyboard/focus/trap/reduced-motion/contrast/zoom-width) PASSED');
  }

  const unexpectedConsole = allConsole.filter((e) => !e.includes('status of 400'));
  assert(allErrors.length === 0, `page errors: ${allErrors.join(' | ')}`);
  assert(unexpectedConsole.length === 0, `console errors: ${unexpectedConsole.join(' | ')}`);
  console.log('STORY BROWSER TESTS PASSED · v1.9 personas A–E · screenshots in', OUT);
} catch (err) {
  console.error(err);
  const last = contexts[contexts.length - 1]?.pages()[0];
  if (last) await last.screenshot({ path: `${OUT}/98-story-failure.png`, timeout: 8000 }).catch(() => {});
  await browser.close();
  process.exit(1);
}
await browser.close();
