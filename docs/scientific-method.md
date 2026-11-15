# Scientific method · CHANDRA

This document records the physical models, reference frames, validation evidence, and
**explicit limitations** behind the console. It is written so a reviewer can reproduce
every number and see exactly where the tool is an engineering heuristic rather than a
certified flight analysis. Nothing here upgrades illustrative or synthetic data into a
scientific result.

Companion files: `docs/verification.md` (executed test evidence), `tests/data/frame-reference.json`
(SPICE validation reference), `tools/spice-evidence/lunar_frame.py` and
`tools/spice-evidence/generate_frame_constants.py` (authoritative frame constants generator — an
optional offline tool; the application does not run Python), `tests/golden/` (recorded GDAL/PROJ and
v1.11 backend reference for the native terrain engine, §14).

---

## 1. Reference frames and compatibility

### The problem

The mission ephemeris uses the **IAU 2015 Moon rotation** (`astronomy-engine`
`RotationAxis(Body.Moon)` + `Libration`). NASA LOLA south-polar DEMs (PGDA product 90,
`LDEM_80S_20MPP_ADJ.TIF`) are published in **MOON_ME (JPL DE421)**. These are *different*
body-fixed realizations. Combining them silently would mis-place the site and rotate the
horizon mask by an unknown amount.

### What SPICE shows

Using `spiceypy` with `de421.bsp` + `moon_pa_de421_1900-2050.bpc` + `moon_080317.tf` +
`pck00008.tpc` (see `data/kernels/PROVENANCE.json`, fetched by
`tools/spice-evidence/fetch_spice_kernels.py`):

- `MOON_ME_DE421` (frame 31007) differs from `MOON_PA_DE421` by the fixed rotation
  67.92″ / 78.56″ / 0.30″ about axes 3, 2, 1 → **0.028847°**.
- The **IAU 2015 frame is close to MOON_ME, not MOON_PA** (the IAU prime meridian is the
  mean-Earth direction). A constant rotation removes the mean ME→IAU bias.
- The PCK orientation coverage spans **1899–2050**, so the correction is valid across the
  mission-planning horizon.

### Shipped correction

`tools/spice-evidence/generate_frame_constants.py` fits constant `ME_TO_IAU` and `PA_TO_IAU` rotations
**targeting the app's own `astronomy-engine` IAU frame** (sampled monthly 2020–2035 via
`scripts/iau-frame-grid.ts`), not SPICE's `IAU_MOON` (the two differ by ~0.001° because of
coefficient-version differences). Results (`src/engine/lunarFrameData.ts`, auto-generated):

| Transform | Mean rotation angle | Max residual over 2020–2035 |
|---|---|---|
| ME → IAU | 0.001677° | **0.003869°** |
| PA → IAU | 0.027525° | **0.003869°** |

The residual (~0.0039°, ≈120 m on the surface) is **disclosed everywhere** as a frame-model
uncertainty. This is a *constant* approximation, **not** a rigorous time-dependent
transformation; it is adequate for planning-grade visibility, not for geodesy.

### Gating (never mix frames silently) — explicit allowlist + epoch validation

`src/engine/lunarFrame.ts` `classifyFrame` (mirrored by the Go API in `backend/frames` and by
`tools/spice-evidence/lunar_frame.py`, kept in parity by tests) does **not** accept a frame merely because its
text contains `IAU` / `MOON_ME` / `MOON_PA`. It strips any descriptive suffix (after `—`, `;`,
`,`, or ` - `), normalizes the head, and matches it against an **explicit allowlist**:

- **ME** = {MOON_ME, MOON_ME_DE421, MOON_ME_JPL_DE421, ME, ME_DE421}; **PA** = the analogous
  DE421 set; **IAU** = {IAU_MOON, IAU_2015_MOON, IAU_MOON_2015, IAU_2015}.
- An unknown realization (e.g. `MOON_ME_DE440`, `NOT_MOON_ME`, `WEIRD_IAU_FRAME`) is **rejected**,
  not silently coerced — a substring match would wrongly accept these.
- The constant correction is only validated over **2020-01-01 → 2035-12-31 UTC**.
  `frameEpochInRange` / `frameIntervalValidated` check the mission interval; outside it the
  analysis is blocked as `FRAME_MODEL_OUTSIDE_VALIDATED_RANGE` rather than extrapolated silently.

Gate outcomes:

- **Allow-listed frame, interval in range** → `frameVerified = true`: site coordinates rotated
  into IAU (`convertSite`), horizon azimuths rotated by the matching offset (`rotateMaskAzimuths`),
  residual recorded and disclosed.
- **Unrecognized frame** → `frameVerified = false`: terrain **viewable in Terrain Lab** but
  **blocked from quantitative mission visibility** (`FRAME_UNVERIFIED`; "Use in mission" disabled,
  red banner, export warning, excluded from rankings).
- **Synthetic demo** → allowed as a clearly labeled demo; never frame-verified as real data.

---

## 2. Independent ephemeris validation

`tests/ephemeris-validation.test.ts` compares the app against an **independent SPICE
evaluation** (`tests/data/frame-reference.json`): 9 epochs (2026-06 → 2027-06) × 6 sites
including the exact south pole, a near-pole point, and several longitudes. The IAU frame is
evaluated by SPICE from `pck00008.tpc`, independent of `astronomy-engine`.

Conventions: planetocentric latitude, east-positive longitude, azimuth from north toward
east. Sub-Earth uses geometric light-time (LT); sub-solar and topocentric az/el use LT+S
(light-time + stellar aberration). Radius 1,737,400 m.

**Measured maximum errors (fixed tolerances, not tuned to pass):**

| Quantity | Max error | Tolerance |
|---|---|---|
| Sun elevation | 0.000576° | 0.01° |
| Earth elevation | 0.000246° | 0.01° |
| Azimuth (Sun & Earth) | 0.007181° | 0.02° |
| IAU frame angle vs SPICE | 0.001028° | 0.002° |
| Sub-Earth point lat/lon | 0.006173° | 0.01° |
| Constant ME→IAU vs exact (position) | ≤ residual | 0.005° |

A topocentric parallax bug in the sub-Earth point (previously ~0.26°) was found and fixed
during this audit; the sub-Earth point is now selenocentric. Light-time and aberration are
retained. Near the exact pole, raw longitude is ill-defined (amplified by 1/cos lat), so the
conversion test asserts **angular position separation**, bounded by the disclosed residual.

---

## 3. Sampling and transition refinement

- **Uniform capped sampling** (`simulateMission`): the window is sampled uniformly with
  `count = min(20000, max(2, floor(span/step)+1))`. If the requested step exceeds the cap,
  the step is **coarsened uniformly across the whole span**, preserving both endpoints.
  Example: 90 days @ 1 min → 129,601 requested → **20,000 samples @ 6.4803 min**, max gap =
  effective step (no giant final jump). `SamplingInfo` reports requested vs effective step,
  sample count, capped flag, and max gap.
- **Adaptive transition refinement** (`findTransitions`): consecutive-sample sign changes
  alone miss a short window inside one coarse interval. Each interval is flagged when
  clearances change sign **or** approach zero within a kinematic rate bound, then recursively
  subdivided (pruning safe halves) down to 15 s and bisected (`refineCrossing`). A per-interval
  node budget bounds worst-case work. This is ~6× faster than a uniform fine sub-scan and
  resolves short windows the coarse grid would skip.
- **Budget exhaustion is disclosed, never hidden.** When an interval exhausts its node budget,
  the detector falls back to a uniform 15 s re-scan of that interval; if the fallback itself
  caps out, the interval is recorded in `TransitionDiagnostics.unresolvedIntervals` and the
  resolution status becomes `degraded`. A degraded result is surfaced as
  `NUMERICAL_RESOLUTION_INSUFFICIENT` (data kept for inspection, rankings/exports blocked) —
  the tool never presents apparently-complete numbers over an unresolved interval. The
  countdown uses the same refined events, so it stays consistent with the detector.
- **The pruning rate bound is a documented heuristic, not a proved conservative bound.**
  `clearanceRateBound = 0.6 + maxGradient·4.0` (deg/hr) is used only to prune provably-safe
  halves; it is disclosed as a heuristic because the terrain-gradient term is not a rigorous
  kinematic ceiling. Intervals near zero are always subdivided regardless of the bound.
- **Percentages and gaps** integrate the **refined crossing timestamps** (exact interval
  boundaries), not a coarse trapezoid over samples, so they converge as sampling is refined.
  Convergence is asserted in `tests/sampling-battery.test.ts` (coarse 240 min vs fine 30 min
  agree to <0.5% illumination and ≤1 event).

---

## 4. Power and battery assumptions (engineering, not survival)

- **Solar flux**: 1361/au² W/m². Idealized incidence: horizontal deck ∝ sin(el),
  tracking mast ∝ cos(el), fixed mast ∝ cos(el)·cos(Δaz). **Zero output when the Sun is
  terrain-occulted.** No temperature, dust, degradation, or wiring losses beyond `systemDerate`.
- **Battery** (`simulateBattery`): charge efficiency **0.92**, discharge efficiency **0.95**,
  hard SOC bounds [0, capacity], configurable initial SOC, per-interval integration (valid for
  irregular steps), zero-crossing interpolated within the crossing interval. Robustness tests
  cover irregular steps, saturation, long darkness, large surplus, initial SOC, and empty input.
- **Event-aware energy integration** (`src/engine/integration.ts` `integrateMissionEnergy`) is
  what drives the mission summary. The window is partitioned at the **refined Sun rise/set
  timestamps** (terrain shadow included), so each interval has a stable illumination state;
  selected power is integrated with **adaptive Simpson quadrature** over the smoothly varying
  Sun elevation/azimuth and distance (dark intervals forced to 0 W), with a Richardson error
  estimate. Battery SOC is advanced per interval with separate charge/discharge efficiencies and
  hard [0, capacity] bounds, interpolating the depletion crossing. `IntegrationDiagnostics`
  reports the estimated energy error and a resolution status (`converged` / `adequate` / `coarse`).
  Convergence tests (`tests/energy-integration.test.ts`) show 240/60/15-min event partitions agree
  to <0.1 kWh and <0.5% SOC, and match a 1-min reference grid to <1%. The sample-based
  `simulateBattery` remains as a tested fallback/API.
- This is an **energy-balance model only**. It does **not** model thermal survival, radiation,
  depth-of-discharge life, or heater loads. The verdict `ENERGY DEFICIT` (renamed from the
  misleading `SURVIVAL RISK`) reflects the battery model reaching 0%, not spacecraft survival.

---

## 4b. Computation-boundary scientific validation (discriminated status)

Every simulation returns a discriminated `AnalysisAssessment` (`src/engine/analysisStatus.ts`),
a **scientific gate independent of any UI import restriction**:

| Status | Meaning | Quantitative use |
|---|---|---|
| `VALID` | real DEM, allow-listed frame verified, full coverage, interval in validated epoch | eligible |
| `SYNTHETIC_DEMO` | procedural demo terrain | labeled demo only |
| `ILLUSTRATIVE` | non-DEM (illustrative / user-edited) terrain | indicative only |
| `FRAME_UNVERIFIED` | real DEM, frame not on the allowlist | blocked |
| `INCOMPLETE_COVERAGE` | real DEM coverage <100% or NoData elevation | blocked |
| `FRAME_MODEL_OUTSIDE_VALIDATED_RANGE` | ME/PA correction used outside 2020–2035 | blocked |
| `NUMERICAL_RESOLUTION_INSUFFICIENT` | detector left intervals unresolved | blocked (data kept for inspection) |
| `COMPUTATION_FAILED` | invalid interval or thrown error | blocked |

Blocked statuses carry **no samples/events/summary** (terrain stays viewable via `site.terrain`).
The UI replaces numbers with an actionable `AnalysisStatusNotice` (what is wrong + how to fix it),
the comparison matrix excludes blocked rows from ranking, and exports are blocked. `demoEligible`
(VALID / SYNTHETIC_DEMO / ILLUSTRATIVE) governs whether a result may be exported at all;
`quantitativeEligible` governs whether it may be ranked as measured. Invalid data is never
silently substituted with synthetic terrain.

---

## 5. Feasibility score — a disclosed heuristic

The score is **application-defined, not a NASA methodology**:

```
score = round( combined·0.45 + illumination·0.20 + earthLOS·0.15 + energy·0.20 )
energy = depletionHours ≤ 0 ? 100 : clamp(100 − depletionH/durationH·160, 0, 100)
```

`MissionSummary.scoreBreakdown` exposes every component, weight, and contribution; the
Telemetry panel and JSON export display them with a "heuristic" stamp. **Data confidence is
separate from performance**: the comparison matrix ranks "Best" only within the highest
confidence tier present, so illustrative/synthetic terrain is never crowned over a measured DEM.

---

## 6. Honest terminology

- **Earth visibility is geometric line-of-sight**, center-of-disk, no refraction — **not an RF
  link budget** (no antenna gain, transmit power, coding, or pointing loss). "DTE open" means
  Earth clears the terrain, not that a radio link is closed.
- **Array output is instantaneous power (W)**, distinct from net energy (kWh) which accounts
  for the load and battery efficiency.
- **Battery result ≠ survival** (see §4).

---

## 7. Landing-site catalogue & provenance

- **Nine Artemis III candidate regions** (NASA, Oct 28 2024; NTRS
  [20250011660](https://ntrs.nasa.gov/citations/20250011660)): Peak near Cabeus B, Haworth,
  Malapert Massif, Mons Mouton Plateau, Mons Mouton, Nobile Rim 1, Nobile Rim 2,
  de Gerlache Rim 2, Slater Plain. NASA publishes **regions (~15 km across), not precise
  landing points**. The catalogue uses **approximate region centers** (`coordinateType =
  region-center`, `dataConfidence = region-approximate`, ±0.5° uncertainty) with the source URL
  and date — never invented precise coordinates. Terrain relief is illustrative.
- **Current mission context is shown separately from the 2024 dataset.** The tab is renamed
  **"NASA South Polar Candidate Regions — 2024 Dataset"** (rendered "2024 Regions"), and a
  banner records the current Artemis posture (NASA, as of **2026-10-23**): **Artemis III** is a
  crewed **LEO demonstration (2027), not a lunar landing**; **Artemis IV** is the **first crewed
  Artemis lunar surface landing (early 2028)**. The 2024 candidate list is **not** an Artemis IV
  landing-site selection; the nine regions keep their 2024 provenance and source date. Context
  source URLs: `nasa.gov/mission/artemis-iii/` and `/artemis-iv/`.
- **Historical polar candidates** (Shackleton Rim, Connecting Ridge, Leibnitz β) are labeled
  `Historical polar candidate` / `illustrative`, distinct from the Artemis III set.
- **Apollo 11 / 17 and Chang'e 4** are kept separate with **published surveyed coordinates**
  (`coordinateType = surveyed`); their horizon here is an idealized flat model, so terrain
  confidence stays `illustrative`.

Each site carries: stable id, name, program, coordinates + provenance + type + uncertainty,
elevation provenance, terrain source/resolution/frame, source URL, publication date, and
confidence. The persistent `ProvenanceIndicator` reflects the actual computation state:
`SYNTHETIC DEMO`, `ILLUSTRATIVE TERRAIN`, `INCOMPLETE COVERAGE`, `REAL DEM — FRAME UNVERIFIED`,
or `REAL DEM — FRAME VERIFIED`.

---

## 8. Multiscale terrain — current scope and limits

The Terrain Lab ray-marches a **local** horizon within the requested crop (backend radius
limit 0.5–20 km). The mission profile records `analysisScale = local`, `radiusKm`,
`horizonRadiusKm`, and `coveragePercent`, and states explicitly that **a 20 km crop is not a
regional distant-horizon model** — obstructions beyond the crop are not captured.

Regional analysis (distant massifs tens–hundreds of km away) would require the PGDA regional
products (e.g. product 90 polar LDEM and product 78 high-resolution site products: LDEM,
height uncertainty, effective resolution, LDSM slope, LDEC counts). The data model
(`analysisScale`, `regionalRadiusKm`, `verticalUncertaintyM`, `effectiveResolutionM`,
`productVersion`) is in place to carry that metadata when a real regional product is supplied;
until then the tool does **not** fabricate regional horizons or NoData elevations. Azimuth-bin
resolution is never presented as vertical accuracy.

**v1.12 acquisition does not change this scope.** The Terrain Lab can now fetch a subset of five
PGDA product-90 LOLA mosaics by HTTP range reads (§14.4), but a subset is sized for the same
local analysis: it covers the requested radius (at most 20 km) plus a margin, and the horizon
is still labelled `LOCAL`. Acquiring terrain makes a measured local horizon easier to obtain; it
does not make it regional.

---

## 9. State consistency & export integrity

- Results are keyed to the exact input configuration (`simulationKey` includes site, terrain +
  frame metadata, UTC interval, and config). `useSimulation` returns **cached-or-null for the
  active key** with a render-time guard, so a date/site change never shows stale results, and
  superseded worker requests cannot overwrite a newer key.
- **Worker performance:** an **LRU cache** (36 entries, re-inserted on access) and in-flight
  deduplication avoid recomputation. Requests are **reference-counted**; when the last consumer
  abandons a still-pending window it is **cancelled** (coalesced terminate-and-respawn that
  re-posts only still-wanted requests). Cancellation is **debounced (40 ms)** so a release
  immediately followed by a re-request (React StrictMode remount, or a quick drag back) does not
  waste a respawn. **Phase progress** (sampling → transitions → energy → summary) is posted from
  the worker and shown as an accessible progressbar; it reaches the main thread in real time
  because `postMessage` queues to the main thread even while the worker's loop runs.
- Exports are **blocked while computing or errored**, and a guard compares the result's full
  `simulationKey` (site + terrain/frame identity + UTC interval + effective config) against the
  current inputs — a result computed for different parameters can never be exported under the
  current site's name. The JSON report carries a full `reproducibility` block and every CSV row
  repeats machine-readable provenance columns (v1.10 — the complete contract is §13). Heuristic
  scores, illustrative terrain, and frame-unverified DEMs are always disclosed, never exported
  as measured/scientific.

---

## 10. First-time UX, explicit UTC, accessibility, and report horizon labeling

- **Guided six-step workflow** (`WorkflowGuide`): region → UTC date → mission preset →
  plain-language results → comparison → report. Each step drives the real app and advances;
  back/skip/close are supported. It guides the actual product, never replaces the controls.
- **Dismissible onboarding** offers an explicit choice between **Explore demo mode** (labeled
  illustrative terrain) and **Analyze real DEM data** (Terrain Lab). Real mode never silently
  substitutes synthetic data when no DEM is configured. Reopenable from Help.
- **Mission presets** are illustrative engineering starting points, **not NASA vehicle specs**;
  every assumption is explained, and a "Custom" option preserves the current configuration.
- **Every numeric input** has min/max/step/unit/default, an actionable validation message, and a
  sane cleared-input behavior (invalid values are never propagated; they revert on blur).
- **UTC is explicit everywhere.** The mission start uses separate **UTC date + time fields**
  (not a timezone-converting `datetime-local` picker), parsed with an explicit `Z` so the same
  input is the same instant in every browser timezone (`tests/utc.test.ts` verifies invariance
  across six timezones). Timelines, clocks, and exports are all UTC.
- **Plain-language explanations + tooltips + a searchable glossary** sit alongside the technical
  values in both operator modes; the score is always labeled a heuristic, and Earth visibility
  is always labeled geometric LOS, not an RF link budget.
- **Accessibility:** the SVG panorama/timeline and the polar-map canvas expose `role="img"` text
  alternatives; the time scrubber is a labelled keyboard slider announcing UTC; status is never
  color-only (text labels accompany every state); dialogs trap focus and close on Escape;
  toasts are `aria-live`; existing keyboard shortcuts are preserved.
- **LOCAL HORIZON everywhere, including reports.** No regional distant-horizon model is
  fabricated (PGDA products were unavailable). The JSON report carries an explicit
  `horizonScale = "LOCAL HORIZON"` field, a matching warning, and a disclaimer clause; DEM
  horizons disclose the ray-marched local crop and that distant obstructions are not captured.

## 11. Storytelling layer — narrative vs computation (v1.8)

THE 14-DAY WINDOW briefing is a **presentation layer, not a computation layer**. The
separation is enforced structurally:

- `src/tutorial/story.ts` holds only static structure: scenes, fictional dialogue,
  objectives, spotlight targets, knowledge checks, glossary references. It contains
  **no mission numbers**.
- `src/tutorial/narrative.ts` is a set of pure functions `(chapter, live world) →
  dialogue + readouts`. The "live world" is the same `EvaluatedSample`,
  `MissionSummary`, baseline summary and `AnalysisAssessment` the instruments render.
  Every figure in the dialogue is formatted from those objects at read time — the
  story cannot pre-script an outcome, and the slip chapter reports *better or worse*
  depending on what the solver actually computed (±1 pp threshold on combined
  visibility, with the longest-gap comparison always shown).
- Branching is driven by the discriminated `AnalysisAssessment`, never by decorative
  graphics. A blocked assessment (`demoEligible === false`) replaces all quantitative
  dialogue with the assessment's own `reason` + `resolution` and shows **no verdict**.
  The export chapter additionally relies on the real export guard — a refused export
  never credits the objective.
- Chapter completion is witnessed from real app-state changes (selection, time,
  config, slip, pins, guard-passing export counter), not from panel button clicks.
- The fictional framing (Mira, Dr. Arin, the training scenario) is disclosed in
  chapter 0 and in the panel's mission-log line; it is never presented as an actual
  Artemis/CLPS plan.

### Instantaneous visibility gate (defect fix surfaced by the story tests)

Before v1.8, the window analysis was gated at the computation boundary, but the
*instantaneous* readouts (`evaluateAt` at the scrubbed time) still rendered "Window
viable", "Sunlit" and "DTE open" chips against a mask whose frame correction was not
validated at that epoch. Persona D (ME-frame DEM + mission epoch 2040) exposed the
contradiction: the story correctly said *blocked* while the panorama claimed *DTE
open*. The fix assesses `assessTerrainEligibility(site, timeMs, timeMs)` in `App` and
passes `visibilityBlocked` to the telemetry header, panorama chips/markers and site
brief clearance values. Sky positions (elevation/azimuth — pure ephemeris) remain
visible; terrain-visibility claims are replaced by explicit "blocked" labels and
neutral marker styling. The Terrain Lab import gate (unknown frame / incomplete
coverage) is unchanged and remains the first line of defense.


## 12. Tutorial integrity, persisted context and gate-aware descriptions (v1.9)

### 12.1 Objective witnesses are pure, state-derived functions

`src/tutorial/witnesses.ts` is the single home of completion semantics:

- **Comparison (ch7):** credit requires ≥2 **pairwise-distinct** scenarios
  (fingerprint = site + window start + full config), **created during the training
  session**, each **resolved** to a demo-eligible analysis, with the comparison view
  open. The user's pre-briefing pins are excluded twice: the training workspace is
  isolated (their pins live in the session snapshot), and their IDs are filtered even
  if isolation were bypassed. Identical repeats dedupe; a pin rejected by the 4-pin
  cap never enters state and cannot count; computing or blocked scenarios never
  count. The scenario set at chapter start is recorded as an audit baseline; pins
  created earlier in the same training journey remain valid (refresh-stable).
- **Mission report (ch8):** `creditsMissionReport` returns true only for a
  `kind === 'json'` export that passed `missionExportGate` and whose download was
  initiated without throwing (`downloadInitiated`). CSV exports (timeseries /
  summary / horizon / events / energy) never credit. The gate
  (`src/utils/exportGuard.ts`) refuses computing, failed, missing, blocked and
  **stale** results — staleness is a full `simulationKey` identity comparison
  (site, terrain + frame metadata, UTC window, effective config), not just
  site/window — and additionally refuses horizon clearance CSVs at epochs where
  the frame correction is unvalidated. Browser-level download cancellation is not
  observable from page script, so the UI and witness say **"initiated"**, never
  "saved"/"completed" — the E2E suites verify actual download events and file
  contents.

### 12.2 Isolated, persisted training context

`src/tutorial/session.ts` persists a versioned, strictly validated
`TrainingSession` (`chandra-story-session-v1`) containing **both** workspaces:
the user's pre-briefing state (site, baseline, slip, config, view days, mission time,
mode, view, scenarios, playback, speed, custom sites) and the live training state,
plus the active chapter's witness baseline. Behavior:

- Training start snapshots the user workspace, loads a clean isolated mission and
  **pauses playback**; exit *and completion* restore the user workspace exactly.
- Refresh boots back into the exact training context (debounced writes + a
  synchronous `pagehide` flush); the panel stays closed and the launcher offers
  Resume. A stale persisted `active` status is normalized to `paused` on mount.
- Corrupt/unknown-version payloads parse to `null` — never a throw, never a partial
  apply. If saved progress points into training chapters with no valid session
  (including any v1.8 save), the panel shows an explicit **Rebuild / Exit** recovery
  card instead of resuming against unrelated defaults. Orphaned sessions restore the
  user workspace. Export credit is deliberately re-earned after a refresh.

### 12.3 Descriptions may not out-claim the gate

`src/utils/a11y.ts` centralizes the gate-aware wording, unit-tested for every blocked
status: the panorama `role="img"` description reports **sky positions only** when
terrain visibility is blocked (no visibility states, no clearance values); the DEM
footer quotes the `AnalysisAssessment` verbatim when blocked and otherwise states
allowlist verification, the constant-rotation residual, coverage and LOCAL scope;
the timeline description names a blocked status instead of implying "not computed
yet"; the polar-map Earth vector becomes azimuth-only (neutral color + disclosure);
the horizon table withholds clearance columns and disables its CSV at blocked
epochs. Automated label assertions are **not** a screen-reader pass; the manual
NVDA/VoiceOver protocol in `docs/accessibility.md` is explicitly unexecuted.

### 12.4 Comparison narrative reads resolved results only

Chapter 7's dialogue is derived from the same cached simulations the comparison
matrix renders (matrix = source of truth). Branches: fewer than two distinct
briefing scenarios → guidance; unresolved → explicit computing state; blocked or
failed → the gate's own reason/resolution with **no deltas**; two valid → the actual
setting differences (site, start, every changed config knob) and computed
illumination/DTE/combined/longest-gap/energy/min-SOC deltas. Mixed confidence tiers
are flagged **not comparable for ranking** — a higher heuristic score on weaker data
never outranks stronger data. No delta is hardcoded.

### 12.5 Regional terrain & per-epoch frames — researched, not implemented

`docs/implementation-history/v1.9-terrain-frames-feasibility.md` documents the authoritative PGDA LOLA
products (CRS, datum, effective resolution, NoData) and the NAIF per-epoch
`PXFORM` method with acceptance plans. Neither data access nor safe validation was
possible in this environment, so the **LOCAL HORIZON** model and the **constant
correction + 2020–2035 gate** remain the only supported behavior. Metadata fields
are not capability claims.

---

## 13. Scientific exports & reproducibility (v1.10; v1.11 integrity fixes)

The export pipeline was rebuilt so a downloaded file is independently
understandable: what was calculated, from which data, under which assumptions,
with which limitations — without the app open.

### 13.1 Identity: app version, schema version, analysis fingerprint

- `applicationVersion` (from `package.json`) and `reportSchemaVersion`
  (`REPORT_SCHEMA_VERSION`, `2.1.0` since v1.12 — see §13.11; `2.0.0` in
  v1.10–v1.11) are **independent**. The schema version changes only when the
  export format changes, never on ordinary app releases.
- `analysisFingerprint` = SHA-256 (Web Crypto) of the exact `simulationKey()`
  string — the same identity the worker cache and the export guard use. There is
  no second, incompatible fingerprint. JSON carries the full 64-hex digest;
  CSVs carry the 16-hex short form (`analysis_fingerprint`) on **every row**, so
  any two files can be checked for describing the same analysis even after being
  separated. `generatedAt` is an ISO-8601 UTC instant (`timeReference: 'UTC'`).
- **v1.11 exact identity:** `simulationKey()` is a versioned canonical JSON
  serialization (`chandra-analysis-v2`) of the full JSON-safe site (every
  terrain bin and metadata field), the millisecond UTC window and the caller
  config. Object keys are sorted; array order is significant; numbers keep full
  double precision (no `toFixed`); non-finite/sparse/cyclic/non-JSON inputs are
  rejected. The cache key is the canonical string itself; the fingerprint is its
  SHA-256 digest. Export builders pass the **effective** config to the same key.
  Fingerprint VALUES therefore change across v1.11 even for inputs that rounded
  to the same v1.10 key; the opaque field format and report schema `2.0.0` do
  not change. Regression tests prove near-identical masks/coordinates/windows
  and metadata edits produce distinct keys, cache entries, guard decisions and
  fingerprints.

### 13.2 Effective config, never requested config

The report quotes `SimulationResult.config` — the engine-sanitized values the
calculation actually used. `requestedConfig` is recorded alongside it, and if
sanitization changed anything, `configWasClamped` is true and `clampedFields`
names each affected field (requested vs effective values are both in the file) —
an export can never claim it ran with parameters the engine refused.

### 13.3 Site & terrain provenance, status-aware wording

`reproducibility.siteProvenance` records site id/name, coordinates, catalog
source + position uncertainty (or custom/DEM origin), terrain kind, source
file, native frame, applied transform, residual, validated epoch range
(2020–2035 UTC), coverage percent, horizon radius, effective resolution, and eye
height. The terrain disclosure is **derived from the analysis status**, not a
generic warning: verified ME/PA DEMs name the constant correction and its
residual and stay labeled planning-grade; IAU DEMs state the supported frame;
unverified-frame / incomplete-coverage / out-of-epoch results state why
quantitative use is blocked; synthetic and illustrative terrain are labeled
demo/illustrative. The same disclosure codes appear in the UI provenance panel,
the JSON warnings, and the CSV `disclosures` column — one vocabulary everywhere
(`LOCAL_HORIZON`, `SCORE_HEURISTIC`, `LOS_NOT_RF`, `ENERGY_NOT_THERMAL`,
`ENERGY_RESOLUTION_COARSE` when applicable, plus terrain/frame/coverage/epoch/
sampling codes as applicable).

### 13.4 CSV provenance columns (standards-compatible)

Every mission CSV (summary, timeseries, energy history, events, horizon) repeats
these columns on every data row — no comment lines, no metadata rows that break
CSV parsers: `analysis_fingerprint`, `app_version`, `report_schema`, `site_id`,
`analysis_status`, `data_confidence`, `terrain_kind`, `frame_transform`,
`horizon_scale` (always `LOCAL`), `disclosures` (semicolon-joined codes; values
contain no commas). Timeseries additionally reports the **effective** sampling
step (post-cap), never the requested one.

### 13.5 Energy history — the integrator's own trajectory

`integrateMissionEnergy` records one `EnergyHistoryRow` per **accepted adaptive
quadrature sub-interval boundary** — the exact points where battery state is
stepped, with event-refined transitions, charge/discharge efficiencies, SOC
saturation at 0/cap, and interpolated depletion instants handled inside the
integrator. The CSV is a projection of that recorded history: **no coarse
trapezoid re-integration, no arbitrary interpolation between samples**. Each row
labels its boundary kind (`start` / `quadrature` / `sun-event` / `end`) and
interval bounds; `generated_w` is the interval average (blank on the initial
row — never a fake zero). Rows are sparse where illumination is constant and
dense around events: timestamps between rows were **not computed**, and the
companion JSON states this method explicitly (`energyHistoryMethod`: no
intermediate interpolation). Unit tests reconcile the last row and extrema
against the summary
(`selectedEnergyKWh`, `minBatterySocPct`, `finalBatterySocPct`,
`depletionHours`) — agreement is by construction, not coincidence.

### 13.6 Visibility events at true sub-sample precision

The events CSV exports `SimulationResult.events` at the refined **millisecond**
timestamps (never rounded to the sample grid), with per-body pre/post visibility
state, the transition-refinement resolution, and the same provenance columns as
the samples CSV, so events and samples from one analysis join on
`analysis_fingerprint`.

### 13.7 Comparison exports: explicit resolution states

Comparison CSV/JSON include **every pinned row** with a `resolution_state`:
`VALID`, `SYNTHETIC_DEMO`, `ILLUSTRATIVE`, `COMPUTING`, `BLOCKED` (with the
analysis status), `COMPUTATION_FAILED`, `MISSING_SITE`, or `STALE` (cached key
no longer matches the scenario). Unresolved rows carry **no numbers** — cells
are blank, blank is never zero, and status is never implied by a blank. A
missing site is reported as `MISSING_SITE`, never silently substituted with
another site. The policy (export permitted with explicit states; ranking still
confidence-tiered and never mixes tiers) is stated in the UI next to the export
buttons (`role="note"`).

### 13.8 One guard contract, honest download semantics

All six export kinds (JSON report, summary, timeseries, energy history, events,
horizon) pass the same guard: current-site identity via `simulationKey`,
computation-boundary status (blocked/failed refused), and the epoch gate for
horizon clearances. Success announcements say **"Export initiated — …. Check
your browser's downloads to confirm the file arrived."** — an anchor click
initiates a download; page script cannot observe the save dialog, so nothing
claims "saved". The Playwright suites assert real download events and inspect
the downloaded bytes.

### 13.9 Persisted-session validation (export inputs are validated inputs)

Training sessions persist at schema **v2** and are fully re-validated on load:
config bounds come from `MISSION_LIMITS`/`validateConfig` (the same source as
the settings UI — no duplicated ranges); sites and terrain profiles are
deep-checked (string fields, coordinate ranges, category/kind allowlists,
horizon array length vs resolution, finite elevations, feature counts, eye
height, coverage, frame-metadata consistency). A persisted `frameVerified`
flag is **re-derived** via `classifyFrame`, never trusted. Duplicate site /
scenario ids and dangling references reject the payload. v1 sessions migrate
only through full revalidation; anything invalid is rejected **whole** — never
partially applied — and the app boots to defaults with an explicit notice while
the briefing offers Rebuild / Exit. The unusable payload is then cleared once
(notified, not silent) so it cannot re-trigger on every reload.

**v1.11 size cap:** serialized payloads longer than `MAX_SESSION_LENGTH =
800,000` JavaScript UTF-16 code units are rejected **before** `JSON.parse` and
before storage writes, with a specific `SESSION_TOO_LARGE` notice. This is a
parser-work budget, not a byte cap and not the theoretical structural maximum
(two snapshots × 64 sites × 3,601 elevations can exceed it); an enormous but
structurally valid session is rejected explicitly, never clamped. Save failures
are returned to the caller instead of silently swallowed.


### 13.10 Coarse energy resolution: allow with persistent disclosure (v1.11)

`integrateMissionEnergy` labels the accepted quadrature `converged`, `adequate`
or `coarse` from the Richardson-style relative energy estimate. `coarse` means
the estimated relative error is **≥1%**. The v1.11 policy is to keep the result
available for research and attach `ENERGY_RESOLUTION_COARSE` everywhere energy
is presented or exported, rather than silently blocking export or changing
terrain eligibility/data confidence.

The shared helper `energyResolutionDisclosure()` produces one message naming:
the ≥1% threshold and the observed estimate; that the estimate is **not a
confidence interval**; that energy totals, battery SOC and deficit hours may
shift at this resolution; that shorter windows / alternative configurations and
the quadrature diagnostics should be inspected; that export remains available
with the warning; and that thermal/radiation survival is not modeled.

Propagation is tested end to end at the builder level: JSON `warnings`, the
existing CSV `disclosures` column on all five mission CSVs, comparison CSV/JSON
`warnings`, telemetry and comparison cards (`EnergyResolutionNotice`), and the
timeline screen-reader description. No new CSV column or report field was
added, so `REPORT_SCHEMA_VERSION` remains `2.0.0`. No integration equation or
threshold changed in v1.11.

### 13.11 Data provenance block (v1.12, report schema 2.1.0)

Schema `2.1.0` is **additive**: every `2.0.0` field keeps its name, type and
meaning, so a `2.0.0` reader that ignores unknown keys is unaffected. Two things
were added to the JSON mission report:

- `dataProvenance` (top level):
  - `catalogue` — schema version and date of the source catalogue shipped with
    the build that produced the report.
  - `ephemerisEngine` — the catalogue entry of the engine that produced every
    Sun/Earth direction in the report.
  - `ephemerisVerification` — the independent JPL Horizons reference (§16): which
    ephemeris and site frame it uses, what the bundled recording covers, and
    `coversThisSite`. The note states plainly that **the report itself was not
    checked against Horizons**; the recording covers one site and one window.
  - `terrainSource` — `nature` (`measured-dem`, `synthetic-demo`, `dem`,
    `illustrative`), source file, declared frame, and the acquisition record
    when the DEM was fetched by the application.
  - `displayImagery` — a fixed statement that map imagery is display-only.
- `horizonProfile.sourceProvenance` (optional) — a one-line account of the DEM
  a horizon was derived from, built only from fields the API reported: dataset
  id, product id, source URL, retrieval time, checksum and the resampling
  engine. It is absent when nothing was reported; it is never filled with a
  guess.

`ephemeris.model` was also reworded to describe the engine accurately:
astronomy-engine's analytic models (truncated VSOP87 series and NOVAS C
3.1-derived routines, the Moon from a Montenbruck & Pfleger series after Brown's
lunar theory; upstream design accuracy ±1 arcminute), **not a JPL DE numerical
ephemeris**. The accuracy this project relies on is the measured agreement in
§2 and §16, not the upstream design figure.

No CSV column changed. Analysis fingerprints are unaffected, because the
provenance block describes inputs and is not one.

---

## 14. Native terrain engine (v1.12)

v1.11 read DEMs with Rasterio/GDAL and projected with PyProj/PROJ. v1.12 does
both in Go, inside this repository (`backend/geotiff`, `backend/lunarcrs`,
`backend/terrain`). Replacing two mature libraries is only defensible if the
replacement is narrower, checked against them, and refuses what it does not
handle. This section states what was checked and what the differences are.

### 14.1 The reference

Before the Python backend was removed, `tests/golden/provenance/generate_golden.py`
recorded its behaviour into `tests/golden/`: rasters written by GDAL, the
metadata and pixels GDAL reads back from them, PROJ forward/inverse values,
terrain extractions, horizons, and more than 100 complete API request/response
pairs. Environment of the recording: Python 3.11.2, Rasterio 1.4.4,
**GDAL 3.10.3**, NumPy 2.4.6, PyProj 3.7.2, **PROJ 9.5.1**, Flask 3.1.3. The Go
tests compare against these files; they do not need Python.

### 14.2 What the engine accepts

- **Rasters:** single-band GeoTIFF or BigTIFF, either byte order, strips or
  tiles, uncompressed / LZW / Deflate / PackBits, predictors 1–3, 8–64-bit
  integer or IEEE float samples, GDAL NoData and scale/offset.
- **Coordinate systems, on a sphere only:** geographic, polar stereographic,
  oblique stereographic, azimuthal equidistant, equirectangular; radius within
  1 700–1 800 km; zero reference meridian.
- **Refused, with an explicit error:** multi-band rasters, other compressions
  (JPEG, LERC, ZSTD…), internal mask IFDs, rotated geotransforms for subsetting,
  ellipsoidal or Earth CRSs, any other projection, PDS `.IMG`. v1.11 could open
  some of these through GDAL; v1.12 cannot, and says so. Convert such products
  with GDAL first.

### 14.3 Agreement with GDAL and PROJ

- **Reader.** Sixteen rasters written by GDAL are in the reference set. Ten
  cover the accepted layouts (strips and tiles; uncompressed, LZW and Deflate
  with predictors 1–3; BigTIFF; big-endian; overviews; 16-bit integer to 64-bit
  float; 0–360° and ±180° longitudes) and decode to the metadata,
  georeferencing and pixel values GDAL reports. PackBits is covered by a
  known-vector unit test rather than a GDAL fixture. Five are invalid (multi-band imagery, no CRS, Earth WGS 84, an
  ellipsoidal Moon, a non-zero reference meridian) and are rejected with the
  same message the Python backend gave. One uses a transverse Mercator
  projection, which GDAL accepted and the native engine refuses by design.
- **Projection.** For seven projection definitions (south and north polar
  stereographic, a true-scale-latitude variant, oblique stereographic, two
  equirectangular variants, azimuthal equidistant), forward results match the
  recorded PROJ values to 1e-6 m and inverse results to 1e-9°. Each definition
  is checked at eight points.
- **Extraction.** Terrain grids are produced by bilinear resampling of the
  source raster onto a landing-centred grid. In fourteen recorded cases (ten
  synthetic, four on the real LOLA verification raster) the native grid equals
  GDAL's to within **0.0015 m** at every cell with **identical NoData masks**,
  when GDAL is run with its exact coordinate transformer and the same
  resampling kernel scale. 0.0015 m is not a tuned tolerance: both pipelines
  round to 32-bit floats and the API rounds to 0.001 m.
- **Horizon.** Given the same grid, the Go ray-marcher reproduces the recorded
  horizon elevations within **1e-4°**, with identical coverage and obstacle
  ranges; the TypeScript ray-marcher is held to the Go one by
  `npm run test:parity`.

### 14.4 Where results differ from v1.11, and why

The v1.11 backend used GDAL's *default* warp settings, which approximate the
coordinate transform (linear interpolation between exactly transformed points,
0.125-pixel error threshold) and choose the kernel scale heuristically. The
native engine transforms every output cell exactly. The two therefore differ,
and the difference is **GDAL's own approximation, not a native-engine error**:
the tests assert that the native result never differs from the v1.11 output by
more than GDAL-exact differs from GDAL-default on the same case.

| Case (129 × 129 grid) | Largest cell difference from v1.11 | RMS |
|---|---|---|
| Synthetic rough 20 m DEM, 2–4 km radius (downsampled) | 7.5–7.9 m | 2.0–2.5 m |
| Synthetic rough 20 m DEM, 1 km radius (upsampled) | 4.98 m | 1.19 m |
| Synthetic rough 20 m DEM, 0.5 km radius | 0.001 m | < 0.001 m |
| Synthetic plane | ≤ 0.001 m | < 0.001 m |
| Synthetic global geographic raster (cells away from the seam) | ≤ 0.22 m | ≤ 0.04 m |
| Real LOLA fixture, Malapert, 20 km radius | 2.09 m | 0.82 m |
| Real LOLA fixture, Shackleton 5 km, Nobile 5 km, Connecting Ridge 10 km | ≤ 0.06 m | ≤ 0.02 m |

In every one of these fourteen cases the native grid and the *exact* GDAL grid
agree to 0.0000 m as printed by the test.

Read the table as: a single grid cell of a v1.12 terrain response can differ
from the v1.11 response for the same request by this much, on terrain rough at
the scale of the sampling. The synthetic rough DEM is a worst case built to
exercise the resampler. Horizons derived from the two differ correspondingly;
the mission-level effect has not been separately quantified, and v1.12 results
are not claimed to be numerically identical to v1.11 results on real DEMs. The
real-LOLA rows use the third-party gap-filled verification fixture
(`data/verification/`, not in the repository); those four tests skip, and
report as skipped, where the fixture is absent, as in ordinary CI.

Two differences are deliberate:

- **The 0°/360° seam.** On a global geographic raster the native engine
  interpolates across the seam (the raster is periodic in longitude); GDAL
  clamps to the edge pixel. The native cells there are checked against the
  analytic periodic bilinear value instead.
- **CRS text.** `crs_name` and `crs_wkt` in API responses are generated by the
  project (WKT1), not by PROJ; the numbers they describe are unchanged.

### 14.5 LOLA acquisition

`backend/lola` fetches a regional subset of a NASA PGDA product-90 LOLA mosaic
without downloading the product:

1. Only five product files on one host are allowlisted; the client names a
   product id, never a URL.
2. The server must honour HTTP range requests. If it does not, the acquisition
   stops; there is no full-file fallback.
3. The header is read and validated as a lunar DEM. The pixel window covering
   the requested square plus an interpolation margin is computed; a request
   outside the product, or larger than 16 million pixels, is refused before any
   pixel is read. A dry run returns this plan and the encoded size.
4. Exactly the blocks covering the window are read, within byte and request
   budgets. Every range response must come from the same object as the header
   (same size, same ETag when the server provides one); otherwise the
   acquisition fails rather than stitch two versions together.
5. The subset is written at **native resolution with the source samples, CRS
   keys, NoData and scaling unchanged** — no resampling. The landing elevation
   read from the subset must equal the one read from the source to 1e-6 m.
6. A provenance record is stored with it: product id and URL, pixel window,
   download time, bytes fetched, source size, ETag and Last-Modified when
   available, and the SHA-256 of the subset.

What the application **assumes** about these products and records as an
assumption: heights in metres relative to the 1 737.4 km sphere, frame MOON_ME
(DE421), as described on the PGDA product page. The record says "Not
independently validated; review source product documentation". The frame then
goes through the same allowlist and constant correction as any other DEM (§1).

Live acquisition from NASA PGDA could not be executed in the development
environment (the host is not reachable from it). The workflow is tested against
a loopback server that serves a GDAL-written raster with range support, and
the pixel windows are checked against those the v1.11 Python downloader
computed. See [verification.md](verification.md) for what this does and does
not establish.

---

## 15. Polar Map projection and imagery (v1.12)

### 15.1 Projection

The Polar Map is a south polar stereographic projection on the Moon 2000 sphere
(R = 1 737 400 m), true scale at the pole, central meridian 0°:

    ρ = 2R·tan(colatitude / 2)    X = ρ·sin λ    Y = ρ·cos λ

with +X to the right and +Y up on screen, so **the 0° meridian points up and
90°E points right**. This is also the projection of NASA Moon Trek's
south-polar tile sets and of `IAU2000:30120` as served by the LROC WMS, so one
transform (`src/map/polarProjection.ts`) places the graticule, the site
markers, the lighting overlay and every imagery tile.

### 15.2 Orientation correction

**v1.11 and earlier drew the 0° meridian pointing down.** The bundled LROC WAC
mosaic has 0° up, so every marker, the terminator overlay and the Earth
direction were mirrored north–south relative to the imagery beneath them. Site
coordinates, visibility, power and every exported number were unaffected — the
error was confined to where things were drawn on this one map — but the picture
was wrong, and `public/assets/PROVENANCE.md` documented the wrong orientation.

The bundled image carries no georeferencing, so the orientation is established
from the image itself and kept as an executable test
(`backend/catalog/orientation_test.go`): floors of permanently shadowed craters
are dark in the mosaic. Using published centre coordinates for seven craters
(Haworth, Shoemaker, Faustini, Sverdrup, Slater, Nobile and Amundsen), the
mean brightness sampled at the predicted floor positions is **4.3** (of 255)
under "0° up, 90°E right", against **49.0** under the v1.11 convention and
**23.5** and **37.5** under the two other mirror images. Only one orientation
puts the craters on dark floors.

### 15.3 Imagery layers

| Layer | Source | Use |
|---|---|---|
| LROC WAC south pole mosaic (bundled) | NASA/GSFC/ASU, 400 m/pixel source, shipped as a 1200 × 1200 JPEG | Default; works offline; always drawn underneath |
| LRO LOLA shaded relief, pole to 87.5°S | NASA Moon Trek WMTS | Optional, live |
| LROC WAC polar illumination percentage | NASA Moon Trek WMTS | Optional, live |
| LROC WAC global mosaic | LROC Lunaserv WMS | Optional, live |

Rules that hold for all of them:

- **Imagery is never an analysis input.** Tiles are placed as images by the
  browser. No pixel value is read, and a shaded-relief rendering is never
  converted back into heights. The illumination-percentage layer is a published
  long-term average shown for context; it is not the application's lighting
  model and the two are not compared.
- **The lighting overlay is geometric.** The day/night shading on the map comes
  from the sub-solar point, not from terrain shadows, and is labelled so.
- **Tile placement is computed, not assumed.** Tile matrix origin, tile size
  and scale come from each layer's WMTS capabilities document as recorded in
  the catalogue. In the browser test the rendered tile positions agree with the
  projection of their corner coordinates to within 0.6 pixel.
- **Failure is visible.** A layer that fails to load, or covers only part of the
  view, is reported as such and the bundled mosaic remains.

Real tiles from NASA Moon Trek and the LROC WMS could not be fetched in the
development environment. Registration was tested with synthetic tiles served in
their place; whether the live services respond as their capabilities documents
describe is unverified here.

---

## 16. Independent ephemeris check against JPL Horizons (v1.12)

§2 validates the engine against SPICE for the body-fixed frame and sky
directions. v1.12 adds a second, independent reference that a user can run for
any site and epoch: the NASA/JPL Horizons system.

### 16.1 What is compared

For a surface site, Horizons is asked for the apparent azimuth and elevation of
the Sun and of the Earth, and their range, on a time grid. The engine computes
the same quantities at the same instants. The reported figures are the largest
absolute differences in elevation and azimuth, the largest and RMS **angular
separation** between the two directions, and the largest range difference.
Separation is the primary metric because azimuth is poorly conditioned when a
body is near the zenith and at sites near the pole.

Horizons has no terrain. It can confirm where the Sun and the Earth are in the
sky; it cannot confirm whether a ridge hides them. The check validates the
ephemeris and the frame handling, and nothing about the horizon model.

### 16.2 Conventions, stated because they are where such comparisons go wrong

- **Frame.** Horizons defines lunar surface sites in **MEAN_ME**. CHANDRA sites
  are IAU 2015. The site is converted with the inverse of the constant ME→IAU
  rotation of §1, and Horizons is asked about the converted coordinates.
  Converting the site also rotates local north, so the resulting azimuth offset
  (0.55° at the Shackleton rim site) is removed from the Horizons azimuths
  before differencing. Without this step the comparison would show a spurious
  half-degree azimuth error.
- **Observer.** `coord@301`, geodetic coordinates on the 1 737.4 km sphere
  (on a sphere geodetic latitude is planetocentric latitude), altitude in km.
- **Quantities.** Horizons quantity 4 (apparent azimuth/elevation with
  light-time, stellar aberration and gravitational deflection, **no
  refraction**), 20 (range) and 30 (TDB−UT). The engine applies light-time and
  aberration and no refraction.
- **Time.** Both use UTC instants on a whole-minute grid. The engine's TT−UT
  model and Horizons' TDB−UT differ by about 6.5 s over the recorded window
  (75.6 s vs 69.2 s). At the rate the sky turns for a lunar observer that is
  roughly 0.001° of apparent motion — inside the tolerances, and already
  contained in the measured differences below rather than corrected for.
- **Before comparing**, the response is checked to be the answer to the
  question asked: right body, MEAN_ME frame, Moon centre, no refraction, and
  the echoed site within 1e-5° / 1e-4 km of the requested one. A table that
  fails any check is not compared.

### 16.3 Tolerances

| Verdict | Condition |
|---|---|
| Agrees | separation ≤ 0.02° **and** elevation difference ≤ 0.01° at every sample |
| Review | above that, up to 0.1° separation |
| Disagrees | separation > 0.1° at any sample |

These are the tolerances §2 applies to the SPICE comparison (0.01° in
elevation, 0.02° in azimuth), reused here rather than chosen to fit this
result. For scale: the solar disc is about 0.53° across from the Moon, so 0.02°
is under 4 % of its diameter. They are not a mission requirement, and "agrees"
means "agrees to planning accuracy".

### 16.4 Recorded result

Shackleton rim catalogue site (89.9°S, 0°E, −1.2 km), 42 samples every 12 hours
from 2026-12-01 to 2026-12-21 12:00 UTC, Horizons ephemeris DE441, retrieved
2026-11-14:

| Target | Max Δ elevation | Max Δ azimuth | Max separation | RMS separation | Max Δ range | Verdict |
|---|---|---|---|---|---|---|
| Sun | 0.0013° | 0.0085° | 0.0085° | 0.0065° | 778 km (0.0005 %) | Agrees |
| Earth | 0.0023° | 0.0018° | 0.0025° | 0.0018° | 46 km (0.012 %) | Agrees |

The Earth range difference of tens of kilometres is expected from the engine's
analytic lunar theory and has no effect on direction at this level.

### 16.5 Limits of this evidence

- **One site, one three-week window.** The recorded comparison does not
  establish the same agreement at other sites or epochs; the live check exists
  so that it can be established where it matters.
- **The recording was transcribed.** The development environment could not call
  Horizons from the API code. The responses were retrieved through a separate
  page-fetch tool and transcribed into fixtures, which can normalise whitespace.
  The numerical values are those Horizons returned; the files are not
  byte-exact copies of its responses and are not described as such.
- **The live path has not been run against Horizons from this codebase.** The
  request construction and the parser are tested against the transcribed
  responses and a loopback server. The first real call will be made by a
  deployment or a developer machine with network access.
- **Not a certification.** Horizons agreement shows that two independent
  implementations give the same sky geometry. It does not make this tool flight
  software.

---

## 17. Source catalogue rules (v1.12)

The Data Hub lists every dataset, service and reference the application uses or
links to (`backend/catalog/catalogue.json`: 20 sources and 10 Canadian Space
Agency references). The rules for what may be written there are part of the
method, because a provenance record is only useful if its blanks are honest.

- **Unknown is recorded as unknown.** A field is `null`, shown as *Not
  confirmed*, unless its value was read from the provider's own page, product
  label or service metadata on the retrieval date. No field is filled from
  memory or inferred from a file name without saying so (entries that derive a
  value from a product identifier state "from the identifier").
- **Each entry says what kind of thing it is.** `data_kind` distinguishes
  imagery, elevation, ephemeris and reference material; `availability`
  distinguishes bundled, fetched live by the browser, fetched by the API, and
  link-only. An entry that is link-only has no "use" action.
- **Each entry says how it was checked** (`verification`), including when a
  service could be described from its metadata but not exercised.
- **Canadian Space Agency material is mission reference only.** It appears in
  its own tab with no data actions. CSA analogue-site or rover datasets are
  never offered as lunar terrain, and nothing in the application reads them.
- **The catalogue is a dated snapshot** (2026-11-14). Providers change URLs,
  versions and terms; the retrieval date on each entry is the date to which its
  contents can be trusted.

