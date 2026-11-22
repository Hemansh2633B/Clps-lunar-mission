# Deploying to Vercel

CHANDRA deploys to Vercel as a static console plus **one Go function** that
serves every `/api/*` route. Nothing else is needed: no database, no container,
no Python, and no environment variable for a working deployment.

What has and has not been verified on a live deployment is recorded at the end
of this document. Read that section before relying on a feature in production.

## What is deployed

| Part | Source | Result |
|---|---|---|
| Console | `npm run build` → `dist/` | Static files on Vercel's CDN |
| API | `api/index.go` (wraps `backend/httpapi`) | One Go function, `provided.al2023`, 1024 MB, 60 s |

`vercel.json` is the whole configuration:

- `framework: "vite"` — pinned on purpose. A `go.mod` at the repository root
  would otherwise make Vercel choose its Go *server* preset and skip the
  console build.
- `rewrites` — `/api/<route>` goes to the function as
  `/api/index?__route=<route>`; every other path that is not under `/api/` or
  `/assets/` falls back to `index.html`. A missing file under `/assets/` is a
  404, never the HTML shell, so a stale script URL fails loudly.
- `headers` — a Content-Security-Policy and related headers on the console
  (see [Security](#security)), and long-lived caching for content-hashed
  assets. API responses set their own headers in Go.
- `functions` — memory and duration for the function.

`.vercelignore` keeps tests, documentation, screenshots and rasters out of the
deployment. Its directory patterns are anchored to the repository root
(`/data`, not `data`): an unanchored name would also remove `src/data` and
break the build. `npm run vercel:check` enforces this.

The Go module has no third-party dependency (`go.mod` has no `require`), so the
function build downloads nothing but the Go toolchain.

## Deploy

**From Git (recommended).** In the Vercel dashboard, import the GitHub
repository. The settings are read from `vercel.json`; the detected defaults
(framework Vite, build `npm run build`, install `npm ci`, output `dist`) are
correct. Every push then produces a deployment.

**From the command line.**

```bash
npx vercel            # preview deployment
npx vercel --prod     # production deployment
```

**Before either**, without credentials:

```bash
npm run vercel:check              # configuration, CSP, .vercelignore
npm run vercel:check -- --build   # also runs `vercel build` and executes the built function locally
```

`--build` proves that the artifact routes requests correctly and that the
function starts and answers. It does not prove a live deployment.

## Environment variables

None is required. The full list is in [environment.md](environment.md). The
ones that matter on Vercel:

| Variable | When to set it |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | Set automatically when you connect a Vercel Blob store to the project (Storage → Create → Blob). Makes acquired DEMs persistent. |
| `CHANDRA_BLOB_ACCESS` | `private` if the Blob store is private. |
| `CHANDRA_ACQUIRE=off` | To disable LOLA acquisition on a public deployment. |
| `CHANDRA_HORIZONS=off` | To disable live Horizons queries. |

## Storage of acquired DEMs

A serverless function has no durable disk. Without a Blob store, an acquired
DEM is written to the function instance's temporary directory: it is usable
while that instance stays warm and can vanish at any time. The API reports
this as `storage: { kind: "local", persistent: false }`, the Terrain Lab's
dataset panel shows "temporary on this deployment" before a download is
confirmed, and an expired dataset produces an explicit "acquire it again"
message rather than an error page.

With a Blob store connected, datasets and their provenance records are stored
under the `chandra/` prefix and survive between requests and deployments. The
Blob adapter was tested against a local fake of the Blob API only; it has not
been exercised against the real service (see below).

## Limits

| Limit | Value | Where |
|---|---|---|
| Function duration | 60 s | `vercel.json` |
| Function memory | 1024 MB | `vercel.json` |
| Terrain / horizon request | 50 s, 16 KiB body | `backend/httpapi` |
| Acquisition request | 55 s, at most 16 million source pixels | `backend/httpapi`, `backend/lola` |
| Horizons request | 50 s, at most 400 samples per target | `backend/horizons` |
| Rate limits | per client and per route, per function instance | `backend/httpapi` |

Consequences worth knowing:

- A large acquisition (for example a 20 km radius on the 10 m/pixel product)
  can exceed the time limit, depending on how fast NASA's server answers. The
  route then reports a timeout and suggests a smaller radius; nothing partial
  is stored.
- Rate limits are held in memory by each function instance. They slow down a
  single abusive client; they are not a quota across instances.
- The function makes outbound HTTPS requests to `pgda.gsfc.nasa.gov` and
  `ssd.jpl.nasa.gov`. If either blocks or throttles Vercel's addresses, the
  corresponding feature reports the upstream failure; the rest of the
  application is unaffected.

## Security

- The console is served with
  `default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data: blob: https://trek.nasa.gov https://wms.im-ldi.com; object-src 'none'`
  (plus style, font and worker directives). Scripts load only from the
  deployment itself; the browser may call only the deployment's own API; images
  may additionally come from the two imagery providers.
- `npm run vercel:check` fails if a catalogue imagery host is missing from
  `img-src`, or if `img-src` allows a host no layer uses.
- API responses carry `Content-Security-Policy: default-src 'none'`,
  `X-Content-Type-Options: nosniff` and `Cache-Control: no-store` unless a
  route is explicitly cacheable.
- The API never accepts a URL from a client, contacts only its two allowlisted
  data providers, and returns upstream and internal failures without
  hostnames, paths or stack traces.
- The Blob token, if present, is read from the environment, sent only to the
  Vercel Blob service, and never logged or returned.

## Deployment Protection

New Vercel projects protect preview deployments with Vercel Authentication by
default. A protected deployment redirects anonymous visitors to a Vercel login,
**including requests to `/api/*`**. That is a project setting, not an
application error. To share a preview, either log in, create a shareable link
from the deployment's page, or change Settings → Deployment Protection.

## Node and Go versions

- **Node.** The build needs Node 22 or newer. CI builds with Node 22 and
  `package.json` declares `engines: { "node": ">=22" }`. The `chandra` project
  is configured with Node.js 26.x; the project's Node.js setting is the one
  Vercel applies, so production builds run newer than CI.
- **Go.** `go.mod` declares `go 1.23` with `toolchain go1.24.11`. Vercel's Go
  builder installs the toolchain it needs.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Build fails with "Could not resolve ../data/…" | A `.vercelignore` pattern without a leading slash removed a source directory. Run `npm run vercel:check`. |
| The site shows a Vercel login page | Deployment Protection (see above). |
| `/api/health` returns the HTML page | The API rewrite is missing or ordered after the SPA fallback in `vercel.json`. `npm run vercel:check` asserts the order. |
| Console builds but `/api/*` is 404 | The project's framework preset is not Vite, so `api/index.go` was not built as a function. Keep `"framework": "vite"` in `vercel.json`. |
| Imagery layer shows "Unavailable" only when deployed | Its host is missing from the CSP `img-src`. `npm run vercel:check` catches this. |
| "Unknown dataset … may have expired" after acquiring | No Blob store is connected; the dataset was in temporary storage. |

## Verification status

**No live deployment has been made from this repository as of v1.12.0** — and
the production alias is currently broken: the v1.12.0 production deployment
(`dcd8949`, commit `dcd8949d`) was superseded by the PR #13 merge, whose
build failed (the production deployment is in `ERROR` state). The repair
branch (`arena/f5387ff1-clps-lunar-mission`) produces a READY preview
deployment on push. What exists is local evidence that the deployable artifact
is correct:

| Checked locally | How |
|---|---|
| Configuration, rewrite order, CSP against the catalogue, `.vercelignore` | `npm run vercel:check` |
| `vercel build` succeeds on the files Vercel would receive | Vercel CLI 65.16.0 in a copy of the repository with `.vercelignore` applied; and on a clean GitHub Actions runner (CI job "Vercel build output"), where the Go builder had to fetch what it needs itself |
| The built function starts and answers through the generated routes | `scripts/vercel-check.mjs --built`: health, config, terrain, horizon, sources, metadata, JSON 404, verify, via a local Lambda-runtime emulator |
| The function reports itself correctly | `deployment: "vercel"`, storage `local` / `persistent: false`, with the `VERCEL` variable deliberately absent |
| The console works under the production CSP, and without an API | data-feature browser suite, static-only section |

| Not verified until someone deploys | Why it matters |
|---|---|
| The build on Vercel's own builders | Vercel installs its own Go toolchain and Node version there; the local build used local ones. The project's Node.js setting (26.x on the existing `chandra` project) is newer than the Node 22 used in CI |
| The function on Vercel's infrastructure | Cold start, the real request/response bridge, the 60 s limit, memory under a large acquisition |
| Outbound requests to NASA PGDA and JPL Horizons from Vercel | Either provider could refuse or throttle cloud addresses |
| Headers and rewrites as served by Vercel's CDN | Simulated locally from `vercel.json`, not observed |
| Vercel Blob persistence | Tested against a fake of the Blob API only |
| Behaviour behind Deployment Protection | The existing project protects all deployments except custom domains |

After a first deployment, the minimum check is: open the site; open the Data
Hub and confirm the header chip reads `Backend online · vercel`; request
`/api/health` and `/api/config`; run one Horizons query; plan (not download) one
LOLA subset; select each remote imagery layer on the Polar Map. Record the
result here and in [../verification.md](../verification.md).

