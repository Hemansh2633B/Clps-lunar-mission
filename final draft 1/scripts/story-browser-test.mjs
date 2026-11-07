/**
 * THE 14-DAY WINDOW — story tutorial browser tests (personas A–E).
 *
 * Real interactions and state assertions, not text-presence checks:
 *   A  beginner     — suggestion → training → site → Sun/Earth scrub → settings →
 *                     slip → battery → compare (2 real pins) → guarded export → debrief
 *   B  student      — Go deeper → Field Guide glossary deep-link → return without
 *                     progress loss; keyboard scrubbing; Escape pauses
 *   C  returning    — saved progress: no forced tutorial, resume/restart from Field Guide
 *   D  invalid data — ME-frame DEM (stubbed API payload; real import/conversion pipeline)
 *                     + epoch 2040 → FRAME_MODEL_OUTSIDE_VALIDATED_RANGE: narrative
 *                     explains, export refused, no fabricated verdict; unknown-frame
 *                     horizon import stays disabled with an actionable alert
 *   E  mobile       — 390×844: essential interactions, no horizontal overflow,
 *                     collapse/expand, reduced-motion disables spotlight transitions
 *
 * NOTE on persona D: NASA DEM downloads are unavailable in CI, so the DEM API
 * responses are stubbed at the network boundary. Everything downstream — frame
 * classification, ME→IAU conversion, import gating, computation-boundary analysis
 * status, narrative branching and the export guard — runs live in the browser.
 * The deeper blocked statuses (FRAME_UNVERIFIED etc.) are unreachable through the
 * UI because the Terrain Lab import gate fires first; they are covered by the
 * unit suite (story-narrative, analysis-status, frame-gating).
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
const objectiveMet = (page) => page.waitForSelector('.story-objective.met', { timeout: 20000 });
// Best-effort captures: let workers settle first (SwiftShader can stall captures
// mid-compute); the state assertions above are the actual verification.
const shot = async (page, name) => {
  await page.waitForTimeout(1500);
  await page.screenshot({ animations: 'disabled', path: `${OUT}/${name}.png`, timeout: 25000 }).catch(() => {});
};
const startFromLauncher = async (page) => { await page.locator('[data-tour="story-launch"]').click(); await page.waitForSelector('.story-panel'); };
const chooseTraining = async (page) => {
  await page.locator('.story-panel').getByRole('button', { name: 'Start the training mission' }).click();
  await page.waitForTimeout(900);
};

try {
  // ================= PERSONA A · beginner, fresh profile =================
  {
    const page = await newPage({ onboarded: false });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('[role="dialog"]');
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await page.waitForSelector('.story-suggestion');
    await shot(page, '15-story-suggestion');
    await page.locator('.story-suggestion').getByRole('button', { name: 'Start the briefing' }).click();
    await page.waitForSelector('.story-panel');
    assert((await title(page)).includes('First shift'), 'A: ch0 title');
    assert(await page.locator('.story-panel').getByText('fictional training exercise', { exact: false }).count() > 0, 'A: fiction notice present');
    await shot(page, '16-story-ch0');
    await chooseTraining(page);
    assert((await title(page)).includes('Pick the ground'), 'A: ch1 after training choice');
    assert(await page.locator('.story-spotlight').count() === 1, 'A: spotlight rings the real catalogue');
    await shot(page, '17-story-ch1-spotlight');

    // Real catalogue selection
    await page.locator('.site-item', { hasText: 'Shackleton' }).first().click();
    await objectiveMet(page);
    await answerCheck(page, 1);
    assert(await page.locator('.story-feedback').innerText().then((t) => t.startsWith('Correct.')), 'A: check feedback');
    await clickNext(page);
    assert((await title(page)).includes('Follow the Sun'), 'A: ch2');

    // Real time scrubbing
    const scrub = page.locator('[data-tour="scrubber"]');
    await setRange(scrub, Number(await scrub.inputValue()) + 2 * 86400000);
    await objectiveMet(page);
    await page.waitForFunction(() => document.querySelector('.story-readouts')?.textContent?.includes('Window illumination'), null, { timeout: 30000 });
    await answerCheck(page, 0);
    await clickNext(page);
    assert((await title(page)).includes('Find Earth'), 'A: ch3');
    assert(await page.locator('.story-note').innerText().then((t) => /NOT an RF link budget/.test(t)), 'A: RF disclaimer prominent');
    await setRange(scrub, Number(await scrub.inputValue()) + 3 * 86400000);
    await objectiveMet(page);
    await answerCheck(page, 1);
    await clickNext(page);
    assert((await title(page)).includes('Budget the power'), 'A: ch4');

    // Real settings modal + preset experiment
    await page.locator('.story-objective').getByRole('button', { name: 'Open Mission settings' }).click();
    await page.waitForSelector('[role="dialog"]');
    await page.locator('[role="dialog"]').getByRole('button', { name: /Small robotic lander/ }).click();
    await page.waitForTimeout(200);
    assert(await page.locator('[role="dialog"]').getByLabel('Array area', { exact: false }).inputValue() === '2', 'A: preset applied real config (2 m²)');
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Done' }).click();
    await objectiveMet(page);
    await answerCheck(page, 0);
    await clickNext(page);
    assert((await title(page)).includes('The slip'), 'A: ch5');

    // Real slip slider → live baseline-vs-slipped narrative
    await setRange(page.locator('[data-tour="slip"]'), 14);
    await objectiveMet(page);
    await page.waitForFunction(() => document.querySelector('.story-readouts')?.textContent?.includes('baseline → slipped'), null, { timeout: 40000 });
    const slipReadout = await page.locator('.story-readouts').innerText();
    assert(slipReadout.includes('+14.00 days'), 'A: live slip readout');
    await shot(page, '18-story-ch5-slip');
    await answerCheck(page, 1);
    await clickNext(page);
    assert((await title(page)).includes('battery report'), 'A: ch6');
    await page.waitForFunction(() => document.querySelector('.story-readouts')?.textContent?.includes('Verdict'), null, { timeout: 40000 });
    const battery = await page.locator('.story-readouts').innerText();
    assert(/Generated \/ consumed/.test(battery) && /kWh/.test(battery), 'A: live battery totals');
    assert(await page.locator('.story-note').innerText().then((t) => /not thermal or spacecraft survival/.test(t)), 'A: energy≠survival note');
    await answerCheck(page, 1);
    await clickNext(page);
    assert((await title(page)).includes('Compare like with like'), 'A: ch7');
    await page.waitForSelector('text=Scenario comparison', { timeout: 15000 });

    // Two real pins with a real slip change between them
    await page.locator('.story-objective').getByRole('button', { name: 'Pin this window & compare' }).click();
    await page.waitForTimeout(700);
    await setRange(page.locator('[data-tour="slip"]'), 0);
    await page.waitForTimeout(1200);
    await page.locator('.story-objective').getByRole('button', { name: 'Pin this window & compare' }).click();
    await objectiveMet(page);
    assert(await page.locator('text=2/4 pinned').count() > 0, 'A: two real scenarios pinned');
    await shot(page, '19-story-ch7-compare');
    await answerCheck(page, 0);
    await clickNext(page);
    assert((await title(page)).includes('File the report'), 'A: ch8');

    // Real guarded export
    await page.waitForFunction(() => document.querySelector('.story-readouts')?.textContent?.includes('Samples / effective step'), null, { timeout: 40000 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.story-objective').getByRole('button', { name: 'Export mission report (.json)' }).click(),
    ]);
    assert(download.suggestedFilename().endsWith('.json'), 'A: real report downloaded');
    await objectiveMet(page);
    await clickNext(page);
    await page.waitForSelector('text=Shift complete');
    assert(await page.locator('.story-panel').getByText('9 of 9 chapters completed', { exact: false }).count() > 0, 'A: all chapters credited');
    await shot(page, '20-story-debrief');
    await page.locator('.story-panel').getByRole('button', { name: 'Explore the planner' }).click();
    await page.waitForTimeout(500);
    assert(await page.locator('.story-panel').count() === 0, 'A: debrief closes to planner');
    const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('chandra-story-v1')));
    assert(stored.status === 'completed' && stored.completed.length === 9, 'A: versioned progress persisted');
    console.log('PERSONA A (beginner full run) PASSED');
  }

  // ================= PERSONA B · student, deeper + keyboard =================
  {
    const page = await newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await startFromLauncher(page);
    // Explore first: no training load, no state mutation
    const before = await page.locator('.site-item.selected').innerText();
    await page.locator('.story-panel').getByRole('button', { name: 'Explore first' }).click();
    await page.waitForTimeout(400);
    assert(await page.locator('.story-panel').count() === 0, 'B: explore-first exits the panel');
    assert((await page.locator('.site-item.selected').innerText()) === before, 'B: explore-first leaves mission state untouched');
    // Resume from Field Guide
    await page.locator('[aria-label="Field Guide"]').click();
    await page.waitForSelector('[data-tour="story-guide-card"]');
    await page.locator('[data-tour="story-guide-card"]').getByRole('button', { name: 'Resume the briefing' }).click();
    await page.waitForSelector('.story-panel');
    assert((await title(page)).includes('First shift'), 'B: resumed at ch0');
    await chooseTraining(page);
    // Keep current region (explicit decision)
    await page.locator('.story-objective').getByRole('button', { name: 'Use this region' }).click();
    await objectiveMet(page);
    // Go deeper → glossary deep-link → return without progress loss
    await page.locator('.story-deeper summary').click();
    assert(await page.locator('.story-term').count() >= 2, 'B: formal definitions render');
    await page.locator('.story-deeper').getByRole('button', { name: 'Open in the Field Guide glossary' }).click();
    await page.waitForSelector('.drawer');
    const q = await page.locator('[aria-label="Search the glossary"]').inputValue();
    assert(q.length > 0, 'B: glossary pre-filtered from Go deeper');
    assert(await page.locator('.drawer').getByText('Horizon mask', { exact: false }).count() > 0, 'B: deep-linked term visible');
    await page.locator('[aria-label="Close field guide"]').click();
    await page.waitForTimeout(300);
    assert((await title(page)).includes('Pick the ground'), 'B: chapter preserved after glossary round-trip');
    assert(await page.locator('.story-objective.met').count() === 1, 'B: objective progress preserved');
    await answerCheck(page, 1);
    await clickNext(page);
    // Keyboard: focus moves to the panel heading on chapter change
    const focusedTag = await page.evaluate(() => document.activeElement?.className || '');
    assert(String(focusedTag).includes('story-title'), 'B: focus lands on chapter heading');
    // Keyboard scrubbing via the primary action + native arrow keys on the real range
    await page.locator('.story-objective').getByRole('button', { name: 'Focus the time scrubber' }).click();
    const active = await page.evaluate(() => document.activeElement?.getAttribute('data-tour'));
    assert(active === 'scrubber', 'B: primary action focuses the REAL scrubber');
    for (let i = 0; i < 35; i++) await page.keyboard.press('ArrowRight');
    await objectiveMet(page);
    // Escape pauses (no modal open). Global shortcuts intentionally ignore keys
    // aimed at inputs, so move focus back to the panel heading first — as a
    // keyboard user would when returning to the briefing.
    await page.locator('.story-title').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert(await page.locator('.story-panel').count() === 0, 'B: Escape pauses the briefing');
    await startFromLauncher(page);
    assert((await title(page)).includes('Follow the Sun'), 'B: resume keeps chapter');
    assert(await page.locator('.story-objective.met').count() === 1, 'B: scrub progress kept after pause/resume');
    console.log('PERSONA B (student deeper/keyboard) PASSED');
  }

  // ================= PERSONA C · returning user, never forced =================
  {
    const saved = { v: 1, status: 'paused', chapter: 3, completed: [0, 1, 2], answers: { 1: 1, 2: 0 }, suggestionDismissed: true };
    const page = await newPage({ story: saved });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    assert(await page.locator('.story-panel').count() === 0, 'C: returning user is never force-opened');
    assert(await page.locator('.story-suggestion').count() === 0, 'C: no repeated suggestion');
    await page.locator('[aria-label="Field Guide"]').click();
    await page.waitForSelector('[data-tour="story-guide-card"]');
    assert(await page.locator('[data-tour="story-guide-card"]').getByText('Paused at CH 03.', { exact: false }).count() > 0, 'C: saved position shown');
    await page.locator('[data-tour="story-guide-card"]').getByRole('button', { name: 'Resume the briefing' }).click();
    await page.waitForSelector('.story-panel');
    assert((await title(page)).includes('Find Earth'), 'C: resumed at saved chapter 3');
    // Exit without training loaded this session → no snapshot restore, state untouched
    const sel = await page.locator('.site-item.selected').innerText();
    await page.locator('[aria-label="Exit briefing and restore my previous setup"]').click();
    await page.waitForTimeout(400);
    assert((await page.locator('.site-item.selected').innerText()) === sel, 'C: exit without training does not mutate state');
    // Restart from CH 00 via Field Guide
    await page.locator('[aria-label="Field Guide"]').click();
    await page.locator('[data-tour="story-guide-card"]').getByRole('button', { name: 'Restart from CH 00' }).click();
    await page.waitForSelector('.story-panel');
    assert((await title(page)).includes('First shift'), 'C: restart returns to ch0');
    const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('chandra-story-v1')));
    assert(stored.chapter === 0 && stored.completed.length === 0 && stored.suggestionDismissed === true, 'C: restart persisted, suggestion stays dismissed');
    // Reload: still never auto-opened
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    assert(await page.locator('.story-panel').count() === 0, 'C: reload never auto-opens the story');
    assert(await page.locator('.story-suggestion').count() === 0, 'C: reload never re-suggests');
    console.log('PERSONA C (returning user) PASSED');
  }

  // ================= PERSONA D · invalid data, honest refusal =================
  {
    const page = await newPage();
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
    const horizonPayload = (frame) => ({
      latitude: -89.5, longitude: 45, radius_km: 5, horizon_radius_km: 4.5, edge_inset_m: 28.3,
      sampling_step_m: 20, grid_size: SIZE, grid_spacing_m: 78.1, eye_height_m: 2, azimuth_step_deg: 1,
      azimuths_deg: azimuths, elevations_deg: azimuths.map(() => 0.5),
      ray_coverage_percent: azimuths.map(() => 100), max_obstacle_range_km: azimuths.map(() => 4),
      mean_coverage_percent: 100, synthetic: false,
      source: { ...source, lunar_reference_frame: frame },
      model: 'ray-marched local horizon', frame_note: 'Test fixture payload.',
    });
    let horizonFrame = 'MOON_ME (JPL DE421)';
    let horizonCalls = 0;
    let terrainCalls = 0;
    await page.route('**/api/config', (r) => r.fulfill({ json: {
      dem_ready: true, source, dem_error: null, quality_grids: { low: 65, medium: 129, high: 257 },
      radius_limits_km: [0.5, 20], latitude_convention: 'planetocentric', longitude_convention: '0-360E',
      synthetic_warning: 'demo', render_coordinates: 'IAU', geometry_model: 'sphere',
    } }));
    await page.route('**/api/terrain', (r) => { terrainCalls += 1; return r.fulfill({ json: terrainPayload }); });
    await page.route('**/api/horizon', (r) => { horizonCalls += 1; return r.fulfill({ json: horizonPayload(horizonFrame) }); });

    // Explicit Real-lunar-DEM workflow. A freshly mounted Terrain Lab always starts
    // with an illustrative SYNTHETIC model; relying on the config-triggered auto-real
    // build is a race (the CI failure: Compute ran against the synthetic grid, so the
    // mocked /api/horizon was never called and no import alert could appear).
    const buildRealDem = async () => {
      await page.waitForSelector('.terrain-lab');
      // Config arrival marks the backend online (and flips the source select to real).
      await page.waitForFunction(() => document.querySelector('#terrain-mode')?.value === 'real', null, { timeout: 20000 });
      await page.locator('#terrain-mode').selectOption('real');
      await page.locator('.terrain-lab').getByRole('button', { name: 'Build terrain' }).click();
      // The loaded model must be REAL DEM data before any horizon is computed.
      await page.waitForFunction(() => window.__CHANDRA_TERRAIN__?.mode === 'real', null, { timeout: 30000 });
      await page.waitForSelector('text=TEST_FIXTURE_ME.tif', { timeout: 30000 });
      assert(await page.locator('.terrain-lab').getByText('Real DEM', { exact: false }).count() > 0, 'D: model identified as real DEM');
    };

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await startFromLauncher(page);
    await chooseTraining(page);
    // Import the (stubbed) ME-frame DEM through the REAL Terrain Lab pipeline
    await page.keyboard.press('t');
    await buildRealDem();
    const callsBeforeFirst = horizonCalls;
    await page.locator('.terrain-lab').getByRole('button', { name: 'Compute 360° horizon' }).click();
    await page.waitForSelector('button:has-text("Use in mission")');
    assert(horizonCalls > callsBeforeFirst, 'D: real horizon API actually called (first visit)');
    assert(terrainCalls > 0, 'D: real terrain API actually called');
    const useBtn = page.locator('.terrain-lab').getByRole('button', { name: 'Use in mission' });
    assert(await useBtn.isEnabled(), 'D: allowlisted ME frame + full coverage imports');
    await useBtn.click();
    await page.waitForTimeout(900);
    assert((await title(page)).includes('Pick the ground'), 'D: story still at ch1');
    await objectiveMet(page); // site changed to the DEM site
    await answerCheck(page, 1);
    await clickNext(page); // ch2
    await page.waitForFunction(() => document.querySelector('.story-readouts')?.textContent?.includes('Window illumination'), null, { timeout: 40000 });

    // Push the epoch outside the SPICE-validated range via the REAL UTC date input
    await page.getByLabel('Mission start date (UTC)').fill('2040-01-01');
    await page.getByLabel('Mission start date (UTC)').blur();
    await page.waitForFunction(() => document.querySelector('.story-readouts')?.textContent?.includes('FRAME_MODEL_OUTSIDE_VALIDATED_RANGE'), null, { timeout: 40000 });
    const blockedText = await page.locator('.story-panel').innerText();
    assert(/blocked/i.test(blockedText), 'D: narrative says blocked');
    assert(/outside that range|only SPICE-validated/.test(blockedText), 'D: actual reason quoted');
    assert(!/Window illumination/.test(blockedText), 'D: no quantitative readouts while blocked');
    assert(!/Verdict/.test(blockedText), 'D: no fabricated verdict');
    // The surrounding instruments must not contradict the block either:
    assert(await page.locator('.telemetry-rail .chip', { hasText: 'Visibility blocked' }).count() > 0, 'D: telemetry header gated');
    assert(await page.locator('.telemetry-rail').getByText('Window viable', { exact: false }).count() === 0, 'D: no Window-viable claim while blocked');
    assert(await page.locator('text=Sun visibility blocked').count() > 0, 'D: panorama Sun chip gated');
    assert(await page.locator('text=Earth visibility blocked').count() > 0, 'D: panorama Earth chip gated');
    await shot(page, '21-story-blocked');

    // Skip to ch8 and attempt the real export — the guard must refuse
    for (let i = 0; i < 6; i++) { await page.locator('.story-nav').getByRole('button', { name: 'Skip chapter' }).click(); await page.waitForTimeout(250); }
    assert((await title(page)).includes('File the report'), 'D: reached ch8 via skips');
    await page.waitForSelector('.story-objective');
    let downloaded = false;
    page.on('download', () => { downloaded = true; });
    await page.locator('.story-objective').getByRole('button', { name: 'Export mission report (.json)' }).click();
    await page.waitForTimeout(1200);
    assert(!downloaded, 'D: blocked analysis never downloads');
    assert(await page.locator('[role="status"]').innerText().then((t) => /Export blocked/.test(t)).catch(() => false), 'D: export guard explains the refusal');
    assert(await page.locator('.story-objective.met').count() === 0, 'D: export objective NOT credited');
    assert(await page.locator('.story-nav button', { hasText: 'Finish briefing' }).isDisabled(), 'D: cannot finish via a refused export');

    // Unknown-frame horizon: the import gate itself must refuse (unavailable control).
    // Re-run the FULL explicit real-DEM workflow on the fresh mount — never compute
    // against the initial synthetic model.
    horizonFrame = 'WEIRD_TEST_FRAME';
    await page.keyboard.press('t');
    await buildRealDem();
    const callsBeforeSecond = horizonCalls;
    await page.locator('.terrain-lab').getByRole('button', { name: 'Compute 360° horizon' }).click();
    // Scope to the lab: the telemetry rail also shows a role=alert for the 2040 epoch.
    await page.waitForSelector('.terrain-lab [role="alert"]');
    assert(horizonCalls > callsBeforeSecond, 'D: mocked real horizon endpoint exercised (second visit)');
    const importAlert = await page.locator('.terrain-lab [role="alert"]').innerText();
    assert(/FRAME UNVERIFIED/.test(importAlert), 'D: unknown frame identified');
    assert(/WEIRD_TEST_FRAME/.test(importAlert), 'D: the actual unknown frame is named');
    assert(/allowlist|confirmed compatible/.test(importAlert), 'D: warning is actionable (how to resolve)');
    assert(await page.locator('.terrain-lab').getByRole('button', { name: 'Use in mission' }).isDisabled(), 'D: unknown-frame import disabled');
    console.log('PERSONA D (invalid data / honest refusal) PASSED');
  }

  // ================= PERSONA E · mobile + reduced motion =================
  {
    const page = await newPage({ viewport: { width: 390, height: 844 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await startFromLauncher(page);
    assert((await title(page)).includes('First shift'), 'E: ch0 on mobile');
    await chooseTraining(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 1, `E: no horizontal overflow (${overflow}px)`);
    const box = await page.locator('.story-panel').boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= 391 && box.y + box.height <= 845, 'E: panel fits the viewport');
    // Collapse / expand
    await page.locator('[aria-label="Collapse briefing panel"]').click();
    assert(await page.locator('.story-panel.collapsed').count() === 1, 'E: collapses to header');
    await page.locator('[aria-label="Expand briefing panel"]').click();
    assert(await page.locator('.story-body').count() === 1, 'E: expands again');
    // Real site selection on mobile
    await page.locator('.site-item', { hasText: 'Haworth' }).first().click();
    await objectiveMet(page);
    await answerCheck(page, 1);
    await clickNext(page);
    assert((await title(page)).includes('Follow the Sun'), 'E: ch2 on mobile');
    // Reduced motion: spotlight must not animate
    const dur = await page.locator('.story-spotlight').evaluate((el) => getComputedStyle(el).transitionDuration);
    assert(dur === '0s', `E: reduced motion disables spotlight transition (${dur})`);
    const scrub = page.locator('[data-tour="scrubber"]');
    await setRange(scrub, Number(await scrub.inputValue()) + 86400000);
    await objectiveMet(page);
    await shot(page, '22-story-mobile');
    console.log('PERSONA E (mobile/reduced-motion) PASSED');
  }

  const unexpectedConsole = allConsole.filter((e) => !e.includes('status of 400'));
  assert(allErrors.length === 0, `page errors: ${allErrors.join(' | ')}`);
  assert(unexpectedConsole.length === 0, `console errors: ${unexpectedConsole.join(' | ')}`);
  console.log('STORY BROWSER TESTS PASSED · personas A–E · screenshots in', OUT);
} catch (err) {
  console.error(err);
  const last = contexts[contexts.length - 1]?.pages()[0];
  if (last) await last.screenshot({ path: `${OUT}/98-story-failure.png`, timeout: 8000 }).catch(() => {});
  await browser.close();
  process.exit(1);
}
await browser.close();
