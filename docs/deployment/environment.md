# Environment variables

None of these is required. With no variable set, the API serves the synthetic
demo, the source catalogue, LOLA acquisition and Horizons verification, and
stores acquired DEMs in `data/acquired/` (locally) or in temporary storage (on
Vercel). The static console reads no environment variable at all.

The authoritative list is `httpapi.FromEnv` in `backend/httpapi/server.go` and
`store.FromEnv` in `backend/store/store.go`.

## Runtime (API)

| Variable | Default | Effect |
|---|---|---|
| `LUNAR_DEM_CONFIG` | unset | Path to a DEM configuration JSON (see `data/README.md`). Same as `--dem-config`. |
| `LUNAR_DEM_PATH` | unset | Path to a DEM GeoTIFF; overrides `dem_path` in the configuration file. Same as `--dem`. The vertical datum, units and frame still have to come from a configuration file: a raster without them is rejected. |
| `CHANDRA_API_PORT`, `PORT` | `8000` | Port of the local server (`cmd/chandra-api`). Ignored on Vercel. |
| `CHANDRA_HORIZONS` | on | `off` disables `POST /api/ephemeris/verify` (the route answers 503 `horizons_disabled`). The recorded comparison in the console still works. |
| `CHANDRA_ACQUIRE` | on | `off` disables `POST /api/terrain/acquire` (503 `acquisition_disabled`). |
| `CHANDRA_LOLA_PRODUCTS_JSON` | unset | Optional JSON array of deployment-verified NASA PGDA/PDS range-readable regional COGs. URLs are checked against the built-in host allowlist; metadata must state frame/datum/units, coverage, nominal resolution and provider. Invalid configuration fails startup. This does not ship or certify a far-side product; see [API manifest contract](../api.md). |
| `CHANDRA_RATE_LIMIT` | on | `off` disables the per-client request limits. Intended for automated tests. |
| `CHANDRA_STORE` | automatic | `memory` keeps acquired datasets in memory only; `local` forces the local directory even when a Blob token is present. |
| `CHANDRA_DATA_DIR` | `data/acquired` locally; a temporary directory on Vercel | Directory for acquired datasets when the local store is used. |
| `BLOB_READ_WRITE_TOKEN` | unset | **Secret.** When set, acquired datasets are stored in Vercel Blob and survive between function invocations. Vercel sets this automatically when a Blob store is connected to the project. Never returned by any route and never logged. |
| `CHANDRA_BLOB_ACCESS` | `public` | `private` for a private Blob store. Must match the store's type. Acquired DEM subsets are public NASA data, so public access discloses nothing confidential. |

## Storage selection

1. `BLOB_READ_WRITE_TOKEN` set and `CHANDRA_STORE` is not `local` → Vercel Blob (persistent).
2. Otherwise `CHANDRA_STORE=memory` → in-memory (lost on restart).
3. Otherwise the local directory (`CHANDRA_DATA_DIR` or the default).

`GET /api/config` reports the result as `storage.kind` and
`storage.persistent`, and the Terrain Lab shows it. On Vercel without a Blob
token the kind is `local` in a temporary directory and `persistent` is
`false`, whatever `CHANDRA_DATA_DIR` says: a dataset acquired by one request
may be gone by the next, because serverless instances are not shared and are
recycled. The interface says so before a download is confirmed.

## Test and tooling hooks

These exist for automated tests and development tooling. They are not
user-facing options and are not needed on a deployment.

| Variable | Effect |
|---|---|
| `CHANDRA_HORIZONS_BASE_URL` | Redirects Horizons requests. Accepted only if it is the official JPL endpoint or a loopback address; anything else stops the API at start-up. |
| `CHANDRA_LOLA_BASE_URL` | Redirects LOLA range reads to a mirror with the PGDA file layout. Accepted only if it is the allowlisted host or a loopback address. |
| `VERCEL_BLOB_API_URL` | Overrides the Vercel Blob API base (tests use a loopback fake). The token is then sent only to that origin. |
| `CHANDRA_LIVE_TESTS=1` | Enables the Go tests that call NASA PGDA and JPL Horizons for real. Off in CI. |
| `CHANDRA_UPDATE_RECORDED=1` | Makes the Horizons test rewrite `src/verification/recordedHorizons.json` from the recorded responses. |
| `CHANDRA_GO` | Path to the `go` binary used by the npm scripts when it is not on `PATH`. |
| `GITHUB_TOKEN` | Optional, used by `npm run fixture:lola` to avoid anonymous GitHub rate limits. |
| `VERCEL_CLI_BIN` | Path to a `vercel` binary for `scripts/vercel-check.mjs --build` (default: `npx vercel`). |
| `CHANDRA_BROWSER_CI=1` | Makes the browser suites use Playwright's own Chromium (CI) instead of the npm-distributed fallback binary. |
| `CHANDRA_E2E_TIMEOUT_SCALE` | Multiplies the default action timeout of the story browser suite for software-rendered browsers. Changes patience only, never an assertion. |
| `BASE_URL` | Address of the console under test for the browser suites that run against a live stack. |

## Variables set by the platform

On Vercel the function identifies itself as a Vercel deployment without relying
on any variable (`api/index.go`), so it works whether or not the project
exposes system environment variables to the runtime. `VERCEL` is honoured by
the shared configuration code when it is present.
