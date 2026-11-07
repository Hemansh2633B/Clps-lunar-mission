# Known issues

Open engineering findings from the independent v1.10 review. They are recorded
here so they remain visible; none is fixed yet. Each needs a focused change
with its own regression tests, separate from editorial work.

## 1. `simulationKey()` rounds its inputs

`src/engine/simulation.ts` builds the analysis identity from rounded
representations: terrain elevations via `toFixed(3)`, coordinates via
`toFixed(5)`, azimuth offset via `toFixed(4)`, and start/end times rounded to
whole minutes. Two distinct inputs can therefore share one identity — for
example terrain masks differing below 0.001°, or windows offset by seconds.

The key is the single identity source for the worker cache, the export guard
and the SHA-256 analysis fingerprint, so a collision would let a cached result
(or a guard check, or a fingerprint) stand in for a slightly different
analysis. In the current UI, config steps and site coordinates are coarse
enough that collisions are unlikely in practice, but the identity is not
exact by construction.

Fix direction: hash the exact serialized inputs (full-precision elevations,
coordinates, millisecond times) instead of rounded strings, with regression
tests proving distinct inputs yield distinct keys. The report schema does not
change (the fingerprint is opaque), but cached identities and fingerprint
values would change across the fix.

## 2. No serialized-size cap on persisted sessions

`src/tutorial/session.ts` validates structure and element counts
(`MAX_ELEVATIONS`, `MAX_FEATURES`, `MAX_CUSTOM_SITES`, `MAX_SCENARIOS`) but
`parseSession` calls `JSON.parse` on the raw storage string with no byte-length
limit. A pathologically large payload is fully parsed before any validation
runs. Browser localStorage quotas (~5 MB) bound the practical exposure, but
the parser should reject oversized payloads before parsing.

Fix direction: a `raw.length` guard (a few hundred kB is generous for 64 sites
× 3601 elevations) before `JSON.parse`, with a rejection-path test.

## 3. Coarse energy-integration resolution is disclosed too quietly

`src/engine/integration.ts` labels a result `coarse` when the estimated
relative energy error is ≥1%. The label appears in the JSON report
(`reproducibility.numericalUncertainty.integrationResolution`) and the summary
CSV (`integration_resolution`), but not in the report warnings, the UI, or the
per-row CSV disclosure codes. A reader who skips the diagnostics block can
miss that the energy figures carry percent-level uncertainty.

Fix direction: either promote `coarse` to an explicit warning/disclosure code
(`ENERGY_RESOLUTION_COARSE`) surfaced in the UI and every export, or block
quantitative energy export at that resolution. Decide the policy first; then
test the wording paths as with the other disclosure codes.
