# CHANDRA v1.10 — Scientific Export, Reproducibility & Data Integrity

Status: **IN PROGRESS** — this report is written as work executes. Only executed
verification is recorded as passed; planned items are labeled planned.

Branch: `arena/73a0c053-clps-lunar-mission` (session-pinned; the requested name
`feat/v1.10-scientific-exports` cannot be used in this environment — Arena fixes
the branch name). Base: `main` @ `e5d6114` (v1.9.0, post-merge CI run 42392775720 green).

## Phase 0 — baseline audit (executed 2026-11-07)

Read: `export.ts`, `exportGuard.ts`, `integration.ts`, `powerComms.ts`,
`simulation.ts`, `configLimits.ts`, `session.ts`, `witnesses.ts`, `narrative.ts`,
`App.tsx`, `ComparisonMatrix.tsx`, `SiteBrief.tsx`, `useSimulation.ts`,
`simulationClient.ts`, `simulation.worker.ts`, `analysisStatus.ts`, `a11y.ts`,
`missionProfile.ts`, `lunarFrame.ts`, `progress.ts`, mission types, v1.7–v1.9
reports, SCIENTIFIC_METHOD, VERIFICATION, CI workflow.

Confirmed gaps (the v1.10 work list):

1. **JSON report** — `schemaVersion: '1.7.0-product'` conflates app/report
   versions; no app version, no analysis fingerprint; top-level `config` and
   `powerAssumptions`/`batteryAssumptions` quote the REQUESTED config, not the
   engine-sanitized `SimulationResult.config`; generic "Verify frame alignment"
   wording even for verified+rotated DEMs; provenance lacks site identity,
   coordinates, validated epoch range, applied-transform disclosure.
2. **Timeseries CSV** — instantaneous geometry/power only. The event-aware
   integrator (`integrateMissionEnergy`) computes battery SOC on every accepted
   adaptive-Simpson sub-interval but DISCARDS the trajectory; only min/final SOC,
   depletion hours survive. No events export at all (refined sub-sample
   timestamps exist in `SimulationResult.events` but never leave the app).
   No CSV carries provenance.
3. **Comparison export** — unresolved rows emit blank status/score cells;
   JSON rows carry only `{scenario, site, summary:null}`; no resolution state,
   no failure reason, no warnings, no provenance; a missing site silently
   substitutes `sites[0]`; export reads the cache directly (a cached BLOCKED
   result would emit its name with blank numbers and empty status).
4. **Export guard** — checks site id + window, but not the effective config or
   terrain identity; a result computed for different parameters could pass if
   site/window matched. `simulationKey()` already encodes full identity and is
   the hook/cache source of truth — the guard should reuse it.
5. **Session validation** — `validConfig` allows duration ≤366 d / step ≤1440 min
   vs `MISSION_LIMITS` 90 d / 240 min; other numerics only finite-checked.
   `validSite` does not check terrain label, array length vs resolution,
   elevation bounds, feature count, frame-metadata consistency, optional-field
   types; no duplicate-ID checks; `frameVerified:true` is trusted even with
   inconsistent metadata. No migration path (unknown version → null → recovery).
6. **Download semantics** — `download()` dispatches an anchor click; page script
   cannot observe the browser's save dialog. Docs/code call this "download
   completed" in places; must say "download initiated / dispatch succeeded".

Verified strengths to PRESERVE (not rebuild): event-partitioned adaptive Simpson
integration with battery on the accepted sub-intervals; refined transition
events with diagnostics; computation-boundary analysis gate; confidence-tiered
ranking; guard-gated exports; isolated training session with exact restore;
LOCAL HORIZON disclosures; heuristic-score/LOS-not-RF/energy-not-thermal wording.

## Design decisions

- **Report schema version** `REPORT_SCHEMA_VERSION = '2.0.0'` independent of app
  version (`APP_VERSION` from package.json). Schema bumped because the format
  changes (new metadata block, effective-config placement, energy history);
  future app releases do NOT bump it unless the format changes.
- **Analysis fingerprint** = SHA-256 (Web Crypto, async) over the existing
  `simulationKey()` string — one source of truth, no second incompatible
  fingerprint. The guard compares `simulationKey` strings directly (sync);
  exports await the digest. Truncated 16-hex display form in CSV columns;
  full digest in JSON.
- **Energy history**: the integrator records one row per accepted quadrature
  sub-interval boundary (the exact points where battery state is stepped) —
  no interpolation, no re-simulation. Rows carry UTC, interval bounds, lit
  state, avg generated W (interval integral / duration), load W, net kWh,
  cumulative generated/consumed kWh, battery kWh + SOC, charge/discharge/
  saturated/depleted state, and event-boundary flags. Reconciles by
  construction with `summary.selectedEnergyKWh`, `minBatterySocPct`,
  `finalBatterySocPct`, `depletionHours` (unit-tested).
- **Events CSV**: refined `SimulationResult.events` at full millisecond
  precision + per-body pre/post state + transition-refinement resolution +
  analysis status. Never rounded to the sample grid.
- **CSV provenance**: compact repeated columns on every data row
  (`analysis_fingerprint`, `app_version`, `report_schema`, `site_id`,
  `analysis_status`, `data_confidence`, `terrain_kind`, `frame_transform`,
  `horizon_scale`) — standards-compatible (no comment rows), survives a CSV
  being separated from its JSON. Documented in SCIENTIFIC_METHOD.
- **Comparison exports**: permitted with explicit per-row
  `resolution_state` (VALID / SYNTHETIC_DEMO / ILLUSTRATIVE / COMPUTING /
  BLOCKED:<status> / COMPUTATION_FAILED / MISSING_SITE) — never blank status,
  never zero-filled numbers. UI states the choice next to the export buttons.
- **Session validation**: reuse `MISSION_LIMITS` + `validateConfig()`; deep
  `TerrainProfile` validation incl. frame-metadata consistency via
  `classifyFrame` (a persisted `frameVerified` flag is re-derived, never
  trusted); duplicate/dangling checks; v1 → v2 migration revalidates payloads
  (safe: same shape, stricter rules); invalid payloads follow the existing
  Rebuild/Exit recovery — never partial application.

(Sections below are appended as phases execute.)
