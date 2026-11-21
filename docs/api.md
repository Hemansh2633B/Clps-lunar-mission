# CHANDRA API and data contracts

The HTTP API is the existing Go service (`backend/httpapi`) deployed as a
single Vercel function. The browser simulation remains TypeScript and runs in a
Web Worker. New visibility and relay calculations do **not** add a second
backend ephemeris or change existing API routes. Existing responses are
extended additively; API version remains `1.1`.

## Existing routes

| Method / path | Purpose | Notes |
|---|---|---|
| `GET /api/health` | runtime capabilities | No credentials or URLs returned. |
| `GET /api/config` | terrain/backend settings | Explicit source/frame metadata. |
| `GET /api/sources` | source catalogue | Includes attribution and availability. |
| `GET /api/datasets` | configured/acquired DEMs and acquisition products | Product entries now also carry nominal resolution, provider, and a coverage note. |
| `GET /api/terrain/metadata?dataset_id=…` | inspect a raster | Reports CRS, geotransform, frame classification, NoData, footprint and eligibility. |
| `POST /api/terrain` | deterministic DEM subset / synthetic demo | Synthetic mode is labelled and cannot masquerade as measured terrain. |
| `POST /api/horizon` | ray-marched local horizon | Coverage per azimuth; no missing ray is converted to a flat zero. |
| `POST /api/terrain/acquire` | bounded LOLA/PDS COG subset acquisition | Client supplies `product_id`, not a URL. Dry-run plans are supported. |
| `POST /api/ephemeris/verify` | independent JPL Horizons comparison | Verification only, never the simulation source. |

All network-facing inputs are decoded with size limits. Latitude must be
finite and in `[-90, 90]` degrees planetocentric; east longitude is normalized
from the documented accepted range; timestamps are UTC ISO strings or integer
UTC milliseconds, depending on the existing route; radii, quality and grid
parameters have explicit bounds. Dataset IDs and product IDs are validated and
client-supplied `url`, `source_url` or `href` fields are rejected by acquisition.

## `GET /api/datasets` product entry

The existing response shape is retained. Each `acquisition.products[]` item
contains:

```json
{
  "id": "lola-ldem-80s-20mpp-adj",
  "url": "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF",
  "product_page": "https://pgda.gsfc.nasa.gov/products/90",
  "nominal_resolution_m": "20",
  "coverage_note": "South-polar LOLA mosaic; exact footprint is determined from the source GeoTIFF georeferencing. This product does not provide global or far-side coverage.",
  "provider": "NASA LOLA · PDS Geosciences Node / PGDA"
}
```

`nominal_resolution_m` is a product-name scale, **not** a claim that every
sample in a crop has that spacing or vertical accuracy. The acquisition response
and raster metadata are authoritative for the actual geotransform, CRS, frame,
coverage, NoData and subset SHA-256. The `coverage_note` is descriptive; the
GeoTIFF footprint is the exact coverage check.

The current built-in catalogue contains the existing south-polar NASA PGDA LOLA
products only. It does not pretend that these products cover Von Kármán, Apollo
basin, Hertzsprung, or the far-side hemisphere. A far-side request against a
south-polar-only product fails explicitly at planning/coverage validation; no
other tile is selected as a substitute.

### Additional regional COG products

A deployment operator can extend the allowlisted product catalogue with
`CHANDRA_LOLA_PRODUCTS_JSON`. This is an operator-controlled server environment
variable, **not** a request parameter. It accepts at most 50 entries / 256 KiB;
all raster and product-page URLs must be HTTPS on the built-in NASA PGDA or PDS
Geosciences Node host allowlist. Each entry must provide attribution, nominal
scale, coverage note, and explicit lunar frame / vertical datum metadata. The
operator must assert `range_access: true`; the API independently requires HTTP
`206 Partial Content`, consistent `Content-Range`, and stable source identity.
A source must be a range-readable COG/GeoTIFF or bounded subset acquisition will
fail. CRS and the product's actual footprint are still checked for every
acquisition. Invalid manifest configuration fails server startup rather than
being ignored.

Example **schema only** (replace every value with a provider-verified product;
this deliberately is not a working/fabricated dataset URL):

```json
[
  {
    "id": "provider-product-id",
    "url": "https://pds-geosciences.wustl.edu/<verified-range-readable-product>.tif",
    "product_page": "https://pds-geosciences.wustl.edu/<verified-product-documentation>/",
    "provider": "NASA PDS Geosciences Node · product identifier",
    "coverage_note": "Coverage statement copied from the provider product label; raster footprint is validated separately.",
    "nominal_resolution_m": 118,
    "range_access": true,
    "assumptions": {
      "vertical_unit": "m",
      "value_kind": "elevation",
      "elevation_reference": "Exact datum statement from the product label",
      "elevation_reference_radius_m": 1737400,
      "lunar_reference_frame": "Exact lunar frame and realization from the product label"
    }
  }
]
```

The example's placeholder path is intentionally invalid. Do not deploy it. The
operator must verify the actual product identifier, checksum/release, range
support, frame realization, datum, units and footprint from NASA PDS metadata.
The current repository does **not** include a verified far-side global COG
manifest, so no far-side DEM acquisition is claimed as active by default.

## Simulation result fields (browser/worker contract)

`EphemerisSample.geometry` adds the same-epoch EQJ vectors, site local frame,
mean lunar limb, finite-disk Sun/Earth occultation state and angular radii.
`EvaluatedSample.sunVisibility` and `.earthVisibility` report three distinct
checks:

- `geometricVisible`: target centre elevation is at/above the site's local
  horizontal plane. It is a reference condition, not an LOS conclusion.
- `bodyOccultation`: spherical lunar-body limb test (`clear`, `partial`,
  `occulted`). Earth occultation is not inferred from longitude.
- `visible`: terrain + lunar-limb obstruction (and configured Earth margin)
  both clear.

`obstructionSource` is `terrain`, `lunar-limb`, `margin`, or `none`. The
`clearanceDeg` is elevation minus the larger of the local terrain horizon and
the mean spherical limb; it does not subtract the configurable communications
margin. `reason` explains the selected obstruction. Finite angular disks are
reported separately; the solar/Earth visibility timeline is centre-clearance
based and does not claim an RF link.

`MissionConfig.relay` is optional and is included in `simulationKey` / worker
cache identity. It selects one explicit model: `circular-lunar` (two-body
circular proxy), `earth-moon-l2-halo` (solved L2 plus parametric halo-plane
motion), or `fixed-body`. A relay sample separately reports site→relay body
clearance, site→relay terrain/limb clearance and relay→Earth body clearance.
`linkUp` is true only when both geometric legs are clear. It is not an RF link.

`MissionSummary.windows` contains Sun, Earth and relay intervals in UTC
milliseconds. `relay` aggregates two-hop geometric availability and outage
statistics when configured. Relay windows are kept separate from the legacy
`dtePct` direct-to-Earth metric; direct Earth availability is never rewritten by
a relay. The detailed schema is the TypeScript `src/types/mission.ts` contract.

## Deterministic reproducibility

- All simulation epochs are UTC milliseconds. Browser date inputs are parsed as
  UTC; no local timezone enters an analysis key.
- `simulationKey` is canonical JSON of the full site (including terrain and
  provenance), exact start/end milliseconds, config and identity version.
- Worker cancellation and LRU caching are keyed by this identity. Relay model,
  epoch and orbit parameters therefore cannot collide with direct-only results.
- Horizons / SPICE results are references for comparison, never values injected
  into a simulation run.
- Unavailable elevation, slope, coverage and resolution remain absent/blank in
  machine-readable outputs; they are not zero-filled.
