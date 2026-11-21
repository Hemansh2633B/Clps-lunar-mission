# Known issues

Open limitations first, then defects found and closed, most recent release
first. Executed gate results live in [verification.md](verification.md).

## Open in the far-side analysis upgrade

- **No bundled/active global far-side DEM product.** The built-in LOLA
  acquisition catalogue remains the five south-polar PGDA COG products. The
  server supports operator-validated NASA PDS/PGDA range-readable products via
  `CHANDRA_LOLA_PRODUCTS_JSON`, but no unverifiable URL is shipped as a
  far-side product. Far-side region candidates therefore have clearly labelled
  illustrative terrain until a measured, frame/datum/coverage-validated DEM is
  configured and acquired. Out-of-footprint acquisition fails; it never falls
  back to a different tile.
- **Far-side catalogue elevations are not supplied.** For region centres with
  no bundled authoritative elevation, 0 m is stored only as a geometry datum
  placeholder; the UI/exports say elevation unavailable and issue a warning.
  The placeholder is not a measurement. Use a measured DEM subset to replace it.
- **Lunar-body limb is spherical.** The 1737.4 km mean sphere and finite angular
  disks separate body occultation from local terrain but omit real limb
  topography, irregular shape and regional distant terrain. Near the limb,
  kilometre-scale relief can change apparent clearance by tenths of a degree.
- **Relay orbits are planning proxies.** Circular lunar two-body, parametric
  L2-plane ring and fixed-body states are deterministic geometry models, not
  flown spacecraft ephemerides, station-kept trajectories or RF links. No link
  budget, antenna, ground station or data-rate model exists.
- **No new multi-region live ephemeris verification is claimed.** The existing
  recorded Horizons/SPICE evidence covers the epochs/sites stated in
  `verification.md`; far-side relay and limb geometry are covered by analytical
  regression tests, not an independent mission-ephemeris comparison.
- **Slope is local and DEM-dependent.** Horn 3×3 slope/aspect is available only
  when the same grid used for the DEM horizon contains a valid local window.
  NoData yields “unavailable”; the estimate is not an engineering landing
  hazard certification.

## Open in v1.12.0

These are things a user or reviewer could reasonably assume work, or were
checked, and that are not — or are not yet shown to be.

### Not exercised against the real services

- **NASA Moon Trek and LROC WMS imagery.** Layer definitions come from the
  services' capabilities documents. Tile placement was tested with synthetic
  tiles served in place of the real hosts, because those hosts were not
  reachable from the development environment. No real tile has been seen in
  the application. If a service's behaviour differs from its capabilities
  document, the layer will show *Unavailable* or misplaced imagery.
- **Live JPL Horizons queries through the API.** The request builder and
  parser are tested against responses retrieved separately and transcribed
  into fixtures (not byte-exact copies), and against a loopback server.
- **Live LOLA acquisition from NASA PGDA.** Tested against a loopback server
  serving a GDAL-written raster with HTTP range support. The five product URLs
  and the assumption that the PGDA server honours range requests come from the
  product page and the v1.11 downloader, not from a download performed here.
- **Vercel Blob storage.** The adapter implements the protocol of the official
  SDK and was tested against a local fake only.

The opt-in tests `CHANDRA_LIVE_TESTS=1 npm run test:go` exercise Horizons and
PGDA for real from a machine with network access; they have not been run.

### Scientific scope

- **v1.12 terrain grids are not numerically identical to v1.11's.** The native
  engine transforms coordinates exactly where the v1.11 backend used GDAL's
  approximate transformer. Individual cells differ by up to a few metres on
  rough terrain (scientific-method §14.4). The effect on mission-level results
  has not been separately quantified.
- **The native reader is narrower than GDAL.** PDS `.IMG`, JPEG/LERC/ZSTD
  compression, multi-band rasters, internal masks and non-spherical or
  unlisted projections are refused. Convert with GDAL first.
- **The Horizons comparison covers one site and three weeks** (Shackleton rim,
  December 2026). Agreement elsewhere is expected, not demonstrated.
- **Local horizon only.** Acquiring a LOLA subset does not make the horizon
  regional; subsets cover at most the 20 km analysis radius.
- **Catalogue blanks are real.** Many reference-frame, vertical-datum, version
  and usage-terms fields read *Not confirmed* because the provider pages
  retrieved did not state them. They were not filled in.

### Engineering

- **Rendering can stall in one headless browser build.** In the development
  sandbox's fallback browser (`@sparticuz/chromium`, software rendering, 2 CPU
  cores), starting timeline playback blocked rendering for one to three
  minutes, once per page. It reproduces identically on the v1.11 base commit,
  so it is not a v1.12 regression, and it did not occur on GitHub's runners
  with Playwright's Chromium, where the same suites pass at default patience.
  It affects responsiveness, not results. The cause was not found and it was
  not investigated on hardware with a GPU. `CHANDRA_E2E_TIMEOUT_SCALE` exists
  for running the browser suites in such an environment.
- **Rate limits are per function instance.** On a serverless platform they
  are a courtesy limit, not a quota.
- **Planner layout on short viewports.** At 1440×900 and 1366×768 the centre
  column is short enough that the Polar Map needs scrolling to be seen whole;
  1600×1000, 1920×1080 and phone widths fit.
- **Story-suite screenshots were not refreshed.** `screenshots/15-…22-*.png`
  are best-effort captures that timed out under software rendering in this
  release's run; the committed images are from v1.11. The suite's assertions
  ran and passed.

## Closed in v1.12.0

### Polar Map drew markers mirrored against its imagery — CLOSED

v1.11 and earlier drew the 0° meridian pointing down while the bundled LROC
mosaic has it pointing up, so site markers, the lighting overlay and the Earth
direction were mirrored north–south relative to the picture underneath.
Coordinates, visibility, power and exports were never affected. Fixed by a
single projection module used for imagery, graticule and markers; the
orientation is established from the image by an executable test
(scientific-method §15.2). `public/assets/PROVENANCE.md` recorded the wrong
orientation and is corrected.

### Export described the ephemeris as "JPL DE402/DE421-class" — CLOSED

`ephemeris.model` in the JSON report read `astronomy-engine (JPL DE402/DE421-class
ephemeris)`, which implies a JPL numerical ephemeris. The engine is
astronomy-engine's analytic models. The field now says so
(scientific-method §13.11). Computed values are unchanged.

### Defects found by this release's own verification

Each of these was introduced and caught within v1.12 development, before
release; they are listed because the tests that caught them remain.

- **`.vercelignore` would have removed `src/data`.** An unanchored `data`
  pattern matches at every depth. A local `vercel build` does not apply the
  ignore file, so only a real deployment would have failed. Patterns are now
  root-anchored and `npm run vercel:check` verifies that nothing the build
  needs is excluded.
- **Temporary storage was reported as persistent on Vercel.** Without a Blob
  store the function writes to a temporary directory, but `/api/config` said
  `persistent: true`, so the interface would have told users their acquired
  DEM persists. Fixed and covered for every storage configuration.
- **A LOLA subset could be stitched from two versions of a source file** if the
  remote object changed mid-download. Every range response is now checked
  against the size and ETag of the object the header came from.
- **The rate limiter trusted `X-Forwarded-For` everywhere**, so on a standalone
  server one client could pose as many and grow the limiter's table without
  bound. The header is now believed only on Vercel, and the table is bounded.
- **Upstream transport errors leaked the request URL** in Horizons and LOLA
  error messages. They are now reduced to a short reason.
- **The Vercel function relied on the optional `VERCEL` system variable** to
  choose a writable data directory. It now declares its platform itself.
- **Map layer tile counts were announced once per tile** to screen readers;
  only state changes are announced now.

## Closed in v1.11.0

Engineering findings from the independent v1.10 review. The three priority-0
integrity findings below were closed with tests-first regressions.

## Closed in v1.11.0

### 1. `simulationKey()` rounded its inputs — CLOSED

**Was:** terrain elevations (`toFixed(3)`), coordinates (`toFixed(5)`), azimuth
offset (`toFixed(4)`) and minute-rounded start/end times could collide. The key
feeds the worker cache, export guard and SHA-256 fingerprint, so a collision
could let one analysis stand in for another.

**Fix:** `src/engine/canonicalJson.ts` + `simulationKey()` now serialize the full
JSON-safe site (every elevation bin and metadata field), millisecond window and
caller config with sorted object keys, significant array order and full double
precision. No rounding. Non-finite numbers, sparse arrays, cycles and non-JSON
values are rejected explicitly. The internal identity tag is
`chandra-analysis-v2`; the cache, hook, guard and fingerprint still share this
one source. LRU remains 36 entries.

**Regression evidence:** `tests/analysis-identity.test.ts` (mask +1e-4°,
coordinate +1e-6°, elevation, azimuth offset, +1 ms / +1000 ms windows,
metadata, config, property-order stability, non-finite rejection, fingerprint
and export-guard propagation) and `tests/simulation-client.test.ts` (distinct
worker posts / cache entries for near-identical terrain and shifted windows).
The tests failed on v1.10 before the fix.

**Compatibility:** fingerprint VALUES change across v1.11; the opaque field
format and `REPORT_SCHEMA_VERSION = 2.0.0` do not. Old cached identities are not
reused. See scientific-method §13.1.

**Residual limitation:** the canonical key is a full serialization, not a
fixed-length digest, so cache keys are larger than the old rounded strings. The
optional `npm run bench:identity` sanity check (3,601 bins, 1,000 calls) is
recorded in verification.md; it is not a CI performance gate. Editing a label or
provenance note intentionally creates a new identity even if the numerical
result would be unchanged.

### 2. No serialized-size cap on persisted sessions — CLOSED

**Was:** `parseSession` called `JSON.parse` before any size check. Structural
caps existed, but a pathologically large raw string was fully parsed first.

**Fix:** `MAX_SESSION_LENGTH = 800_000` JavaScript UTF-16 code units is checked
before `JSON.parse` and before `storage.setItem`. `readSession` /
`loadSessionDetails` return a specific `SESSION_TOO_LARGE` rejection; boot shows
a persistent, dismissible notice and clears the unusable payload once.
`saveSession` returns failures instead of swallowing them. Existing structural
validation and v1→v2 revalidating migration are unchanged.

**Regression evidence:** `tests/session-size.test.ts` proves >800k is rejected
without calling `JSON.parse` (spy), exactly-800k valid v1 migration is accepted,
small invalid payloads still fail validation, save preflight refuses oversized
writes, and storage failures are returned. Export persona C injects an oversized
payload and asserts the size-specific notice + Rebuild/Exit recovery.

**Residual limitation:** 800,000 characters is a parser-work budget, not a byte
cap and not the theoretical structural maximum. Two snapshots × 64 custom sites
× 3,601 elevations can serialize to roughly 11 million characters before
metadata; such a structurally valid but enormous session is rejected explicitly,
never clamped or partially restored. `raw.length` counts UTF-16 code units.

### 3. Coarse energy resolution disclosed too quietly — CLOSED

**Was:** `integration_resolution = coarse` (estimated relative energy error
≥1%) appeared only in JSON diagnostics and the summary CSV column, not in
warnings, UI or per-row disclosure codes.

**Policy chosen:** allow the result for research with a strong, persistent,
non-blocking warning. Do not change terrain eligibility or data confidence; do
not block export solely for coarse resolution. The Richardson estimate is not a
statistical confidence interval and not a thermal-survival model.

**Fix:** `energyResolutionDisclosure()` in `analysisStatus.ts` is the single
source for `ENERGY_RESOLUTION_COARSE`. It flows into JSON `warnings`, CSV
`disclosures` / comparison `warnings`, telemetry and comparison cards
(`EnergyResolutionNotice`), and the timeline screen-reader description. The
wording names the ≥1% threshold, the estimate, possible shifts in energy totals /
SOC / deficit hours, and the non-thermal boundary.

**Regression evidence:** `tests/energy-resolution-disclosure.test.ts` asserts the
code/message, no false positives for converged/adequate, JSON + five mission
CSVs, comparison CSV/JSON, and timeline description propagation. No integration
equation or threshold changed.

**Residual limitation:** coarse results remain exportable by design; consumers
must read the disclosure. The warning is persistent in the UI but comparison
CSV carries it inside the existing `warnings` column (no new column, schema
unchanged).

## Standing limitations (all releases)

- **Local terrain horizon only.** Terrain obstruction is ray-marched only
  within the selected DEM crop; the analytic spherical lunar limb handles
  large-scale body occultation, but no global terrain horizon is built from
  distant ridges or basin rims. The historical §12.5 status predates the
  curvature-aware limb extension.
- **Geometric Earth LOS is not RF connectivity.** Energy balance is not thermal
  or radiation survival. These disclosures are mandatory everywhere.
- **Manual screen-reader execution is outstanding.** The protocol and expected
  results are in [accessibility-manual-protocol.md](accessibility-manual-protocol.md);
  no NVDA/VoiceOver pass is claimed. The v1.12 Data Hub, verification tables
  and map layer controls have not been added to that protocol.
- **Real-DEM fixture is optional and third-party.** The gap-filled downsample
  exercises software loading/cropping/horizon paths only; it is not a science
  product. The optional workflow is not a required check. Execution status is
  recorded per run in verification.md.
- **Repository owner actions remain outstanding.** Rename to `chandra`,
  description, and branch protection with the exact CI check names (four jobs
  since v1.12); see [ci-governance.md](ci-governance.md). This environment
  cannot enable them.
- **Project-subpath static hosting is unverified.** The console is built for
  the site root, which is how Vercel serves it. Hosting under a sub-path
  (GitHub Pages project site) still needs the base-path asset fixes in
  [product-design.md](product-design.md).
