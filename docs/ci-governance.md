# CI governance · CHANDRA

**Last verified:** 2026-11-08 (rebrand); v1.11 metadata re-read in §7. This document records the CI contract, the
verified action pins, and what the repository owner must configure. Claims
here are limited to what was actually verified via the GitHub API.

## 1. Required checks (owner action needed)

The workflow `.github/workflows/ci.yml` produces three jobs. For `main`, the
owner should require **all three** by their exact check names:

1. `Typecheck · build · unit · geometry · parity · Python`
2. `Browser E2E (mission · terrain · space · onboarding)` — includes the story
   tutorial personas A–E **and the v1.11 scientific-export personas A–E** as
   mandatory steps (any suite failing fails the job).
3. `Independent SPICE validation (fetched kernels)` — v1.9 runs this on every
   pull request as well as pushes to `main` and manual dispatch.

**Branch-protection status (verified 2026-11-07; re-checked for v1.10 and
v1.11 — still `protected: false`, still owner action outstanding):**
- `GET /repos/Hemansh2633B/Clps-lunar-mission/branches/main` reports
  `protected: false` (v1.11 re-read; the rename has not happened).
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

Every release run executes, in the repository root:

```
npm run typecheck && npm run build
npm test                  # vitest unit suite
npm run test:python       # pytest -q -rs (kernel-gated tests skip without kernels)
npm run test:geometry
npm run test:parity
npm run test:browser      # needs npm run dev:full on :5173/:8000
npm run test:story        # personas A–E, same servers
npm run test:exports      # export personas A–E, same servers
```

Skips are reported as skips in docs/verification.md, never as passes.

Optional, not required checks and not part of every release battery:

```
npm run bench:identity    # canonical-key sanity benchmark, no CI threshold
npm run test:real-dem     # needs the fetched verification fixture + backend :8001
```

`.github/workflows/real-dem-fixture.yml` is a **workflow_dispatch-only** optional
smoke job. It fetches the third-party gap-filled downsample from GitHub, builds,
starts the backend with that fixture and runs the real-DEM browser smoke. It is
not one of the three required branch-protection checks and does not validate the
source datum/frame as a science product. The equivalent local smoke was executed
for v1.11 (see verification.md); the workflow itself has not been dispatched in
GitHub Actions from this environment.

## 6. Repository rebrand (2026-11-08)

The application moved from `final draft 1/` to the repository root; the
workflow's `working-directory` default and path-qualified cache/artifact
entries were removed accordingly. The three required check names are
unchanged.

**GitHub rename — owner action outstanding.** The canonical repository name
is `Hemansh2633B/chandra`. Both `PATCH /repos/Hemansh2633B/Clps-lunar-mission`
and the GraphQL `updateRepository` mutation return **403 "Resource not
accessible by integration"** for this environment's token (verified
2026-11-08), so the rename could not be performed here. The owner must rename
via Settings → General → Repository name → `chandra`, and set the description
to "Open-source lunar mission planning and analysis workbench." GitHub
redirects the old URL after a rename. Until then, clone URLs pointing at
`chandra` will 404 and the old slug remains canonical.


## 7. v1.11 GitHub metadata re-read (owner actions still outstanding)

Read-only GitHub API checks during the v1.11 integrity work returned:

- `full_name`: `Hemansh2633B/Clps-lunar-mission` (rename to `chandra` **not** done)
- `description`: `keep working ` (not the proposed product description)
- `default_branch`: `main`
- `main.protected`: `false`
- local `origin`: `https://github.com/Hemansh2633B/Clps-lunar-mission.git`

No rename, description edit or branch-protection write was attempted again after
the earlier 403s; this environment's token cannot perform them. Owner checklist:

1. Settings → General → Repository name → `chandra`; description →
   `Open-source lunar mission planning and analysis workbench.`
2. Update local remote: `git remote set-url origin https://github.com/Hemansh2633B/chandra.git`.
3. Settings → Branches → Add rule for `main` → require the three exact checks:
   - `Typecheck · build · unit · geometry · parity · Python`
   - `Browser E2E (mission · terrain · space · onboarding)`
   - `Independent SPICE validation (fetched kernels)`
4. Re-read `GET /repos/Hemansh2633B/chandra` and
   `GET /repos/Hemansh2633B/chandra/branches/main` before claiming success.
5. Optional: choose and add a LICENSE; enable a static demo host only after the
   base-path asset fixes in `docs/product-design.md` are implemented and verified.
