# CI Governance — CHANDRA v1.9

**Date:** 2026-11-07. This document records the exact CI contract, the verified
action pins, and what the repository owner must configure. Claims here are
limited to what was actually verified via the GitHub API on the date above.

## 1. Required checks (owner action needed)

The workflow `.github/workflows/ci.yml` produces three jobs. For `main`, the
owner should require **all three** by their exact check names:

1. `Typecheck · build · unit · geometry · parity · Python`
2. `Browser E2E (mission · terrain · space · onboarding)` — includes the story
   tutorial personas A–E as a mandatory step (a story failure fails the job).
3. `Independent SPICE validation (fetched kernels)` — v1.9 runs this on every
   pull request as well as pushes to `main` and manual dispatch.

**Branch-protection status (verified 2026-11-07):**
- `GET /repos/Hemansh2633B/Clps-lunar-mission/branches/main` reports
  `protected: false`.
- The branch-protection API returns **403 "Resource not accessible by
  integration"** for this environment's token, so protection can be neither
  enabled nor read in detail from here. **No claim is made that protection is
  enabled.** The owner must enable it manually:
  Settings → Branches → Add rule for `main` → "Require status checks to pass
  before merging" → add the three exact names above (they appear in the picker
  after the first PR run) → optionally "Require branches to be up to date".

## 2. Action pins (verified via `releases/latest` + commit API, 2026-11-07)

All actions are pinned to full commit SHAs with the version as a comment:

| Action | Version | SHA |
|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `actions/setup-python` | v7.1.0 | `6d4fd22b20465ccc0f7354476588e8df7c9ca0e0` |
| `actions/upload-artifact` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |

These replace the deprecated floating `@v4`/`@v5` majors used through v1.8.
To update: re-query `repos/<action>/releases/latest`, resolve the tag to a
commit SHA, update both the SHA and the comment, and let CI prove the change.

## 3. Honesty rules (enforced by the workflow itself)

- **No unavailable NASA downloads.** Ordinary CI never fetches DEMs or kernels
  from NASA hosts. The DEM API runs without a configured DEM so the real-mode
  no-DEM safeguard is exercised; story persona tests mock DEM responses at the
  network boundary only.
- **Skipped ≠ passed.** The `quality` job runs pytest with `-rs` and prints an
  explicit "Independent SPICE validation: SKIPPED in this job" notice when
  kernels are absent. The separate `spice-validation` job fetches checksummed
  kernels from public GitHub mirrors and **fails** (asserts kernel presence)
  rather than silently skipping; its 26 frame tests then run for real.
- **Failure evidence.** The browser job uploads `browser-screenshots` on every
  run (`if: always()`) and `devfull-log` (the dev-server/API log) on failure
  (`if: failure()`), so a red run is diagnosable without re-running.

## 4. The v1.8 CI failure and its resolution (historical record)

- Post-merge run **42379651272** (push, `03c3522`, 2026-11-07): `quality` ✓,
  `spice-validation` ✓, `browser` ✗ — failed at step "Run story tutorial E2E
  (personas A–E)", job 128424372732. Personas A–C passed; Persona D timed out
  waiting for `.terrain-lab [role="alert"]`; Persona E never ran.
- **Root cause (reproduced experimentally):** a fresh Terrain Lab mount builds
  an illustrative synthetic model first; the v1.8 test relied on the
  config-triggered auto-real build winning a race before "Compute 360° horizon"
  was clicked. On CI the compute ran against the synthetic grid, the mocked
  `/api/horizon` (unknown frame) was never called, and no import alert could
  appear. A delayed-API reproduction confirmed: mode `synthetic` at click,
  0 horizon API calls, 0 alerts; fast-API: mode `real`, 1 call, alert present.
- **Fix (commit `23c4117`):** both Terrain Lab visits select "Real lunar DEM"
  explicitly, build, wait for the model to be identified as real, and assert
  the mocked horizon endpoint was actually exercised. Verified green on real
  CI run **42383009327** (step 10 "Run story tutorial E2E (personas A–E)":
  success) before any further changes were layered on.

## 5. Local suite contract

Every release run executes, in `final draft 1/`:

```
npm run typecheck && npm run build
npm test                  # vitest unit suite
npm run test:python       # pytest -q -rs (kernel-gated tests skip without kernels)
npm run test:geometry
npm run test:parity
npm run test:browser      # needs npm run dev:full on :5173/:8000
npm run test:story        # personas A–E, same servers
```

Skips are reported as skips in VERIFICATION.md, never as passes.
