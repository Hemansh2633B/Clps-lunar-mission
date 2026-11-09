# CHANDRA product design · landing + workspace entry

**Status:** design specification for the next product iteration. It is not a
claim that a landing page or router has shipped. The current application is a
single-screen planner at `/` with state-switched views (see
[architecture/overview.md](architecture/overview.md)). This document preserves
the paper-folio identity and the scientific honesty contract while making the
first ten seconds feel like a product, not a lab bench.

Design principles:

1. **Simple first, visualize everything.** The first screen answers “what can I
   do here?” and gets the user to a labeled, computed result quickly. Heavy
   science stays available, not mandatory.
2. **Provenance is part of the interface.** Confidence tiers, blocked states and
   limitations are never hidden behind a marketing page or an “Advanced” toggle.
3. **One solver, one identity.** The landing page never computes a second,
   simplified truth. Demo results use the same engine, cache, guard and export
   pipeline as the workspace.
4. **Paper-folio, not sci-fi glass.** Cream paper, brass rules, coral accents,
   Fraunces display / Outfit body / IBM Plex Mono data. No new animation system.

---

## 1. Route and entry IA

Recommended routes:

| Route | Purpose | Notes |
|---|---|---|
| `/` | Landing / product folio | Static, fast, no worker or Three.js required. |
| `/workspace` | Full-screen planner | Current `App` experience, focused chrome. |
| `/workspace?site=…&start=…` | Deep link to a scenario | Optional; must validate against `MISSION_LIMITS` and catalogue ids. |
| `/guide` | Field Guide / glossary | Can remain a workspace overlay initially. |

Implementation options, in order of preference:

- **History router with a tiny lazy boundary.** `/` renders `Landing`;
  `/workspace` lazy-loads the current `App`. Requires a static-host rewrite to
  `index.html` for direct visits. Keep the landing bundle free of Three.js,
  astronomy-engine and the simulation worker.
- **Hash fallback for project Pages.** `#/workspace` works without server
  rewrites. Use this if deploying under `/<repo>/` before a custom domain exists.
- **Subdomain split** (`www` landing, `app` workspace) only if the owner wants
  separate deployments. It adds CORS/cache complexity and is not required.

Do **not** replace the current root app until the landing page has automated
coverage for: direct visit, CTA navigation, back-to-home, reduced motion,
390 px reflow, and “demo result is labeled illustrative”.

Global chrome:

- Landing header: wordmark + “How it works” + “Field Guide” + GitHub +
  primary **Launch Workspace**.
- Workspace header: small wordmark links home (`aria-label="Back to CHANDRA
  home"`), version, status pill, primary tools. The current dense clock strip
  can collapse into a single UTC readout on first visit and expand via
  “Mission clock”.
- Footer on both: version, report schema, “Not flight software”, GitHub,
  data/provenance links. No NASA endorsement language.

---

## 2. Landing page structure and copy

Visual direction: a warm space-inspired paper folio. Think mission notebook /
observatory annual report, not a dark dashboard. Use the existing tokens:
`--paper`, `--paper-2`, `--ink`, `--brass`, `--coral`, `--solar`, `--earth`.
Hero plate may reuse `public/assets/hero-lunar.jpg` (decorative illustration,
already disclosed in `public/assets/PROVENANCE.md`) or a computed SVG diagram.
Never present decorative art as measured lunar imagery.

### 2.1 Hero

Layout: asymmetric two-column folio. Left: eyebrow, headline, one-sentence
value proposition, CTAs, trust line. Right: a single static visual explainer
(§2.2) or the decorative hero plate with a small “illustration, not data” caption.

Exact copy:

- Eyebrow: `LUNAR SOUTH POLE · PLANNING DESK`
- H1: `CHANDRA`
- Hero sentence: `Plan and visualize lunar landing sites near the south pole —
  illumination, Earth visibility, and power budgets.`
- Supporting line: `Start with a labeled demo site, then bring your own terrain.
  Every result carries its data confidence, assumptions and export provenance.`
- Primary CTA: `Launch Workspace`
- Secondary CTA: `See how it works`
- Trust line: `Open source · UTC ephemeris · Not flight software`

Behavior:

- Primary CTA navigates to `/workspace` and opens the soft first-run picker
  (§3). It must not require account creation.
- Secondary CTA scrolls to `#how-it-works` and moves focus to that heading.
- If the user has a persisted session, show a quiet tertiary link:
  `Resume last briefing` (only when `loadSessionDetails` returns a valid
  session; never parse oversized payloads on the landing page).

### 2.2 Visual explainer: Sun → terrain → power → battery → Earth comms

One horizontal diagram, five nodes, readable at 390 px as a vertical stack:

1. **Sun / Earth geometry** — “Where are the Sun and Earth in the local sky?”
2. **Terrain horizon** — “What does the local mask block?”
3. **Solar power** — “How much does the array generate?”
4. **Battery / energy** — “Does the stored energy bridge the dark intervals?”
5. **Earth line-of-sight** — “When is geometric visibility open?”

Caption: `Geometric visibility is not an RF link budget. Energy balance is not
thermal survival. CHANDRA labels both limits wherever results appear.`

Use SVG with `role="img"` and a full text alternative; provide the same chain as
an ordered list for screen readers. Do not animate by default; if a subtle
draw-on is added later, gate it behind `prefers-reduced-motion`.

### 2.3 Benefit cards (3–4)

Four cards max, each with a plain-language promise and a honesty qualifier.

1. **See the window, not just a point**
   `Scrub UTC time across days or weeks. Illumination, Earth line-of-sight and
   battery state stay on one timeline.`
   Qualifier: `Sampling and transition refinement are disclosed in every export.`
2. **Compare sites without mixing confidence tiers**
   `Pin scenarios and compare them side by side. Blocked or stale rows stay
   visible with empty numbers, never zero-filled.`
   Qualifier: `Ranking is a heuristic, not a NASA metric.`
3. **Bring real terrain when you are ready**
   `Import a compatible lunar DEM horizon. Frame, coverage and epoch checks gate
   quantitative use before export.`
   Qualifier: `No DEM configured? The app says so; it never silently substitutes
   synthetic data.`
4. **Export a report you can reconcile**
   `JSON and CSVs carry the effective config, analysis fingerprint, status,
   confidence and disclosure codes.`
   Qualifier: `Fingerprints identify the exact inputs; they do not certify flight
   readiness.`

### 2.4 “Choose your starting point” section

Three entry cards, all leading to the same workspace:

- **Explore a demo site** — `Illustrative terrain, real ephemeris. Best first
  look.` CTA: `Open demo workspace`.
- **Start the 14-day briefing** — `A guided story through site selection,
  darkness, power and export.` CTA: `Start briefing`.
- **Analyze your DEM** — `Configure a projected lunar GeoTIFF and compute a
  360° horizon.` CTA: `Open Terrain Lab`.

Copy rule: the demo card must say **illustrative** above the fold of the card,
not only after click. The DEM card must not imply NASA data is bundled.

### 2.5 Method / limitations strip

Short folio band, not a wall of text:

`CHANDRA computes topocentric Sun/Earth geometry, terrain-mask occlusion,
cosine-incidence solar power and event-aware battery integration. It is a
planning and education workbench: local horizon only, geometric Earth
line-of-sight only, no thermal/radiation survival model, no RF link budget.`

Links: `Scientific method`, `Known issues`, `Verification evidence`,
`Accessibility`. These are product trust signals, not footnotes.

### 2.6 Footer

`CHANDRA v{APP_VERSION} · report schema {REPORT_SCHEMA_VERSION}`
`Open-source lunar mission planning and analysis workbench. Not flight software.`
Links: GitHub repository, license (only once an owner-selected LICENSE exists),
asset provenance, verification, accessibility.

Do not add contributor counts, download badges, NASA logos or “trusted by”
claims that have not been verified.

---

## 3. Workspace entry and first-run experience

Goal: a first-time user reaches a **labeled, computed** result in under ten
seconds on a normal desktop connection, without reading a manual.

### 3.1 Soft onboarding picker (replaces the current modal as the default)

Current state: `Onboarding.tsx` is a dismissible modal offering demo vs real
DEM, plus a six-step workflow. It is honest but interrupts the first result.

Proposed first visit to `/workspace`:

1. Render the planner shell immediately with a quiet, non-modal **Start panel**
   in the center column (not a blocking dialog):
   - Heading: `Choose a starting site`
   - Three preloaded choices, each with confidence chip:
     - `Shackleton rim — illustrative demo`
     - `de Gerlache Rim 2 — illustrative demo`
     - `Connecting ridge — illustrative demo`
   - Secondary: `I have a DEM` → opens Terrain Lab.
   - Tertiary: `Skip — use default demo` → selects the current default.
2. Selecting a site sets the existing default UTC window/config and starts the
   real worker. Show the existing progress phases; do not fake a result.
3. When the first result resolves, collapse the Start panel into a small
   `Change starting site` link. Focus moves to the result heading only if the
   user activated the choice by keyboard; do not steal focus on mouse click.
4. Persist `chandra-first-run-v1` only after a choice or explicit skip. Reopen
   from Help. Never re-show after a valid persisted session exists.

Why these sites: they are already in the catalogue and produce useful demo
results in the default window. The picker must read confidence from the site
record, not hardcode “real”.

### 3.2 Default useful views

First result should show, without opening Advanced:

- **Timeline / Gantt**: Sun, Earth LOS, combined windows; keyboard scrubber.
- **Telemetry summary**: illumination %, Earth LOS %, longest eclipse, energy
  verdict, battery min/final SOC.
- **Energy / battery chart**: the integrator’s own history, not a re-integrated
  approximation.
- **Horizon panorama + polar map**: visual context, with blocked-state wording
  already implemented.
- **Provenance indicator**: persistent confidence tier + disclosure codes.

Heavy science behind progressive disclosure:

- `Mission parameters` modal: array mode/area, efficiency, derate, load,
  battery, comms margin, step. Keep clamped-field notices.
- `Scientific details` drawer/section: sampling cap, transition diagnostics,
  integration resolution/Richardson estimate, frame transform/residual,
  effective vs requested config, fingerprint.
- Terrain Lab and Space remain lazy-loaded views, not first-paint dependencies.

### 3.3 Workspace IA map

```text
Workspace
├─ Home link / wordmark / version / status
├─ Left rail: sites + custom sites + confidence chips
├─ Center: Start panel → panorama / map / timeline / energy
├─ Right rail: telemetry summary + provenance + warnings
├─ Top tools: Compare · Terrain · Space · Guide · Export · Settings · Help
└─ Bottom: UTC scrubber, playback, keyboard shortcuts, ticker (decorative)
```

Rules:

- One primary action per context: first run = choose site; resolved = export or
  compare; blocked = read reason / fix inputs.
- Warnings are persistent notes, not auto-dismissing toasts. The v1.11 session
  rejection notice and coarse-energy notice follow this rule.
- Export remains guarded; the landing page never offers “download sample
  report” unless it is generated by the same guard and labeled as a demo.
- Back-to-home must not discard work silently. If a briefing session is active,
  flush persistence first; if storage fails, show the existing notice.

---

## 4. UX recommendations to feel product-like

1. **Reduce first-paint chrome.** Collapse the four-cluster clock strip into one
   UTC readout + “Mission clock” disclosure on first visit. Keep the dense strip
   for Flight Ops mode.
2. **Name the modes by user intent.** Current `FLIGHT OPS / EDUCATOR` is useful;
   consider `Plan / Teach` labels with the existing mode semantics unchanged.
   Do not imply flight certification.
3. **Make the first result a milestone.** A small `First result ready` heading
   and a one-line “what you are seeing” caption orient newcomers without a tour.
4. **Keep the briefing optional.** The 14-day Window story is a product
   strength, but it should be a card/launcher, not a gate.
5. **Empty states are instructions.** No DEM, blocked frame, stale scenario and
   oversized session each get a specific next action, not a generic error.
6. **Mobile is a reader, desktop is a planner.** At ≤768 px, stack rails into
   tabs/accordions (Sites / Result / Details), keep the scrubber reachable, and
   never require hover. Desktop remains the optimized comparison/export surface.
7. **Lazy-load the heavy views.** Terrain Lab and Space are already split;
   keep the landing page free of them. Measure landing JS separately from
   workspace JS in CI build output.
8. **One disclosure vocabulary.** `ENERGY_RESOLUTION_COARSE`,
   `FRAME_UNVERIFIED`, `LOCAL_HORIZON`, etc. appear identically in UI, JSON and
   CSV. Marketing copy never softens them.
9. **No dark patterns.** No account wall, no email capture, no “NASA-approved”
   badge, no fake telemetry. The product trust story is reproducibility.
10. **Version and schema in the footer.** Users should always know which app
    produced a report and which format it uses.

---

## 5. Accessibility and performance acceptance

Landing page:

- One `h1`; sections have headings; CTA order is logical; skip link to content.
- Diagram has `role="img"` + text alternative and an equivalent ordered list.
- Contrast ≥ 4.5:1 for small text using the measured paper-folio tokens.
- `prefers-reduced-motion`: no marquee, no draw-on, instant scroll.
- 390 px: no horizontal scroll; CTAs ≥ 44 px touch target; footer wraps.
- Landing route does not import the simulation worker, Three.js or Terrain Lab.
- Keyboard: Tab reaches primary CTA, secondary CTA, entry cards and footer links;
  Enter/Space activate; focus is visible.

Workspace entry:

- Start panel is a labeled region, not a modal trap; choices are buttons with
  confidence in the accessible name.
- First result progress is announced via the existing live region, not spammed.
- Blocked/demo/illustrative labels are in the accessible name, not color-only.
- Manual NVDA/VoiceOver protocol: see
  [accessibility-manual-protocol.md](accessibility-manual-protocol.md). Automated
  label checks are not a screen-reader pass.

Performance budget (proposal, to be measured before claiming):

- Landing: ≤ 150 kB gzip JS, no Three.js/ephemeris chunk, LCP < 2.5 s on a
  mid-tier mobile profile.
- Workspace first result: demo site resolves < 10 s after selection on the
  existing CI desktop profile; progress phases remain visible.
- Do not lengthen test timeouts to meet the budget; measure and report.

---

## 6. Static demo deploy consideration

A static demo is feasible because the frontend runs without the Python backend:
Terrain Lab then offers the labeled synthetic demo and real mode reports an
actionable no-DEM error. Recommended first deploy: GitHub Pages project site or
any static host with SPA rewrite.

Blockers to fix before a project-subpath deploy:

- Several decorative assets use root-absolute URLs (`/assets/patch.png`,
  `/assets/hero-lunar.jpg`, `/assets/lander.jpg`, `/assets/ops-desk.jpg`,
  `/assets/classroom.jpg`, `/assets/moon_1024.jpg`,
  `/assets/earth_atmos_2048.jpg`). `PolarMap.tsx` already uses
  `import.meta.env.BASE_URL`; the others should follow the same pattern before
  building with `--base=/<repo>/`.
- `/api` calls must fail gracefully in a static-only deploy (they already report
  no-DEM/unavailable states; verify in a static preview, not only the dev proxy).
- Direct visits to `/workspace` need a host rewrite or the hash fallback.

Owner steps (not executed here):

1. Rename the repository to `chandra` (permissions blocked in this environment;
   see [ci-governance.md](ci-governance.md)).
2. Enable Pages from GitHub Actions or choose a static host.
3. Build with the correct base path; run the browser suite against the static
   preview with no backend; record the result in `verification.md`.
4. Keep the demo labeled illustrative/synthetic. Do not bundle the gap-filled
   verification DEM as if it were a science product.

No deploy is claimed by this document.

---

## 7. Phased implementation plan

| Phase | Scope | Validation |
|---|---|---|
| A | Landing route + copy + diagram + footer; workspace lazy boundary | Unit/route tests, build chunk assertion, 390 px + reduced-motion E2E |
| B | Soft start picker replacing default modal; first-result milestone | E2E: choice → real worker result < 10 s, confidence labels, skip/resume |
| C | Progressive disclosure drawer for scientific details; clock-strip collapse | Existing export/guard suites unchanged; a11y label tests |
| D | Base-path asset fix + static demo preview | Static-host browser run, no-backend DEM safeguard, asset 200 checks |
| E | Manual screen-reader execution | Record versions/dates/pass-fail only when actually executed |

Each phase is a focused PR with tests alongside, full ci-governance battery,
docs updated to executed evidence, and no automatic merge.
