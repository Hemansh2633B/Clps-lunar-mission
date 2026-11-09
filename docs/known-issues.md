# Known issues

Engineering findings from the independent v1.10 review. The three priority-0
integrity findings below are **closed in v1.11.0** with tests-first regressions.
Remaining limitations are recorded honestly; they are not silently deferred.
Executed gate results live in [verification.md](verification.md).

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

## Remaining limitations (not P0 regressions)

- **Local horizon only.** Regional curvature / per-epoch frames remain
  researched, not implemented (scientific-method §12.5).
- **Geometric Earth LOS is not RF connectivity.** Energy balance is not thermal
  or radiation survival. These disclosures are mandatory everywhere.
- **Manual screen-reader execution is outstanding.** The protocol and expected
  results are in [accessibility-manual-protocol.md](accessibility-manual-protocol.md);
  no NVDA/VoiceOver pass is claimed.
- **Real-DEM fixture is optional and third-party.** The gap-filled downsample
  exercises software loading/cropping/horizon paths only; it is not a science
  product. The optional workflow is not a required check. Execution status is
  recorded per run in verification.md.
- **Repository owner actions remain outstanding.** Rename to `chandra`,
  description, and branch protection with the three exact CI checks; see
  [ci-governance.md](ci-governance.md). This environment cannot enable them.
- **Static demo deploy is considered, not shipped.** Base-path asset fixes and a
  no-backend static preview are proposed in [product-design.md](product-design.md).
