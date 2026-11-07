# Verification evidence · CHANDRA v1.8 (interactive briefing)

This file records what was actually executed in the Arena sandbox. It distinguishes software-path
verification from scientific validation, and **passed from skipped** (a skipped SPICE test is never
reported as a passed validation). The v1.6 audit added independent SPICE frame/ephemeris validation,
sampling/battery correctness fixes, frame gating, provenance, and export integrity. The **v1.7**
pass (below) hardened the frame allowlist, transition reliability, event-aware energy integration,
computation-boundary validation, the catalogue/Artemis context, first-time UX, the guided workflow,
explicit UTC, worker performance, accessibility, report horizon labeling, and CI. See
`docs/SCIENTIFIC_METHOD.md` for the method and limits.

## Automated suites

| Suite | Command | Result |
|---|---|---|
| TypeScript typecheck | `npm run typecheck` | clean |
| Production build | `npm run build` | clean; React / Three / ephemeris split into separate chunks |
| Engine + SPICE-reference validation + frame allowlist + transition stress + event-aware energy + analysis status + sampling/battery + catalogue + presets + explanations + UTC + workflow + simulation client + export + DEM-profile + vehicle/geo + story chapter/progress/narrative unit tests | `npm test` | **244 passed** (Vitest, 25 files — v1.9 adds witness, session, export-guard, a11y-description and comparison-narrative suites) |
| Backend / DEM / horizon / downloader / API errors / lunar-frame module | `npm run test:python` | **92 passed, 4 skipped** (pytest). The 4 skips are the SPICE-kernel-gated frame tests (kernels not fetched in the ordinary run) — **skipped, not passed**; the optional CI `spice-validation` job fetches kernels and runs them for real. |
| Geometry checks | `npm run test:geometry` | passed: curvature, pole coordinates, Sun directions, exact landing origin, shadow casting, NoData topology, synthetic demo, horizon ray-marching |
| Horizon parity | `npm run test:parity` | passed: TypeScript and Python ray-marchers agree on elevations, coverage, edge inset, obstacle ranges |
| Mission + Terrain Lab + Space views browser E2E | `npm run test:browser` | passed: catalog, Apollo/far-side, comparison, educator, custom site, modal keyboard guard/focus, export (blocked while computing), playback; Terrain Lab orbit drag, keyboard orbit, top/oblique presets, inspection pin, exaggeration, shadow pixel brightening, Sun extremes, all grid qualities, radius, horizon CSV/import, real-mode no-DEM safeguard, 390 px mobile layout; **Space views**: planet markers/labels, time-lapse clock + sub-solar sweep, south-pole preset, fleet stack/HLS/CLPS switching, stage separation, engine plume, hover part callout, view close; **v1.7 features**: first-run onboarding offers demo / real-DEM choice and dismisses cleanly; guided six-step workflow opens, shows six steps and advances; chart text alternatives (panorama/timeline/polar-map `role="img"`) and a labelled keyboard time scrubber; **2024 Regions** tab shows exactly nine region-approximate regions; explicit **UTC date + time** mission-start fields drive recompute; persistent provenance indicator; heuristic score breakdown + "not an RF link budget" disclosure |
| Real-DEM browser smoke | `npm run test:real-dem` | passed historically against the verification fixture below; **not executed in the v1.9 run** (fixture TIF absent from this environment — reported as not run, never as passed) |
| THE 14-DAY WINDOW story E2E (v1.9 personas A–E) | `npm run test:story` | passed — see the v1.9 section below |

Python warnings are Rasterio `Affine` `*` vs `@` PendingDeprecationWarnings from the installed wheel; they do not indicate a CHANDRA failure.

## v1.9 reliability release — executed evidence

Executed 2026-11-07 in the Arena sandbox on branch `arena/860e2f06-clps-lunar-mission`
(from merged v1.8 `main` @ `03c3522`), Node 22 / Python 3.11, Sparticuz Chromium
(single-process) locally; GitHub Actions ubuntu-latest with Playwright Chromium for CI.

| Check | Result |
|---|---|
| Typecheck (`npm run typecheck`) | clean |
| Production build (`npm run build`) | clean |
| Unit tests (`npm test`) | **244 passed, 0 failed** (25 files; 52 new v1.9 tests: comparison/export witnesses incl. existing/identical/capacity/blocked/computing cases, session round-trip + corrupt/dangling/oversized rejection + boot resolution + lost-context detection, export gate incl. stale/blocked/epoch-gated horizon CSV, blocked a11y descriptions for every gated surface, verified-DEM wording, comparison-narrative branches incl. mixed-confidence never-rankable) |
| Python (`npm run test:python` / `pytest -q -rs`) | **92 passed, 4 skipped** — the 4 skips are SPICE-kernel-gated (kernels not fetched locally); reported as SKIPPED, never passed. The CI `spice-validation` job fetches checksummed kernels and ran the 26 frame tests for real (see CI evidence). |
| Geometry (`npm run test:geometry`) | passed |
| Parity (`npm run test:parity`) | passed |
| Browser E2E (`npm run test:browser`) | passed — no regressions from the session/a11y/stacking changes |
| Story E2E (`npm run test:story`) | **v1.9 personas A–E passed** (~600 s): A existing user (3 real pre-pins + preset + playback → isolated empty training workspace, user pins invisible, ch7 refuses pre-existing/identical pins, credits a NEW distinct resolved pair, completion restores site/slip/config/pins/playback exactly, session cleared); B export correctness (real ME-DEM import; two CSV downloads never credit; epoch-2040 blocked analysis never downloads; guard-passing JSON credits only after provenance + warnings verified in the downloaded file); C refresh/resume (ch5 slip + baseline + answer survive reload; ch7 pins + witness re-resolve; corrupt session injected pre-app-load → explicit Rebuild/Exit recovery; v1.8 progress without session → same path; never force-opened); D invalid data (three explicit Real-DEM visits with API-call counters: ME import / WEIRD_TEST_FRAME / 92 % coverage; epoch 2040 gated across narrative, telemetry, chips AND aria-labels, DEM footer, timeline/map descriptions, withheld horizon clearances + disabled CSV; refused export, no credit); E mobile a11y (keyboard-only activation, heading focus, modal trap + focus restore, Escape pause/resume, glossary deep-link, reduced motion, runtime contrast ≥ 4.5 for dialogue/objective/log/scene, 390 px + 320 px no overflow) |
| Real-DEM smoke (`test:real-dem`) | **not executed** — verification fixture TIF absent in this environment |
| Manual screen reader | **not executed** — NVDA/VoiceOver protocol recorded in `docs/ACCESSIBILITY_AUDIT.md`; no screen-reader pass claimed |
| Screenshots | `screenshots/15…22-story-*.png` (best-effort under SwiftShader; assertions are the verification) |

**GitHub Actions evidence (queried via API on 2026-11-07):**

| Run | Commit | Result |
|---|---|---|
| 42379651272 (post-merge v1.8, push to main) | `03c3522` | quality ✓ · spice-validation ✓ · **browser ✗** at "Run story tutorial E2E" (Persona D timeout; A–C passed, E never ran) — the failure v1.9 fixes |
| 42383009327 (Phase-1 fix only) | `23c4117` | **all green**, incl. step 10 "Run story tutorial E2E (personas A–E)" — root-cause fix verified on the real runner before further changes |
| 42389036663 (Phases 2–4 + new personas) | `ccfd8cf` | **all green** (quality + browser with the rewritten personas; SPICE job not yet PR-triggered at this commit) |

Raw CI log download is blocked in this sandbox (`results-receiver.actions.githubusercontent.com`
outside the egress allowlist); job/step metadata was read via `api.github.com` and the
failure was additionally reproduced experimentally in the sandbox (delayed-API probe:
mode `synthetic` at compute-click, 0 mocked horizon calls, 0 alerts; fast-API: mode
`real`, 1 call, alert present). See `docs/CI_GOVERNANCE.md` §4.

**Defects fixed en route (found by the new tests, not assumed):** ticker marquee
intercepting Export-dropdown clicks (stacking + pointer-events); stale `active` story
status after refresh; `--dim` small text below AA (4.32/3.65 → 5.65/4.76); Terrain Lab
alert text 4.19 → 5.23; panorama/timeline/map aria-labels and the horizon table
out-claiming the visibility gate. Details: `docs/ACCESSIBILITY_AUDIT.md`,
`docs/IMPLEMENTATION_REPORT_v1.9.md`.

## v1.8 interactive briefing — executed evidence

> **Correction (2026-11-07, v1.9):** the local results below were accurate when
> recorded, but the **post-merge GitHub Actions run 42379651272 FAILED** at the story
> step: Persona D relied on the config-triggered auto-real Terrain Lab build winning
> a race before "Compute 360° horizon" was clicked; on the CI runner it lost, the
> mocked `/api/horizon` was never called, and the expected import alert never appeared
> (personas A–C passed; E never ran). The v1.8 claims of a fully green story pipeline
> therefore did **not** hold on CI. Fixed in v1.9 by the explicit Real-DEM workflow
> (verified green on run 42383009327); the original text is preserved below as history.

Executed in the Arena sandbox on branch `arena/c8be366b-clps-lunar-mission` (from merged
v1.7 `main` @ `182a4fc`), Node 22 / Python 3.11, Sparticuz Chromium (single-process).

| Check | Result |
|---|---|
| Typecheck (`tsc --noEmit` / `tsc -b`) | clean |
| Unit tests | **192 passed, 0 failed** (20 files) — includes 41 new story tests: chapter ordering/terminology/glossary links, versioned persistence + corrupt-payload handling, pause/resume/restart/skip immutability, suggestion policy, live narrative vs real engine fixtures, slip better/worse/similar/computing branches, all 5 blocked statuses × 7 chapters (no fabricated verdicts), provenance tiers |
| Python | **92 passed, 4 skipped** (SPICE-kernel-gated; skipped ≠ passed) |
| Geometry / parity | passed / passed |
| Production build | clean (~5.5 s) |
| Existing browser E2E (`test:browser`) | passed (~175 s), incl. multi-TZ (Asia/Kolkata) slip check — no regressions from the briefing wiring |
| Story browser E2E (`test:story`) | **personas A–E passed** (~256 s): A beginner full run (suggestion → training → real site selection → scrub → preset change → +14 d slip → battery → 2 real pins → guarded JSON export → 9/9 debrief → progress persisted); B student (Go deeper → glossary deep-link → return without progress loss; keyboard scrubbing; Escape pauses; explore-first leaves state untouched); C returning (saved ch3 paused: never force-opened, never re-suggested, resume/restart, reload-safe); D invalid data (ME-frame DEM import via real Terrain Lab pipeline + epoch 2040 → FRAME_MODEL_OUTSIDE_VALIDATED_RANGE: narrative explains, instruments gated, export refused with no download, objective not credited; unknown-frame import disabled with alert); E mobile 390×844 (no overflow, collapse/expand, real selection + scrub, reduced-motion ⇒ spotlight transition 0 s) |
| Screenshots | `screenshots/15…22-story-*.png` (7 of 8 captured; the ch5 slip capture timed out under SwiftShader while workers were computing — best-effort capture, the ch5 state assertions passed) |

**Persona D fidelity note:** NASA DEM downloads are unavailable in CI, so the DEM API
responses are stubbed at the network boundary; frame classification, ME→IAU conversion,
import gating, computation-boundary analysis status, narrative branching and the export
guard all run live in the browser. The deeper blocked statuses (FRAME_UNVERIFIED,
INCOMPLETE_COVERAGE) are unreachable through the UI because the Terrain Lab import gate
fires first — they are covered by unit tests instead.

**Defect fixed en route:** instantaneous visibility chips ("Window viable" / "Sunlit" /
"DTE open") bypassed the epoch-aware frame gate; now gated via
`assessTerrainEligibility(site, timeMs, timeMs)` with persona-D browser assertions and
the existing engine-level epoch unit test. See SCIENTIFIC_METHOD §11.

## v1.7 product hardening — executed evidence

All counts below were executed at the v1.7 HEAD (typecheck clean, `npm run build` clean,
**151 unit tests / 17 files**, **92 pytest passed + 4 SPICE-gated skipped**, geometry + parity
passed, browser E2E passed).

- **Explicit frame allowlist + epoch validation** (`tests/frame-allowlist.test.ts`, 20 tests;
  `tests/python/test_lunar_frame.py`): exact allowlist match after suffix-stripping; rejects
  `MOON_ME_DE440`, `NOT_MOON_ME`, `WEIRD_IAU_FRAME`; validated window 2020–2035 with
  `frameEpochInRange` / `frameIntervalValidated`. TS↔Python `classifyFrame` parity preserved.
- **Transition reliability** (`tests/transition-stress.test.ts`, 6 tests): budget exhaustion is
  disclosed with a safe 15 s fallback; unresolved intervals surface as
  `NUMERICAL_RESOLUTION_INSUFFICIENT`; the pruning rate bound is documented as a heuristic.
- **Event-aware energy** (`tests/energy-integration.test.ts`, 6 tests): adaptive Simpson over
  event-partitioned intervals; 240/60/15-min partitions agree to <0.1 kWh and <0.5% SOC and match
  a 1-min reference grid to <1%; separate charge/discharge efficiencies and SOC bounds.
- **Computation-boundary validation** (`tests/analysis-status.test.ts`, 10 tests): discriminated
  statuses; blocked results carry no samples/events/summary; exports blocked and rankings exclude
  blocked rows; no silent synthetic substitution.
- **Catalogue + Artemis context** (`tests/catalogue.test.ts`, 7 tests): tab renamed
  "NASA South Polar Candidate Regions — 2024 Dataset"; nine 2024 regions keep provenance; current
  Artemis context (III = 2027 LEO demo, IV = early-2028 first crewed landing; NASA 2026-10-23)
  shown separately, not as a 2024-list selection.
- **Presets + validated inputs** (`tests/mission-presets.test.ts`, 3 tests): three illustrative
  presets (each description states "illustrative"), `matchingPresetId(DEFAULT_CONFIG)` =
  general-surface; `NumberField` never propagates invalid/cleared values.
- **Explanations + glossary** (`tests/explanations.test.ts`, 6 tests): plain-language sentences
  beside technical values; score labeled heuristic; DTE labeled not-an-RF-link-budget.
- **Guided workflow + explicit UTC** (`tests/workflow.test.ts` + `tests/utc.test.ts`, 10 tests):
  six ordered steps; UTC parsing invariant across six process timezones; malformed/out-of-range/
  rolled-over input rejected.
- **Worker performance** (`tests/simulation-client.test.ts`, 9 tests): LRU eviction at 36,
  in-flight dedup, reference-counted cancellation, StrictMode release-then-re-request is NOT
  cancelled (no wasteful respawn), cancelling one request preserves another, phase progress.
- **LOCAL HORIZON in reports + accessibility** (`tests/export-integrity.test.ts`): report carries
  `horizonScale = "LOCAL HORIZON"`, a warning, and a disclaimer clause; DEM disclosure notes the
  ray-marched local crop, not a regional model. Browser E2E asserts chart text alternatives.
- **CI** (`.github/workflows/ci.yml`): a `quality` job (typecheck, build, unit, geometry, parity,
  pytest) that reports the 4 kernel-gated SPICE tests as **SKIPPED, never passed**; an optional
  `spice-validation` job that fetches checksummed GitHub-mirror kernels (not NASA), asserts they
  are present, and runs the real frame tests; and a `browser` job using portable Playwright
  Chromium against a live dev server + terrain API.

## v1.6 scientific audit — executed evidence

**Independent SPICE validation** (`tests/ephemeris-validation.test.ts`, reference
`tests/data/frame-reference.json` generated by `scripts/generate-frame-constants.py` from
`spiceypy` + DE421 + `moon_pa_de421_1900-2050.bpc` + `moon_080317.tf` + `pck00008.tpc`):
9 epochs (2026-06 → 2027-06) × 6 sites incl. exact/near south pole and several longitudes.
IAU frame evaluated by SPICE from the PCK, independent of astronomy-engine. Measured maxima:

| Quantity | Max error | Fixed tolerance |
|---|---|---|
| Sun elevation | 0.000576° | 0.01° |
| Earth elevation | 0.000246° | 0.01° |
| Azimuth (Sun & Earth) | 0.007181° | 0.02° |
| IAU frame angle vs SPICE | 0.001028° | 0.002° |
| Sub-Earth point | 0.006173° | 0.01° |

A sub-Earth topocentric-parallax bug (~0.26°) was found and fixed (now selenocentric).
Shipped constant ME→IAU / PA→IAU rotations target the app's astronomy-engine IAU frame;
max residual **0.003869°** over 2020–2035 (disclosed). Python `convert_site` matches the
shared reference (`tests/python/test_lunar_frame.py`), keeping TS↔Python conversion parity.

**Sampling / battery** (`tests/sampling-battery.test.ts`): 90 d @ 1 min → 20,000 samples,
effective step 6.4803 min, both endpoints preserved, max gap = effective step (no giant final
jump). Battery irregular-step integration matches uniform to <1e-6 h; saturation, long
darkness, initial SOC, and empty input covered. Polar illumination % converges coarse (240 min)
vs fine (30 min) to <0.5% with ≤1 event difference (adaptive refinement, ~6× faster than a
uniform fine sub-scan).

**Frame gating** (`tests/frame-gating.test.ts`): ME/PA/IAU recognized (incl. `MOON_ME (JPL
DE421)`), rotated into IAU and disclosed; unknown frames marked FRAME UNVERIFIED and blocked
from quantitative mission visibility; synthetic demos allowed but labeled; incomplete/NoData
masks blocked. The real-DEM browser smoke imports the MOON_ME verification fixture as a
frame-verified site (`screenshots/10-real-dem-mission-site.png`).

**Catalogue / export** (`tests/catalogue.test.ts`, `tests/export-integrity.test.ts`): nine
Artemis III regions as region-approximate centers (NASA NTRS 20250011660, 2024-10-28), never
surveyed points; Apollo/Chang'e separate with surveyed coordinates. JSON report carries a full
reproducibility block + warnings; CSVs carry data_confidence / frame_verified / effective step.

Browser evidence: `screenshots/12-artemis-catalogue.png`, `screenshots/13-provenance-score.png`.

## Real projected-DEM path

NASA PGDA (`pgda.gsfc.nasa.gov`) is outside the sandbox allowlist, so the native NASA COG downloader was **not** exercised against NASA here. Its range-probe, provenance, overwrite-refusal, and landing-elevation checks are covered by offline pytest mocks.

To verify the real projected-DEM loading/cropping/rendering path, `scripts/fetch-lola-verification-fixture.py` fetches a small public derivative from GitHub:

- Original product: NASA PGDA `LDEM_80S_20MPP_ADJ.TIF`, LOLA adjusted south-pole topography, MOON_ME / DE421.
- Derivative: `hparadiz/artemis-iii-landing-candidates`, `data/base_tiles/ldem_80s_20mpp_adj.tif_512.bin`.
- Reconstruction: 512×512 float32, south polar stereographic, spherical radius 1,737,400 m, extent ±304,000 m, pixel size 1,187.5 m. Projection centre verified as latitude −90°.

**Caveats:** this is a third-party bilinear downsample. The derivative author filled invalid source pixels before downsampling, so NoData coverage is not preserved. It is a software verification fixture, **not** a flight or science product.

Executed result at −89.5°, 45° E, radius 5 km:

| Quantity | Value |
|---|---|
| Landing elevation | ≈ −387.3 m |
| Sampled disk minimum | ≈ −904.2 m |
| Sampled disk maximum | ≈ +711.4 m |
| Disk coverage | 100% (fixture is gap-filled) |
| Horizon maximum elevation | ≈ 12.2° |
| Horizon ray coverage | 100% after disclosed edge inset |

These values are close to the prototype’s previously recorded native NASA crop (landing ≈ −393.8 m, range ≈ −915 … +697 m), which supports the software path but does not independently validate the source datum, frame, or shadow model.

Browser evidence: `screenshots/09-real-dem-lab.png`, `screenshots/10-real-dem-mission-site.png`.

## v1.3 correctness / robustness pass

- Battery depletion now interpolates the zero-crossing inside a sample interval instead of snapping to the next sample; cumulative depletion hours count only the post-depletion fraction.
- Power is terrain-relative: if the Sun is visible below the reference tangent because the local DEM horizon is depressed, a vertical mast can still track it; horizontal decks receive zero.
- Custom 8-sector horizons are exact at the edited azimuths and wrap periodically; they are labeled `kind: 'custom'`, not re-synthesized with illustrative ripple.
- DEM-aware UI: site catalog, site context, panorama sample count/elevation range, horizon table bin size, JSON/CSV disclaimers, and the status bar all reflect the selected terrain source.
- Global keyboard shortcuts are suppressed while a modal is open; dialogs have focus trapping, `role="dialog"`, and Escape-to-close. Toasts are `aria-live`.
- Simulation cache keys include terrain kind, resolution, eye height, source frame, synthetic flag, and the full horizon array.
- The Flask API returns JSON for 404/405/500, sets `nosniff`/`no-referrer` headers, and logs unexpected failures.
- Terrain Lab validates latitude/longitude/radius/eye height inline and disables invalid builds/horizon computations.

## v1.4 "CHANDRA // OPS" paper-folio redesign

- Ported the user-supplied reference design onto the working app: cream paper + dot grid,
  ink text, coral rule, plates with `+` register marks, rubber stamps, hard-shadow amber
  keys, Fraunces / Outfit / IBM Plex Mono, a constants ticker, and a full-width live clock
  strip (mission UTC · MJD · sub-solar · sub-earth) driven by the real ephemeris sample.
- All five user images are wired in as branding / Field Guide plates only (patch, hero,
  lander, ops-desk, classroom); provenance recorded in `public/assets/PROVENANCE.md`.
- Charts restyled to the paper palette (cream sky / ink terrain silhouette, sepia LROC
  polar map, amber/lagoon/emerald Gantt). The 3D Terrain Lab keeps a dark instrument screen.
- No functional regression: engine, DEM import, comparison, exports, shortcuts, modal
  focus guards, and mobile layout all unchanged and re-verified.
- Test-harness hardening: screenshots disable CSS animations (deterministic under
  SwiftShader), default timeout raised to 45 s, and the boot wait uses the structural
  `.app-header .display` selector instead of the ambiguous `text=CHANDRA` (which also
  matched the hidden `<title>`). Fixed a header flex bug where the brand collapsed to
  zero width when the clock cluster crowded the row.

## v1.5 Space views + CHANDRA rename

- **Rename:** the product was renamed from SELENE to **CHANDRA** (Sanskrit lunar deity,
  "the shining one"), brand **"CHANDRA // OPS"**. Applied across UI, export filename
  prefixes (`chandra-*`), the terrain debug global (`__CHANDRA_TERRAIN__`), the API port
  env var (`CHANDRA_API_PORT`), package name, backend strings, docs and the browser-test
  assertions — all in lockstep, with the suites re-run green.
- **Planet time-lapse** (`src/components/PlanetViewer.tsx`): a body-fixed Moon sphere lit
  by a single hard Sun whose direction is the real sub-solar point from the ephemeris
  engine, so the terminator sweeps once per ~709 h lunation. Time-lapse 1 h/s → 7 days/s
  loops a synodic month and drives the global console clock; a scrub bar plus UTC/MJD/
  sub-solar/sub-earth readouts. Site markers (click-select), selected-site ring, sub-solar
  and sub-earth dots, dashed Earth line, toggleable terminator/graticule/stars/Earth, and
  near-side / south-pole / sub-solar / Earth-view camera presets. Earth is direction-only,
  explicitly labelled "not to scale". The lat/lon→vector mapping is unit-tested against the
  equirectangular texture orientation (`tests/space.test.ts`).
- **Fleet hangar** (`src/components/FleetViewer.tsx` + `src/three/vehicles.ts`): procedural,
  stylized Starship full stack, Starship HLS lunar lander, and CLPS robotic lander. Orbit/
  zoom, turntable, side/top/detail presets, a stage-separation slider (stack), engine-plume
  toggle, and raycaster hover part callouts with a parts list. Models are primitive-based
  massing studies — **not engineering CAD or flight geometry** — and carry an in-view
  disclaimer; approximate public dimensions are quoted in the spec panel.
- Both views live in a lazy-loaded `SpaceView` (header **Space** button / `O` shortcut),
  mutually exclusive with Terrain Lab and Compare, in a `.workspace.orbital` layout that
  mirrors the Terrain Lab dark-viewport-in-paper-chrome pattern. Responsive down to 390 px.
- New unit tests (11): vehicle build/part-tag/plume/bounds/dispose for all three vehicles,
  stack-only separable stage, HLS legs, and the selenographic mapping. Browser E2E extended
  with planet + fleet flows and screenshots `09-planet`, `10-fleet-stack`, `11-fleet-hls`.
- Provenance for the two planet textures (lunar albedo + Earth Blue Marble via the three.js
  examples, NASA-derived) recorded in `public/assets/PROVENANCE.md`; decorative only.

## DEM horizon → mission planner

- Ray-marched elevations are copied verbatim into a `kind: 'dem'` terrain profile.
- No illustrative ripple, base offset, or elevation clamp is applied.
- Periodic interpolation uses the mask’s native azimuth resolution.
- Incomplete real masks are blocked from mission import; synthetic imports are allowed but labeled as demo data everywhere downstream.
- Site context, horizon table, CSV export, and JSON report carry source file, frame, coverage, radius, eye height, and sampling resolution.

## Not verified here

- Live NASA PGDA range download (PGDA is outside the sandbox allowlist; the native downloader
  is covered by offline pytest mocks, and the projected-DEM path by the GitHub verification fixture).
- **Regional / multiscale distant-horizon analysis** with real PGDA products 90 & 78 (height
  uncertainty, effective resolution, LDSM slope, LDEC counts). The metadata model is in place,
  but real regional DEMs could not be downloaded here; the tool does not fabricate them. The
  current horizon is local to the crop (≤20 km) and is labeled as such.
- Flight-certified illumination, power, RF link budgets, thermal survival, or landing safety.
- The constant ME/PA→IAU correction is a planning-grade approximation (residual ≤0.0039°), not
  a rigorous time-dependent geodetic transformation.
- Hardware GPU performance; browser tests use software WebGL (SwiftShader). Terrain-init under
  SwiftShader is occasionally slow; the browser E2E uses condition waits, but a flaky terrain-init
  timeout remains possible on constrained runners.
- The GitHub Actions workflow (`.github/workflows/ci.yml`) was authored and every command in it was
  verified locally, but the workflow itself has **not** been executed on a GitHub Actions runner
  here. The optional `spice-validation` job's kernel fetch depends on the GitHub mirror remaining
  available; if it fails, that job fails loudly rather than reporting a skipped test as passed.
