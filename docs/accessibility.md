# Accessibility · CHANDRA

**Audit date:** 2026-11-07 (v1.9), extended for v1.10 · **Scope:** planner, Terrain Lab, comparison, briefings,
modals, exports, mobile layouts. **Identity preserved:** paper-folio (cream paper,
coral, brass; Fraunces / Outfit / IBM Plex Mono), no added animation.

> **Honesty boundary:** everything under "Automated coverage" is verified by unit
> tests or Playwright and runs in CI. Playwright asserting `aria-label` strings is
> **NOT a screen-reader pass**. The NVDA/VoiceOver checklist below is a *manual
> protocol that has not been executed* in this environment (no screen reader
> available). No screen-reader compatibility is claimed until it is.

---

## 1. Defects found and fixed in v1.9

| # | Defect | Fix | Verified by |
|---|---|---|---|
| 1 | Panorama `role="img"` label claimed "visible / direct-to-Earth open" from raw `.visible` even when the epoch gate blocked terrain visibility | `panoramaDescription()` reports sky **positions only** when blocked; no visibility/clearance claims | `a11y-descriptions.test.ts`; persona D (label asserted at epoch 2040) |
| 2 | Site-brief DEM footer always said "Verify frame alignment" — even for verified frames, and never named a blocked status | `demFooterStatus()` quotes `AnalysisAssessment` verbatim when blocked; verified frames state allowlist + constant-rotation residual + coverage + LOCAL scope | unit tests; persona D (`role="note"` quotes `FRAME_MODEL_OUTSIDE_VALIDATED_RANGE`) |
| 3 | Polar-map Earth vector used green/red LOS colors at blocked epochs | neutral brass vector + "Earth az … · LOS unverified" label; map description flags azimuth-only | unit test; persona D |
| 4 | Timeline description said "No computed window yet" for a **blocked** analysis | `timelineDescription()` names the blocked status + reason; percentages only when a summary exists | unit tests; persona D |
| 5 | Horizon-table modal displayed Sun/Earth **clearance values** against an unvalidated mask; CSV export carried them | clearance cells read "blocked", explanatory note, CSV disabled; export gate also refuses (`horizonInstantBlocked`) | unit tests; persona D |
| 6 | Decorative ticker marquee intercepted clicks on the Export dropdown (header `backdrop-filter` stacking context) | `.ticker { pointer-events: none }`; `.app-header { z-index: 30 }` | personas A/B (real menu downloads) |
| 7 | `--dim` text (#8a7358) measured **4.32:1** on panel / **3.65:1** on paper — below WCAG AA 4.5:1 for small text | `--dim: #76614a` → **5.65:1 / 4.76:1**, same brass family | measured (WCAG relative-luminance formula); persona E runtime checks |
| 8 | Terrain Lab warning alert: `--solar` on `#fdf0d5` = **4.19:1** | alert text uses `--brass` → **5.23:1** | measured |
| 9 | Persisted story status `active` after refresh implied a live panel that wasn't open | normalized to `paused` on mount; launcher/Field Guide honestly offer Resume | persona C |

### Measured contrast (WCAG 2.x relative luminance, panel `#fffaf2` / paper `#f3e6d0`)

| Pair | Ratio | AA small text |
|---|---|---|
| ink `#1c2430` on panel | 14.9:1 | pass |
| ink on paper | 12.68:1 | pass |
| muted `#5c5348` on panel | 7.25:1 | pass |
| muted on paper | 6.12:1 | pass |
| dim `#76614a` on panel / paper | 5.65 / 4.76:1 | pass |
| brass `#8a5a16` on panel / paper | 5.68 / 4.79:1 | pass |
| solar `#9a6a10` on panel | 4.55:1 | pass (panel contexts only) |
| earth `#0e7490` on panel | 5.16:1 | pass |
| blocked `#c23b32` on panel / alert bg `#fbeae5` | 5.10 / 4.54:1 | pass |
| nominal `#1f7a52` on panel | 5.10:1 | pass |

Persona E additionally measures dialogue, objective, mission-log and scene text
against the live panel background at runtime and fails below 4.5:1.

## 2. Automated coverage (runs in CI)

- **Keyboard:** persona E starts the briefing, chooses training, selects a site,
  answers checks and navigates chapters using focus + Enter only; primary actions
  focus the real scrubber and native arrow keys do the work; Escape pauses and
  resume keeps the chapter. Global shortcuts (Space, [ ], ←/→, C/T/O/E/G/P/?)
  unchanged and ignored while typing in inputs.
- **Focus:** chapter transitions move focus to the panel heading; modal opens
  focus the dialog, Tab/Shift+Tab stay trapped, Escape closes and focus returns
  to the opener (persona E asserts all four).
- **Announcements:** story panel has a polite live region (chapter/objective and
  recovery announcements); toasts are `role="status"`; blocked import/analysis
  notices are `role="alert"`/`role="note"` with descriptive labels.
- **Ranges:** scrubber/slip/duration carry `aria-label` + UTC `aria-valuetext`;
  numeric settings use labeled `NumberField`s with min/max/step/unit and
  actionable validation (v1.7, unchanged).
- **Tables/charts:** horizon table is a real `<table>`; panorama/timeline/map are
  `role="img"` with gate-aware descriptions (see fixes 1–4); comparison matrix
  rows expose per-scenario state.
- **Reduced motion:** `prefers-reduced-motion` disables ticker/spotlight/pulse
  animation (persona E asserts `transitionDuration === '0s'`); spotlight scrolling
  uses `auto` behavior.
- **Mobile/zoom-width:** 390×844 and 320×568 with no horizontal overflow; the
  briefing panel becomes a bottom sheet (`max-height: 44vh`) and fits both
  widths; collapse/expand tracks `aria-expanded`.
- **Status wording:** blocked-state descriptions unit-tested for every blocked
  `AnalysisAssessment` status; verified-DEM wording unit-tested (residual,
  coverage, LOCAL scope).

### v1.10 additions (executed in `npm run test:exports`, persona E)

- **Export announcements:** the six-item Export menu is keyboard-reachable;
  initiating an export announces "Export initiated — …. Check your browser's
  downloads to confirm the file arrived." via the `role="status"` toast — honest
  initiated semantics, never "saved". A guard refusal (blocked/stale analysis)
  announces the refusal reason instead; persona E asserts both paths.
- **Blocked-analysis notice:** `role="alert"` with the explicit status wording;
  no color-only state.
- **Comparison export policy:** `role="note"` labeled "Comparison export policy"
  beside the export buttons states that every row exports with an explicit
  resolution state and blanks are never zeros.
- **Custom-site modal labels fixed:** all fields (name, latitude, longitude,
  elevation, preset, and the 8 sector sliders) now have `htmlFor`/`id`
  association — previously the labels were visual-only and screen readers could
  not name the inputs. Found while writing the export personas; unit-visible via
  `getByLabel` in the E2E suite.
- **Session-recovery notice:** a rejected persisted session produces one explicit
  boot toast (never silent, never partial application); the briefing's
  Rebuild/Exit recovery panel is unchanged from v1.9 and still keyboard-first.
- **Mobile/reduced motion:** export menu + toasts verified at 390 px and with
  `prefers-reduced-motion` (no new animation introduced).

## 3. Known limitations (not fixed, disclosed)

- Canvas polar map and SVG charts are described, not navigable element-by-
  element; the numeric horizon table and telemetry values are the accessible
  data path.
- 3D views (Terrain Lab / Space) are visual instruments; their quantitative
  outputs are duplicated in labeled text panels. No non-visual 3D navigation is
  claimed.
- Browser zoom beyond layout-width equivalence (320px test) is not automated;
  see manual checklist item 8.
- The ticker is decorative (`aria-hidden`, pointer-events none) — intentional.

## 4. Manual screen-reader checklist — **NOT YET EXECUTED**

Run with NVDA + Firefox/Chrome (Windows) and VoiceOver + Safari (macOS/iOS).
Record pass/fail + SR/version/date in docs/verification.md when done. Until then,
no screen-reader pass is claimed.

1. **Landmarks & heading order:** navigate by landmark/heading; confirm one h1,
   panel headers reachable, story panel announced as a region with its label.
2. **Briefing journey:** start via launcher; confirm the live region announces
   chapter + objective; complete ch1 with keyboard only; confirm focus lands on
   the new chapter heading and the objective-done state is announced.
3. **Blocked-state descriptions (the v1.9 gate):** import an ME DEM, scrub to
   2040; confirm the panorama image description says visibility is BLOCKED and
   reads only sky positions; confirm the DEM footer reads the blocked status;
   confirm no "Sunlit"/"DTE open" is announced anywhere.
4. **Recovery card:** corrupt `chandra-story-session-v1` in devtools, reload,
   resume; confirm the alert is announced and Rebuild/Exit are reachable.
5. **Modals:** open Settings; confirm dialog role + label, trap, Escape, and
   focus return; repeat for horizon table (blocked epoch: "blocked" cells) and
   the custom-site modal (v1.10: every field now announces its label).
6. **Sliders:** announce label, value and UTC value-text while arrowing the
   scrubber and slip; confirm no double-announcement from the live region.
7. **Tables:** read the horizon table and comparison matrix by row/column;
   confirm headers associate; blocked scenarios announce their state.
8. **Zoom & reflow:** 200% browser zoom at 1280px and 400% at 320px equivalent;
   no loss of content or function; bottom sheet remains reachable.
9. **Toasts/alerts:** export refusal and pin-cap messages are announced once,
   not spammed. With v1.10: initiate each of the six export kinds by keyboard
   and confirm the "Export initiated" announcement names the file kind; trigger
   a blocked export and confirm the refusal reason is announced; reload with a
   corrupt session and confirm the rejection notice is announced exactly once.
10. **Reduced motion:** with OS reduce-motion on, confirm no marquee/spotlight
    movement and instant scrolling.

## 5. Method notes

- Contrast ratios computed with the WCAG relative-luminance formula from the
  actual CSS token values (not eyeballed); persona E re-measures rendered colors.
- All blocked-state label tests use the real engine assessment objects, so the
  wording cannot drift from the gate without a failing test.
- The audit deliberately did not add a second onboarding/glossary system, new
  animation, or any change to the paper-folio identity.
