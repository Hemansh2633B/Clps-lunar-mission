# CHANDRA v1.9 — Implementation Report

**CI Recovery, Tutorial Integrity & Scientific Reliability**
Date: 2026-11-07 · Branch: `arena/860e2f06-clps-lunar-mission` (from merged v1.8
`main` @ `03c3522`) · Version: **1.9.0** · PR against `main` (not self-merged).

---

## 1. The CI failure: diagnosis before modification (Phase 0–1)

**Observed state.** Post-merge run **42379651272** (push, `03c3522`): `quality` ✓,
`spice-validation` ✓, `browser` ✗ at step 10 "Run story tutorial E2E (personas A–E)"
(job 128424372732). Personas A–C passed; Persona D timed out waiting for
`.terrain-lab [role="alert"]` (story-browser-test.mjs:393 in v1.8); E never ran.
Raw log download is egress-blocked in this sandbox; job/step metadata came from
`api.github.com`, and the failure was then **reproduced experimentally**:

| Probe (instrumented second-visit flow) | mode at Compute click | mocked `/api/horizon` calls | import alert |
|---|---|---|---|
| `/api/terrain` delayed 1500 ms (forces CI interleaving) | `synthetic` | **0** | **0** → timeout |
| no delay (sandbox's lucky interleaving) | `real` | 1 | 1 (FRAME UNVERIFIED) |

**Root cause.** A fresh Terrain Lab mount always builds an illustrative synthetic
model first; `dem_ready: true` then triggers an asynchronous auto-real build. The
v1.8 test clicked "Compute 360° horizon" as soon as the button enabled — on the CI
runner the click beat the real build, so the horizon was computed **locally from
the synthetic grid**, the mocked unknown-frame endpoint was never called, no alert
could appear, and the delayed real build then cleared the horizon. A test-setup
race, not a timeout to extend.

**Fix (commit `23c4117`).** Both Terrain Lab visits now execute the explicit
workflow: wait for backend config → select **Real lunar DEM** in `#terrain-mode` →
**Build terrain** → wait until the loaded model is identified as real
(`__CHANDRA_TERRAIN__.mode === 'real'` + fixture filename + Real DEM chip) → compute
→ **assert the mocked horizon endpoint was actually called** → assert the named
unknown frame, the actionable warning, and the disabled import. No timeout was
extended, no assertion removed, no synthetic fallback, no UI-only warning.
**Verified on the real runner: run 42383009327, all steps green**, before any other
change was layered on. Persona E executes (and passes) again.

## 2. Tutorial integrity (Phase 2)

- **Pure witnesses** (`src/tutorial/witnesses.ts`): scenario fingerprint =
  site + start + full config (key-order stable). Ch7 met ⇔ training session active
  ∧ compare view open ∧ ≥2 pairwise-distinct **session-created** scenarios resolved
  to demo-eligible analyses. User pins excluded by isolation **and** by snapshot-ID
  filter; identical repeats dedupe; cap-rejected pins never enter state; computing/
  blocked rows never count. Chapter-start scenario IDs recorded as an audit baseline
  (journey pins stay valid across refresh). Ch8 met ⇔ a `kind==='json'` export passed
  the pure gate **and** the download completed (`creditsMissionReport`); CSV never
  credits. 15 unit tests cover existing/identical/distinct/capacity/blocked/
  computing/exit cases.
- **Export gate** (`src/utils/exportGuard.ts`): one decision point for all exports —
  computing / error / missing / blocked / **stale** (site or window mismatch) refuse;
  horizon clearance CSVs also refuse at unvalidated epochs. `handleExport` wraps the
  download in try/catch; only success credits. Page-script cannot observe the user
  cancelling the browser's save dialog — disclosed; E2E verifies real download
  events **and the downloaded JSON's provenance + warnings**.
- **Typed persisted session** (`src/tutorial/session.ts`,
  `chandra-story-session-v1`): full `WorkspaceSnapshot` (selectedId, baselineMs,
  slipDays, config, viewDays, timeMs, mode, compare/terrain/space view, scenarios,
  playing, speed, customSites) for **user and training** workspaces + the chapter
  witness baseline. Strict validation (finite numbers, enum modes, config shape,
  scenario/site referential integrity, caps) — corrupt/foreign payloads parse to
  null, never throw, never half-apply. Debounced writes + synchronous `pagehide`
  flush. Boot resolution: valid session + in-training progress → restore training
  exactly (panel closed, launcher offers Resume); orphaned session → restore the
  **user** workspace; lost context (corrupt, cleared, or any v1.8 save) → explicit
  **Rebuild / Exit** recovery card, never silent defaults. v1.8 progress key
  (`chandra-story-v1`) unchanged and backward-compatible.
- **Isolation & playback:** training start snapshots the user workspace, loads a
  clean mission (no user pins/sites), pauses playback; **exit and completion**
  restore everything exactly (persona A asserts site, slip, preset, 3 pins,
  playback). Pause keeps training loaded. Stale `active` status normalized to
  `paused` on mount so Resume is offered honestly.

## 3. Accessibility gates (Phase 3) + focused audit (Phase 6)

`src/utils/a11y.ts` (pure, unit-tested): panorama description reports **sky
positions only** when blocked (no visibility/clearance claims); DEM footer quotes
the `AnalysisAssessment` verbatim when blocked, otherwise states allowlist
verification + constant-rotation residual + coverage + LOCAL scope; timeline
description names blocked statuses; polar-map vector goes azimuth-only (neutral
brass + disclosure); horizon table withholds clearance columns and disables CSV at
blocked epochs. Audit also found and fixed: **ticker intercepting Export-dropdown
clicks** (pointer-events + header stacking), `--dim` small text below AA
(4.32/3.65 → **5.65/4.76**), Terrain Lab alert 4.19 → **5.23**. Persona E measures
rendered contrast at runtime (≥4.5), exercises keyboard-only activation, heading
focus, modal trap + restore, Escape pause/resume, reduced motion, 390/320 px
layouts. `docs/ACCESSIBILITY_AUDIT.md` records everything, including the
**unexecuted** NVDA/VoiceOver checklist — no screen-reader pass is claimed.

## 4. Comparison narrative (Phase 4)

App requests/releases each pinned scenario's simulation (refcounted alongside the
matrix) and feeds resolved outcomes to `comparisonNarrative`: guidance → computing
→ blocked/failed (gate's own reason/resolution, **no deltas**) → valid pair (actual
setting differences + computed illumination/DTE/combined/longest-gap/energy/min-SOC
deltas). Mixed confidence tiers are **never rankable**; the matrix remains the
source of truth. 8 dedicated unit tests + persona A browser assertions.

## 5. Scientific reliability research (Phase 5)

`docs/FEASIBILITY_TERRAIN_FRAMES_v1.9.md`: authoritative PGDA LOLA product metadata
(COG, polar stereographic meters, MOON_ME/DE421, 20 m/pixel effective-resolution
caveats, NoData, DOIs) and the NAIF per-epoch method (`PXFORM`, frames
31000/31001/31006/31007, binary-PCK coverage gating), each with an acceptance plan.
**Neither is implemented**: data hosts are outside this environment's egress
allowlist and safe validation was not possible — so **LOCAL HORIZON** and the
**constant correction + 2020–2035 gate** remain, exactly as disclosed. All v1.8
distinctions preserved: LOS ≠ RF, energy ≠ thermal, local ≠ regional,
illustrative ≠ measured, heuristic score ≠ NASA methodology.

## 6. CI governance (Phase 7)

Actions SHA-pinned (verified 2026-11-07): checkout **v7.0.1**, setup-node **v7.1.0**,
setup-python **v7.1.0**, upload-artifact **v7.0.2**. SPICE validation now runs on
PRs too (fails rather than skips; quality job still prints "SKIPPED ≠ passed").
Browser job uploads screenshots always and the dev-server log on failure.
`docs/CI_GOVERNANCE.md` lists the three exact required check names; `main` is
`protected:false` and the protection API returns 403 for this integration —
**no claim that protection is enabled**; owner instructions included.

## 7. Executed commands (this release)

All in `final draft 1/` unless noted; results in `docs/VERIFICATION.md`:

```
npm install                                   # env rebuild (node_modules absent)
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
npm run dev:full                              # background :5173/:8000
node scripts/repro-persona-d.mjs              # Phase-0 probe (deleted after evidence)
npx tsc --noEmit                              # clean (run after every edit batch)
npm run build                                 # clean
npm test                                      # 244 passed / 25 files
.venv/bin/python -m pytest -q -rs             # 92 passed, 4 SKIPPED (kernels absent)
npm run test:geometry                         # passed
npm run test:parity                           # passed
npm run test:browser                          # passed
npm run test:story                            # v1.9 personas A–E passed (~600 s)
npm version 1.9.0 --no-git-tag-version
gh run view/list (API)                        # CI: 42379651272 ✗ → 42383009327 ✓ → 42389036663 ✓ → 42389576252 ✓ → PR#5 42391771892 ✓ (all 3 jobs incl. SPICE-on-PR)
gh api repos/.../releases/latest + commits    # action pin verification
gh api repos/.../branches/main[/protection]   # protected:false; protection API 403
```

**Skips / not run (reported honestly):** 4 kernel-gated pytest tests skipped
locally (executed for real in the CI SPICE job); `test:real-dem` not run (fixture
TIF absent); manual NVDA/VoiceOver checklist not executed; raw CI log download
blocked (metadata + local reproduction used instead).

## 8. Commits

1. `23c4117` — Phase-1 Persona D fix (explicit Real-DEM workflow + API-call asserts)
2. `3ff13ef` — witnesses, isolated persisted session, export gate, a11y gates,
   comparison narrative + 52 unit tests
3. `ccfd8cf` — v1.9 personas A–E + real UI fixes the audit surfaced
4. `12f4556` — measured contrast fixes, accessibility audit, feasibility research,
   CI governance (SHA pins, SPICE-on-PR, failure logs)
5. `8d777fc` — README/SCIENTIFIC_METHOD/VERIFICATION corrections + this report,
   version 1.9.0
6. (evidence commit) — PR #5 run 42391771892 recorded: all three required checks
   green on the final tree, including the SPICE validation executing for real on
   the pull request (kernels fetched + presence asserted + frame tests run).

**Pull request:** [#5](https://github.com/Hemansh2633B/Clps-lunar-mission/pull/5)
against `main` — intentionally **not self-merged**; the owner merges after review.

## 9. Limitations carried forward (unchanged, disclosed)

LOCAL horizon only (no regional distant-horizon model); constant frame correction
gated to 2020–2035 (no silent extrapolation); presets illustrative, never NASA
vehicle specs; geometric LOS is not an RF link budget; energy balance is not
thermal/survival; the feasibility score is an application-defined heuristic;
region centers are not surveyed landing points; browser-download cancellation is
not observable from page script; no screen-reader pass claimed; branch protection
not enabled (owner action, exact check names documented).
