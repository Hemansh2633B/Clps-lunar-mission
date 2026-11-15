# Verification evidence · CHANDRA

This file records what was actually executed, release by release (most recent
first). It distinguishes software-path verification from scientific
validation, and passed from skipped — a skipped SPICE test is never reported
as a passed validation. See `docs/scientific-method.md` for the method and its
limits, and `docs/known-issues.md` for open engineering findings.

## v1.12.0 native backend and lunar data release — executed evidence

Executed on branch `arena/0f3b6dab-clps-lunar-mission` from the merged v1.11
base `9b77277`. `APP_VERSION` is **1.12.0**; `REPORT_SCHEMA_VERSION` is
**2.1.0** (additive; scientific-method §13.11). Environment: Linux x86_64 with
2 CPU cores, Node 22.22.3, Go 1.24.11 (and Go 1.23.9 for the compatibility
row), headless Chromium 153 from `@sparticuz/chromium` with **software
rendering** (no GPU), Playwright 1.64.1, Vercel CLI 65.16.0.

**No live deployment has been made, and no NASA, JPL or LROC service was
contacted by the application or its tests.** Those hosts are not reachable from
this environment. Everything below is local or GitHub Actions. What that leaves
unverified is listed under [Not verified in v1.12](#not-verified-in-v112).

| Gate | Command | Executed result |
|---|---|---|
| Typecheck / build | `npm run typecheck && npm run build` | clean; React / Three / ephemeris / Data Hub are separate chunks |
| Unit suites | `npm test` | **368 passed, 35 files** (adds polar projection, Horizons comparison and Data Hub catalogue suites) |
| Native backend | `npm run test:go` (gofmt, `go vet`, `go test ./...`) | gofmt and vet clean; **10 packages ok — 77 tests and 30 subtests passed, 2 skipped**. The two skips are the opt-in live tests (`TestLiveHorizons`, `TestLiveLOLA`), which need `CHANDRA_LIVE_TESTS=1` and network access. Go 1.24.11 |
| Go 1.23 compatibility | `go vet ./... && go test ./...` with Go 1.23.9, `GOTOOLCHAIN=local` | 10 packages ok (the module declares `go 1.23`) |
| Geometry | `npm run test:geometry` | passed |
| TS ↔ Go horizon parity | `npm run test:parity` | passed |
| SPICE evidence tool | `pytest tools/spice-evidence -q -rs` | **22 passed, 4 skipped** — the 4 kernel-gated tests are skips, not passes; kernels were not fetched in this run. The frame constants and `tests/data/frame-reference.json` are unchanged from v1.11 |
| Vercel configuration | `npm run vercel:check` | passed: framework pin, single function, rewrite order, CSP matches the catalogue's imagery hosts, `.vercelignore` keeps all 112 files the build needs |
| Vercel build output | `vercel build` in a copy of the repository **with `.vercelignore` applied** (140 files), then `node scripts/vercel-check.mjs --built` | build completed; the built function (`provided.al2023`, x86_64, 1024 MB, 60 s, 9.0 MB) was executed through a local Lambda-runtime emulator and answered health, config (`deployment: vercel`, storage `local`, `persistent: false`), synthetic terrain, real-mode refusal, horizon, sources, metadata, JSON 404 and verify through the generated rewrites |
| Data-feature browser E2E | `npm run build && npm run test:datahub` | **19 checks passed** (138 s) on the final tree; see below |
| Mission / Terrain / Space browser E2E | `CHANDRA_E2E_TIMEOUT_SCALE=6 npm run test:browser` | passed (307 s) on the final tree |
| Real-DEM software fixture smoke | API on `:8001` with the fixture; `npm run test:real-dem` | passed (23 s) on the final build, against the native Go API |
| Story briefing E2E | `CHANDRA_E2E_TIMEOUT_SCALE=8 npm run test:story` | **personas A–E passed** (about 26 min); see the note on what changed afterwards |
| Scientific-export E2E | `CHANDRA_E2E_TIMEOUT_SCALE=8 npm run test:exports` | **personas A–E passed, 1550 s**; Persona A now also asserts schema `2.1.0` and the `dataProvenance` block |
| Live Vercel deployment | — | **NOT DONE** |
| GitHub Actions, commit `f443627` | push run 43727245450 and pull-request run 43727313112 | **all jobs passed.** Quality (typecheck, build, unit, geometry, Go, parity, Vercel configuration). Vercel build output: `vercel build` and the function executed, on a clean runner. Browser E2E with Playwright's Chromium **at default patience**: mission suite 69 s, story A–E 91 s, exports A–E 142 s, data-feature suite 16 s. SPICE validation with fetched kernels (pull-request run; skipped by design on the branch push). `f443627` is the commit before this evidence was written into the documentation; later commits change documentation only |
| Manual screen-reader protocol | NVDA / VoiceOver | **NOT EXECUTED**, and the protocol does not yet cover the Data Hub |

### What the data-feature suite checks

`scripts/datahub-browser-test.mjs` builds and starts the real API binary,
serves a GDAL-written raster from a loopback "PGDA" with HTTP range support,
replays recorded Horizons responses from a loopback "JPL", and intercepts the
two imagery hosts in the browser. Its 19 checks:

- **Polar Map.** Pointer coordinates read 0° at the top, 90°E on the right,
  180° at the bottom and 270°E on the left; site markers respond at positions
  computed independently from their published coordinates; zooming keeps
  coordinates registered; nothing is requested from an imagery host until a
  remote layer is chosen; the whole map is in view at 1600×1000. (That the
  bundled *image* has this orientation is the Go test in §15.2, not this
  suite.)
- **Imagery layers.** Moon Trek tile URLs follow the documented template; tiles
  land within 0.6 px of their projected corners; *Live*, *Partly loaded* and
  *Unavailable — showing bundled imagery* states; a view outside a layer's
  coverage requests nothing and says so; the LROC WMS GetMap request carries
  the right layer, projection and bounding box; external viewer links open in
  a new tab without opener access; coordinates copy.
- **Data Hub.** All 20 sources and 10 CSA references listed; search and
  filters; *Not confirmed* shown for unknown fields; CSA entries have no data
  actions; a catalogue entry hands its layer to the Polar Map.
- **Horizons verification.** The recorded reference evaluates offline (Sun
  0.0085°, Earth 0.0025° maximum separation); a live query through the API
  agrees, shows its provenance and request URL, is cached on repeat, and
  downloads a report; an upstream failure is explained without comparing
  anything and without leaking internal detail.
- **LOLA acquisition.** A plan reports the native window (292 × 292 of
  512 × 512 pixels) using range requests only; the download never fetches the
  whole raster; the dataset is selected, its metadata shown, real-mode terrain
  and a horizon computed from it.
- **Mobile.** Terrain Lab, hub tabs, verification tables and the map fit a
  390 px viewport with nothing cut off.
- **Static-only hosting.** With no API, the catalogue, the recorded
  verification and the synthetic demo work, and each live feature says why it
  cannot.
- **Production Content-Security-Policy.** The page is served with the headers
  from `vercel.json`. Under that policy the worker-computed analysis, WebGL and
  both imagery providers work with no violation, and an image from any other
  host is refused (a negative control showing the policy is really enforced).

### Native engine against the recorded GDAL / PROJ reference

From `go test -v` in this run (scientific-method §14 explains each line):

- Reader: 10 valid GDAL-written layouts decode identically; 5 invalid rasters
  are rejected with the Python backend's messages; transverse Mercator is
  refused by design.
- Projection: 7 definitions × 8 points agree with PROJ 9.5.1 to 1e-6 m forward
  and 1e-9° inverse.
- Extraction: in all 14 cases (10 synthetic, 4 on the real LOLA fixture) the
  native grid equals GDAL run with its exact transformer to 0.0000 m, with
  identical NoData masks.
- Against the v1.11 backend's default GDAL settings the largest cell
  differences are 7.94 m (synthetic rough DEM), 2.09 m (real fixture, Malapert,
  20 km) and at most 0.06 m in the other three real cases — equal in each case
  to the difference between GDAL-exact and GDAL-default.
- API: 111 recorded v1.11 request/response pairs replay through the Go router.
- Basemap orientation: mean crater-floor brightness 4.3 under the documented
  orientation against 23.5, 37.5 and 49.0 under the three alternatives.

### Defects found by this verification and fixed before release

Recorded in [known-issues.md](known-issues.md) with the tests that now guard
them: `.vercelignore` removing `src/data`; temporary storage reported as
persistent on Vercel; a LOLA subset stitchable from two versions of a source
file; a spoofable rate-limit key and unbounded limiter table; upstream
transport errors leaking URLs; the function depending on an optional platform
variable; per-tile screen-reader announcements; and the v1.11 Polar Map
orientation error itself.

### Honesty notes

- **Software rendering needed longer timeouts.** Without a GPU, starting
  timeline playback blocks rendering for a long time once per page. With
  default patience the mission browser suite failed twice at its 30 s Terrain
  Lab wait; measured, the lab became ready after 57 s on this tree and after
  **62 s on the unmodified v1.11 base commit** on the same machine, so the
  cause is the environment, not this release. `CHANDRA_E2E_TIMEOUT_SCALE`
  multiplies waits in the mission, story and export suites; it is unset in CI
  and changes no assertion. One run of the mission suite at default patience
  did pass earlier in the same session. On GitHub's runners, which also have no
  GPU but use Playwright's Chromium, all suites passed at default patience in
  minutes, so the stall belongs to the fallback browser build used here.
- **The local story and export runs are not clean runs by this project's own
  rule.** Two reasons. First, after they passed, the working tree changed in:
  two text strings in the Data Hub's verification panel; the order of two
  state updates after a LOLA download in the Terrain Lab dataset panel;
  `public/assets/PROVENANCE.md`; Go backend hardening (storage reporting,
  rate-limit key, range-read consistency); and test scripts. Neither suite
  opens the Data Hub or performs an acquisition. Second, documentation and
  backend files were edited while they ran, and the dev server pushed
  stylesheet hot-updates in response (the Tailwind plugin treats project files
  as stylesheet inputs). A stylesheet hot-update neither reloads the page nor
  resets application state, but earlier releases counted only runs with no
  concurrent edits. **The clean evidence for these two suites is the GitHub
  Actions runs on the pushed commit**, where no editing is possible and both
  passed at default patience. The mission, data-feature and real-DEM suites
  and every non-browser gate ran locally on the final tree; the data-feature
  and real-DEM suites do not use the dev server.
- **Changes to the older suites, none loosening an assertion:** the story and
  export suites now locate the toast by `[role="status"][data-testid="toast"]`
  because the page has further status regions; the export suite reads the
  expected application version from `package.json` instead of a literal
  `1.11.0`; waits can be scaled by the environment variable above.
- **Screenshots.** `screenshots/00–13` and `v112-a…g` were regenerated in this
  run. The story (`15–22`) and export (`v110-*`, `v111-*`) captures are
  best-effort, timed out under software rendering, and are unchanged from
  v1.11. `v112-f` shows the Terrain Lab labelled *synthetic* after an
  acquisition: that is correct, because the raster the test "acquires" is a
  synthetic fixture and carries that tag.
- **Horizons fixtures are transcriptions.** The responses were retrieved with a
  page-fetch tool and transcribed; values are Horizons', bytes are not
  guaranteed identical (`backend/horizons/testdata/README.md`).
- **The real-LOLA fixture** is the same third-party gap-filled downsample as
  in v1.11: software-path evidence only. Tests that need it skip where it is
  absent, which includes ordinary CI.
- **Rust was not built.** The Go/Rust comparison in the architecture document
  is an assessment, not a measurement.

### Not verified in v1.12

- A live Vercel deployment: build on Vercel's builders (including its own Go
  toolchain download), the function on real infrastructure, the CDN headers,
  Deployment Protection behaviour.
- Real responses from NASA Moon Trek, the LROC WMS, JPL Horizons and NASA PGDA
  as consumed by this application.
- Vercel Blob against the real service.
- Anything on hardware with a GPU, on Firefox or Safari, or with a screen
  reader.
- The mission-level effect of the terrain differences in §14.4.

## v1.11.0 integrity release — executed evidence

Executed on branch `arena/df057ecf-clps-lunar-mission` from the merged v1.10
base `57e4c3c`. `APP_VERSION` is **1.11.0**; `REPORT_SCHEMA_VERSION` remains
**2.0.0**. The three v1.10 priority-0 findings are closed in
[known-issues.md](known-issues.md). Analysis fingerprint **values** change
because the canonical key no longer rounds; the opaque fingerprint field and
report format do not change.

| Gate | Command | Executed result |
|---|---|---|
| Dependencies | `npm ci`; Python `.venv` + `requirements-dev.txt` | clean; 0 npm vulnerabilities |
| Typecheck / build | `npm run typecheck && npm run build` | clean; React / Three / ephemeris remain split chunks |
| Unit suites | `npm test` | **328 passed, 32 files** (adds analysis-identity, session-size, energy-resolution-disclosure and cache-collision regressions) |
| Geometry | `npm run test:geometry` | passed |
| TS ↔ Python horizon parity | `npm run test:parity` | passed |
| Python (ordinary, no kernels) | `npm run test:python` | **92 passed, 4 skipped** — the 4 SPICE-kernel-gated tests are skips, not passes |
| Independent SPICE validation | fetch kernels + `pip install spiceypy`; `pytest -q -rs`; `pytest tests/python/test_lunar_frame.py -q -rs` | kernels fetched from the checksummed GitHub mirrors (`data/kernels/PROVENANCE.json`, git-ignored); full pytest **96 passed**; frame suite **26 passed** |
| Mission / Terrain / Space browser E2E | `npm run test:browser` | passed (console, Terrain Lab, Space views, mobile) |
| Story briefing E2E | `npm run test:story` | **personas A–E passed** under the v1.11 session/export code |
| Scientific-export E2E | `npm run test:exports` | **personas A–E passed, 567 s** on the clean re-run. First clean attempt passed A–C, then Persona D hit the known 20 s Terrain Lab `#terrain-mode === 'real'` SwiftShader-load flake; re-run passed with no source/test expectation change and no timeout lengthened. Persona C now also injects an 800,001-character session and asserts the size-specific rejection + Rebuild/Exit. |
| Real-DEM software fixture smoke | fetch fixture; backend `:8001`; `npm run test:real-dem` | **passed** against the third-party gap-filled verification downsample (software path only — not a science product). First two attempts timed out because the first-run welcome modal trapped the `t` shortcut; the harness now seeds `chandra-onboarded-v1` (setup fix, no assertion removed, no timeout lengthened). |
| Canonical-key sanity benchmark | `npm run bench:identity` | Node v22.22.3; 3,601 bins; 1,000 calls; key length 25,586 chars; median **1.0109 ms**, p95 **1.8401 ms**; 36-entry LRU key storage ≈ **1.76 MiB**. Optional sanity check, not a CI gate or performance guarantee. |
| Manual screen-reader protocol | NVDA / VoiceOver | **NOT EXECUTED** — protocol + expected results in [accessibility-manual-protocol.md](accessibility-manual-protocol.md); no screen-reader pass claimed |
| Optional real-DEM workflow | `.github/workflows/real-dem-fixture.yml` | added as `workflow_dispatch` only; **not executed in GitHub Actions here**. The equivalent local smoke above passed. |
| Static demo deploy | — | **not deployed**; base-path asset blockers and owner steps recorded in [product-design.md](product-design.md) |

### What the new regressions prove

- **Exact identity:** elevation +1e-4°, coordinate +1e-6°, azimuth offset,
  +1 ms / +1000 ms windows, terrain metadata and config edits produce distinct
  canonical keys; property order is stable; non-finite/sparse/cyclic inputs are
  rejected; the worker cache posts separate requests and the export guard
  refuses near-identical terrain substitution; the SHA-256 fingerprint consumes
  the same key. LRU stays 36.
- **Session size:** 800,001 UTF-16 code units are rejected before `JSON.parse`
  (spy-verified), exactly-800,000 valid v1 migration is accepted, save preflight
  refuses oversized writes, storage failures are returned, and boot shows a
  persistent dismissible notice. Structural validation/migration are unchanged.
- **Coarse energy:** `ENERGY_RESOLUTION_COARSE` appears in JSON warnings, all
  five mission CSV disclosure columns, comparison CSV/JSON warnings, telemetry
  and comparison notices, and the timeline a11y description; converged/adequate
  results are not flagged. The wording names the ≥1% threshold and the
  Richardson estimate as not a confidence interval / not thermal survival.

### Honesty notes

- Browser suites were run against the live dev stack with **no concurrent
  repository edits**; Vite HMR/page-reload events from editing watched files
  during a run invalidate that attempt. Interrupted attempts are not counted.
- The real-DEM fixture is a third-party bilinear downsample whose invalid source
  pixels were filled by the derivative author. Passing the smoke verifies
  loading/cropping/horizon/import software paths, **not** the source datum,
  frame, NoData coverage or shadow science. Fixture provenance is recorded in
  `data/verification/PROVENANCE.json` (git-ignored).
- `spiceypy` is an optional validation dependency installed for the kernel-gated
  run (the CI `spice-validation` job already installs it). Ordinary
  `requirements-dev.txt` runs still report the 4 frame tests as skipped.
- Repository owner actions remain outstanding: rename to `chandra`, product
  description, and branch protection with the three exact checks. Read-only
  metadata re-read: `Hemansh2633B/Clps-lunar-mission`, `main.protected = false`.

## Automated suites

| Suite | Command | Result |
|---|---|---|
| TypeScript typecheck | `npm run typecheck` | clean |
| Production build | `npm run build` | clean; React / Three / ephemeris split into separate chunks |
| Engine + SPICE-reference validation + frame allowlist + transition stress + event-aware energy + analysis status + sampling/battery + catalogue + presets + explanations + UTC + workflow + simulation client + export + DEM-profile + vehicle/geo + story chapter/progress/narrative + identity/session/coarse-resolution + v1.12 polar projection, Horizons comparison and Data Hub unit tests | `npm test` | **368 passed** (Vitest, 35 files) |
| Native backend: GeoTIFF reader, projections, DEM validation, extraction, horizon, frames, Horizons client, LOLA acquisition, storage, catalogue, HTTP API | `npm run test:go` | **77 tests + 30 subtests passed, 2 opt-in live tests skipped** (v1.12 executed evidence above). Replaces the v1.11 Python suite (92 passed, 4 skipped at removal), whose behaviour is preserved as the recorded reference in `tests/golden/`. |
| SPICE evidence tool (optional, Python) | `pytest tools/spice-evidence -q -rs` | **22 passed, 4 skipped** without kernels; the CI `spice-validation` job fetches kernels and runs the gated tests for real |
| Vercel configuration and built function | `npm run vercel:check` / `-- --built` | passed locally (v1.12 executed evidence above); not a live deployment |
| Geometry checks | `npm run test:geometry` | passed: curvature, pole coordinates, Sun directions, exact landing origin, shadow casting, NoData topology, synthetic demo, horizon ray-marching |
| Horizon parity | `npm run test:parity` | passed: TypeScript and native Go ray-marchers agree on elevations, coverage, edge inset, obstacle ranges |
| Mission + Terrain Lab + Space views browser E2E | `npm run test:browser` | passed: catalog, Apollo/far-side, comparison, educator, custom site, modal keyboard guard/focus, export (blocked while computing), playback; Terrain Lab orbit drag, keyboard orbit, top/oblique presets, inspection pin, exaggeration, shadow pixel brightening, Sun extremes, all grid qualities, radius, horizon CSV/import, real-mode no-DEM safeguard, 390 px mobile layout; **Space views**: planet markers/labels, time-lapse clock + sub-solar sweep, south-pole preset, fleet stack/HLS/CLPS switching, stage separation, engine plume, hover part callout, view close; **v1.7 features**: first-run onboarding offers demo / real-DEM choice and dismisses cleanly; guided six-step workflow opens, shows six steps and advances; chart text alternatives (panorama/timeline/polar-map `role="img"`) and a labelled keyboard time scrubber; **2024 Regions** tab shows exactly nine region-approximate regions; explicit **UTC date + time** mission-start fields drive recompute; persistent provenance indicator; heuristic score breakdown + "not an RF link budget" disclosure |
| Real-DEM browser smoke | `npm run test:real-dem` | **passed in v1.12** against the native Go API and the fetched third-party software fixture (gap-filled downsample; software path only, not science validation). |
| THE 14-DAY WINDOW story E2E (v1.9 personas A–E) | `npm run test:story` | passed — **all five personas under v1.12** (see the v1.12 notes on timeouts and ordering) |
| Scientific-export E2E (personas A–E) | `npm run test:exports` | passed under v1.12 (1550 s under software rendering; Persona A adds schema 2.1.0 and `dataProvenance`) |
| Data-feature E2E (v1.12) | `npm run test:datahub` | passed: 19 checks (Polar Map, imagery layers, Data Hub, Horizons verification, LOLA acquisition, mobile, static-only hosting, production CSP) |

## Repository restructure & rebrand — executed evidence (2026-11-08)

Executed on branch `arena/6ac61b25-clps-lunar-mission` after moving the
application from `final draft 1/` to the repository root and renaming the
product to CHANDRA (npm package `chandra`). No scientific code, numerical
constant, threshold or test expectation changed; the version stays 1.10.0
and the report schema stays 2.0.0. Source changes were limited to branding
strings (wordmark, onboarding title, document title, header version label
now derived from `APP_VERSION`) and one added browser assertion (document
title). All gates below ran from the repository root.

| Gate | Result |
|---|---|
| `npm ci` | clean install; lockfile matches package.json (name `chandra`) |
| `npm run typecheck` / `npm run build` | clean |
| `npm test` | **300 passed, 29 files** (re-run after the header-label change: same) |
| `npm run test:geometry` / `npm run test:parity` | passed |
| `npm run test:python` (no kernels) | **92 passed, 4 skipped** — the 4 SPICE-kernel-gated frame tests skip, reported as skips |
| Independent SPICE validation | `scripts/fetch-spice-kernels.py` fetched all 5 kernels (checksums recorded in `data/kernels/PROVENANCE.json`); `tests/python/test_lunar_frame.py` then ran for real: **26 passed**; full pytest with kernels present: **96 passed** |
| `npm run test:browser` | passed — includes the new `page.title() === 'CHANDRA — Lunar Mission Planning'` assertion |
| `npm run test:story` | passed — personas A–E |
| `npm run test:exports` | passed — personas A–E, 413 s. **First attempt failed** in Persona D at the 20 s wait for the Terrain Lab mode selector to become `real` (SwiftShader software-GL load flake; the identical mock sequence had passed in Persona B minutes earlier). Re-run passed with **no source or test change** between attempts. No timeout was lengthened and no assertion was removed. |
| Dev stack from root | `npm run dev:full` starts Flask :8000 + Vite :5173; `/api/health` and the Vite `/api` proxy respond; title and bundled assets verified over HTTP |
| Real-DEM browser test | **NOT RUN** — `data/verification/` fixture absent in this environment, as in the v1.9/v1.10 runs |
| Manual screen-reader protocol | **NOT EXECUTED** — unchanged from the accessibility audit |
| Docs integrity | every relative Markdown link resolves; every documented `npm run` script exists; no `final draft 1/` or old-package references outside explicitly historical documents |

CI on the restructured layout: the three job names are unchanged; results
are recorded on the pull request (see `docs/ci-governance.md` for the
required-check contract and the pending GitHub-side rename).

## v1.10 scientific export & data integrity — executed evidence

Executed 2026-11-07 on branch `arena/73a0c053-clps-lunar-mission` (base `main` @
`e5d6114`, v1.9.0). All claims below are from runs in this environment; nothing
is extrapolated.

| Gate | Result |
|---|---|
| `npm run typecheck` / `npm run build` | clean (tsc strict; vite production build) |
| `npm test` | **300 passed, 29 files** — includes the new tests-first suites: export provenance (schema/app version independence, SHA-256 fingerprint = simulationKey digest, effective-vs-requested config + clampedFields, status-aware terrain disclosure, CSV provenance on every row), energy-history reconciliation (last row/extrema ≡ summary by construction), events CSV (ms precision, pre/post state, refinement resolution), comparison states (valid/synthetic/illustrative/computing/blocked/failed/missing-site/stale; blanks never zeros; no cross-tier ranking), guard identity (changed config or terrain ⇒ stale refusal for all six kinds), session validation (MISSION_LIMITS parity, deep site/terrain checks, frameVerified re-derivation, duplicate/dangling rejection, v1→v2 revalidating migration, whole-payload rejection), cross-output consistency (JSON warnings ≡ UI provenance ≡ CSV disclosures) |
| `npm run test:python` | **92 passed, 4 skipped** (kernel-gated SPICE tests skipped — never counted as passed) |
| `npm run test:geometry` / `npm run test:parity` | passed |
| `npm run test:browser` | passed (console + Terrain Lab + Space views + mobile). Artifact screenshots are best-effort with a bounded timeout on headless SwiftShader; every state assertion and the canvas pixel-difference assertions remain hard failures |
| `npm run test:story` | **v1.9 personas A–E all passed unchanged** under the v1.10 session/export code (~17 min) |
| `npm run test:exports` | **personas A–E all passed (486 s)** — details below |
| `npm run test:real-dem` | **not run** — the verification fixture TIF is absent from this environment (reported as not run, never as passed) |

### Export personas (scripts/export-browser-test.mjs, runs in the CI browser job)

- **A — scientist reconciles the export:** downloads the JSON report, telemetry
  timeseries, energy history and events CSVs from a real resolved analysis;
  asserts row counts vs `reproducibility.sampling`, the 64-hex fingerprint and
  its 16-hex CSV form on every row, and reconciles the energy CSV's final
  SOC/cumulative generation/deficit hours against the JSON summary (±0.002 pct /
  ±0.005 kWh); events carry exact ms timestamps and boundary rows exist at
  start/end and the refined Sun transition (de Gerlache Rim 2 fixture — most
  catalog sites have zero transitions in the test window and correctly produce
  header-only event files).
- **B — comparison with a blocked row:** pins a valid scenario + an
  epoch-2040 ME-DEM scenario (blocked); exports matrix CSV/JSON; asserts the
  blocked row has an explicit `BLOCKED` state with the analysis status and
  **empty numeric cells** (never zeros), the valid row carries its confidence
  tier, and the export-policy note is present.
- **C — persisted state:** a user workspace with custom sites survives reload;
  a v1 session migrates to v2 through revalidation (training slip preserved);
  an injected out-of-range config (durationDays 200 > MISSION_LIMITS 90) is
  rejected **whole** — never applied, explicit boot notice, unusable payload
  cleared once, briefing offers Rebuild/Exit.
- **D — confidence provenance:** illustrative, synthetic-DEM and mocked
  measured-DEM analyses each export with the correct `data_confidence` /
  `terrain_kind` / disclosure codes; confidence is never derived from
  performance.
- **E — accessibility:** keyboard-only export initiation announces "Export
  initiated" via `role="status"`; a refused (blocked) export announces the
  refusal; blocked-analysis notices are `role="alert"`; 390 px mobile and
  reduced-motion behavior verified. **No screen-reader pass is claimed** —
  NVDA/VoiceOver remain an unexecuted manual checklist (docs/accessibility.md §4).

Network mocking is confined to the DEM API boundary (same helpers as the story
suite); all technology under test — engine, guard, exporters, session
validation, UI — is the real application code.

### Defects found by the new tests and fixed in this release

1. `makeCustomSite` ids were `Date.now()`-only — two sites created in the same
   millisecond collided and the new duplicate-id validator (correctly) rejected
   the session. Ids now carry a monotonic suffix.
2. A rejected persisted payload used to linger in storage and re-notify on every
   reload; it is now cleared once after the explicit notice (progress key kept).
3. Custom-site modal labels were not programmatically associated with their
   inputs (screen readers could not name the fields); `htmlFor`/`id` pairs added
   for all fields including the 8 sector sliders.

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
| Manual screen reader | **not executed** — NVDA/VoiceOver protocol recorded in `docs/accessibility.md`; no screen-reader pass claimed |
| Screenshots | `screenshots/15…22-story-*.png` (best-effort under SwiftShader; assertions are the verification) |

**GitHub Actions evidence (queried via API on 2026-11-07):**

| Run | Commit | Result |
|---|---|---|
| 42379651272 (post-merge v1.8, push to main) | `03c3522` | quality ✓ · spice-validation ✓ · **browser ✗** at "Run story tutorial E2E" (Persona D timeout; A–C passed, E never ran) — the failure v1.9 fixes |
| 42383009327 (Phase-1 fix only) | `23c4117` | **all green**, incl. step 10 "Run story tutorial E2E (personas A–E)" — root-cause fix verified on the real runner before further changes |
| 42389036663 (Phases 2–4 + new personas) | `ccfd8cf` | **all green** (quality + browser with the rewritten personas; SPICE job not yet PR-triggered at this commit) |
| 42389576252 (a11y + SHA-pinned actions + governance) | `12f4556` | **all green** — pinned checkout v7.0.1 / setup-node v7.1.0 / setup-python v7.1.0 / upload-artifact v7.0.2 proven on the runner |
| **42391771892 (PR #5, pull_request, final tree)** | `8d777fc` | **all three required jobs green**: quality ✓ · browser ✓ (steps "Run browser E2E" ✓ and "Run story tutorial E2E (personas A–E)" ✓; screenshots uploaded; failure-log step correctly skipped) · **spice-validation ✓ on the PR** (kernels fetched from checksummed mirrors, presence asserted, kernel-gated frame tests executed — not skipped) |
| 42391720246 (push, same final tree) | `8d777fc` | all green |

Raw CI log download is blocked in this sandbox (`results-receiver.actions.githubusercontent.com`
outside the egress allowlist); job/step metadata was read via `api.github.com` and the
failure was additionally reproduced experimentally in the sandbox (delayed-API probe:
mode `synthetic` at compute-click, 0 mocked horizon calls, 0 alerts; fast-API: mode
`real`, 1 call, alert present). See `docs/ci-governance.md` §4.

**Defects fixed en route (found by the new tests, not assumed):** ticker marquee
intercepting Export-dropdown clicks (stacking + pointer-events); stale `active` story
status after refresh; `--dim` small text below AA (4.32/3.65 → 5.65/4.76); Terrain Lab
alert text 4.19 → 5.23; panorama/timeline/map aria-labels and the horizon table
out-claiming the visibility gate. Details: `docs/accessibility.md`,
`docs/implementation-history/v1.9-reliability.md`.

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
