# CHANDRA v1.13 Phase 0 audit

**Repository:** Hemansh2633B/Clps-lunar-mission  
**Base:** main  
**Branch:** feat/challenge-upgrade-v1.13  
**Date:** 2026-11-22

**Method and limits:** Selected source and documentation files were inspected through the GitHub file API and code-search excerpts. This environment has no local checkout, shell, browser, package manager, Go toolchain, Playwright, axe or Vercel CLI. The application was not run. Runtime-dependent checks are marked NOT RUN / NOT VERIFIED; no test or provider result is claimed.

## Findings

| Finding | Evidence (file:line or inspected source) | Severity | Action |
|---|---|---:|---|
| README still advertises battery/SOC and battery evaluation in the feature list and workflow. | README.md, “What it does” and “Typical Project Workflow”; src/engine/configLimits.ts:27-28 | P0 | Remove the model end-to-end in W1; do not just hide the UI. |
| Battery inputs remain in mission configuration and numeric limits. | src/engine/simulation.ts DEFAULT_CONFIG; src/engine/configLimits.ts:27-28; src/types/mission.ts:306+; src/components/Modals.tsx fields found by GitHub search | P0 | Remove config, UI, sanitization, session identity, worker inputs, tests and exports together. |
| Battery simulation is active and applies 0.92 charge / 0.95 discharge efficiency and SOC depletion tracking. | src/engine/powerComms.ts:63-100; src/engine/integration.ts documents coupled battery stepping | P0 | Separate revertable battery-removal commit. Preserve generation-only integration only if tests prove independence. |
| Feasibility score remains implemented and exported. | src/types/mission.ts:75-82; src/engine/powerComms.ts:329+; src/utils/export.ts scoreMethodology and feasibility_score; src/components/TelemetryPanel.tsx | P1 | W5 must replace it throughout UI, comparison, types and exports. |
| Finite apparent Sun/Earth radii are computed from physical radius and range; disk overlap is computed against the spherical lunar limb. | src/engine/occultation.ts:101-149; src/engine/simulation.ts | P0 | Preserve the distinction in docs. |
| Local terrain visibility still uses target-centre clearance. Partial disk occultation is against the lunar limb, not a terrain-relative partial-disk fraction. | src/engine/horizonPhysics.ts visibilityFor; src/engine/simulation.ts evaluateAt; docs/scientific-method.md §18.2–18.3 | P0 | W3 is required by the audit gate. Add terrain-relative disk illumination only with analytic tests and explicit legacy mode. |
| Sun/Earth angular radii are distance-derived, not fixed constants. | src/engine/occultation.ts:101-104 | P0 | W3 should reuse instantaneous distances/radii. |
| The inspected illustrative horizon builder creates 1° profiles from feature lobes and deterministic sinusoidal terms. It is not a measured LOLA mask. | src/engine/horizonPhysics.ts buildTerrainProfile; src/types/mission.ts TerrainProfile | P0 | W2 may promote only real LOLA-derived masks with full provenance. Catalogue call sites still need a complete tree audit. |
| TerrainProfile contains eyeHeightM; illustrative builder defaults to 2 m. | src/engine/horizonPhysics.ts buildTerrainProfile; src/types/mission.ts TerrainProfile | P1 | Trace DEM ray-march height, configurability, canonical identity and exports before changing it. |
| Refined transition events already exist for Sun, Earth and combined visibility. | src/engine/horizonPhysics.ts findTransitions; src/engine/simulation.ts; src/types/mission.ts TransitionEvent | P0 | W4 should reuse these events rather than duplicate transition math. |
| Existing fallback search finds Sun crossings only, using a 2-hour step and default 35-day horizon. | src/engine/horizonPhysics.ts:361+ findNextSunCrossings | P0 | W4 requires a worker-backed joint Sun/Earth finder with explicit cap, progress and cancellation. |
| Transition detector uses a 15-second floor and 256-node adaptive budget per coarse interval. Exhaustion triggers a fine scan capped at 20,000 steps; otherwise unresolved intervals are reported. | src/engine/horizonPhysics.ts:173-175 and detectBodyTransitions | P0 | Disclose the effective minimum event width; test unresolved and sub-floor cases. |
| Mission duration is 1–90 days; telemetry sample count is capped at 20,000 and uniformly coarsened. | src/engine/configLimits.ts:21; src/engine/simulation.ts:94+ | P1 | Keep the W4 search horizon separately bounded; do not assume mission duration is the search cap. |
| ME/PA frame corrections are allowlisted and valid only 2020-01-01 through 2035-12-31 UTC. Unknown frames are blocked. | src/engine/lunarFrame.ts:22-29, 89-101; docs/verification.md | P0 | Preserve allowlist and date gate unchanged. |
| “Local horizon only” is inaccurate for the current engine: effective visibility includes local terrain and a spherical-limb floor; disk overlap is separately tested against the limb. | src/engine/horizonPhysics.ts visibilityFor; src/engine/simulation.ts evaluateAt; src/engine/occultation.ts; docs/scientific-method.md §18.2–18.4 | P0 | W1 must reconcile README and design docs. Earth LOS remains geometric, not an RF link budget. |
| UTC is documented and onboarding says UTC; Astronomy Engine receives JavaScript Date values. No independent ΔT implementation was identified in inspected files. | docs/scientific-method.md §18.1; src/components/Onboarding.tsx step 2; src/engine/ephemeris.ts | P1 | Exact UT1/ΔT residual and every UI/export time label are NOT VERIFIED. Do not claim a 0.001° residual without a controlled comparison. |
| Current app version is 1.12.0 and report schema is 2.1.0. | package.json; src/version.ts | P0 | Battery export removal requires a schema bump and migration note. |
| Tutorial exists as a 14-day briefing; onboarding text still references battery. | docs/architecture/overview.md; src/components/Onboarding.tsx step 4. Guessed src/tutorial/chapters.ts path does not exist. | P1 | Keep tutorial structure/artwork; find the real chapter source and edit only obsolete battery-dependent copy/assertions. |
| Sampled search did not confirm a Starship/HLS/hangar implementation; this does not prove absence. | GitHub code search for Starship HLS CLPS hangar vehicle rocket returned no results. | P1 | Run full recursive grep locally before deleting anything. |
| Repository metadata reports size 80,580 KB. Git directory size and tracked files over 500 KB cannot be measured through the available API. | GitHub repository metadata | P2 | Local owner action: measure .git and tracked assets; inspect image optimization candidates. |
| Root LICENSE presence has not been established. | README advertises MIT; root listing not available through the current inspection path. | P2 | Verify root listing before drafting a license. |
| Dependency audit, Go vet/vulncheck, bundle analysis, axe, four viewport screenshots, error-path checks, CI job names, test:layout wiring, Vercel build and static sub-path hosting were not run or fully inspected. | No shell/browser/build tooling in this environment. | P1 | Mark NOT RUN in verification until executed in CI/local checkout. |
| Existing verification evidence is historical v1.12 and says live NASA/JPL/LROC services were unreachable in that run. | docs/verification.md, v1.12.0 section | P0 | Do not carry historical PASS results forward as v1.13 execution. |
| Product-design document still depicts battery in its explainer and method strip. | docs/product-design.md §2.2, §2.3, §2.5 | P1 | Edit only stale battery claims; retain the existing tutorial. |
| README does not describe the requested joint Sun/Earth next-window finder or dedicated countdown. | README feature list; src/engine/horizonPhysics.ts only has next-Sun fallback | P0 | W4 is new engine functionality, not merely UI wiring. |

## Answers to Phase 0 science questions

1. **Disk treatment:** finite apparent angular radii and lunar-limb disk overlap exist. Terrain visibility remains centre-ray clearance; no terrain-relative partial-disk fraction was found in the inspected path. W3 is audit-triggered.
2. **Observer height:** illustrative profile default is 2 m. Full DEM ray-march configuration and export/key propagation are not fully traced.
3. **Illustrative masks:** the inspected builder is procedural: 1° azimuth samples, feature lobes and deterministic sinusoidal variation; metadata includes kind, uncertainty and eyeHeightM. Per-site construction call sites remain to be enumerated.
4. **Transitions:** findTransitions returns refined Sun, Earth and combined events; simulation consumes them. A Sun-only next-crossing fallback also exists.
5. **Next-window search:** no joint Sun+Earth finder was found in the inspected engine. Existing Sun fallback is 2-hour step / 35-day default horizon.
6. **Event width:** telemetry is 1–240 minutes (default 15), capped at 20,000 samples. Transition refinement floor is 15 seconds; adaptive budget is 256 nodes per coarse interval with a 20,000-step fallback cap. Sub-floor windows are not guaranteed detectable.
7. **UTC / TT / UT1:** JS UTC milliseconds are passed as Date values to Astronomy Engine; no separate ΔT correction was found in inspected code. Exact UT1 treatment/residual and UI-wide UTC labelling are NOT VERIFIED.
8. **Limits / frames:** mission duration 1–90 days, sample cap 20,000; ME/PA correction interval 2020-01-01 through 2035-12-31 UTC. Unknown frames and out-of-range corrected epochs are blocked.
9. **Lunar limb:** body occultation is in the main evaluation path, not only a far-side upgrade. Effective local visibility uses max(terrain horizon, spherical limb). Disk overlap is a separate lunar-limb calculation. “Local horizon only” is not accurate.

## Scope-trim status

- Battery model: confirmed present in engine, config, types, onboarding, integration, exports and tests; not removed.
- Vehicle/hangar model: no positive implementation hit confirmed by sampled search; absence is not established.
- Tutorial: present and must be retained. Actual chapter source path and battery-dependent assertions remain to be found.
- Measured masks: no per-site bundled measured-mask evidence confirmed in the inspected frontend files. The inspected builder is explicitly illustrative.

## Workstream re-scope

- **W1:** remove battery throughout the stack. Do not delete the integrator blindly; first preserve generation-only energy totals and numerical disclosure if useful. Export schema bump is mandatory.
- **W2:** live PGDA masks cannot be honestly generated here. Do not fabricate masks. Tooling and fixture tests require further inspection of Go terrain/LOLA interfaces.
- **W3:** required. Existing finite-disk lunar-limb occultation does not implement partial-disk illumination above local terrain.
- **W4:** new joint worker search; reuse refined transition data. Existing Sun-only fallback is insufficient.
- **W5:** remove old score across every surface and export; verdicts must remain blocked where source tiers are blocked.
- **W6–W7:** independent frontend work, but runtime verification unavailable here.
- **W8:** byte-exact live Horizons evidence cannot be created without provider access; no synthetic fixtures.
- **W9–W11:** documentation edits are possible, but screenshots, bundle metrics, a11y results, CI outcomes and Vercel build claims require execution.

## Verification state

| Check | Status | Reason |
|---|---|---|
| Repository access and feature branch creation | PASS | GitHub permissions report push/admin; requested branch created. |
| Source/document inspection | PARTIAL | Selected files fetched; no full tree/local checkout. |
| Application run | NOT RUN | No browser/runtime access. |
| npm, Go and Python tests | NOT RUN | No repository shell/toolchain. |
| Live NASA PGDA / JPL Horizons requests | NOT RUN | No provider request made. |
| axe, responsive screenshots and bundle measurement | NOT RUN | No browser/build tooling. |

**Conclusion:** the largest confirmed P0 mismatch is that battery behavior remains deeply wired through configuration, engine, integration, tests and exports. The second is that finite-disk occultation by the lunar body exists, but terrain-relative partial-disk illumination does not. These findings drive W1 and W3; neither is already complete.
