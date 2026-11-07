# Implementation report · v1.8 — THE 14-DAY WINDOW

**Branch:** `arena/c8be366b-clps-lunar-mission` (from merged v1.7 `main` @ `182a4fc`)
**Scope:** an interactive storytelling tutorial that teaches CHANDRA by driving the real
planner, plus repairs to the existing educational content and one blocked-analysis leak.

---

## 1. What was built

### The briefing (chapters 0–8, ~10–15 min)

The user joins a **fictional** mission team as the new analyst. **Mira** (operations
lead) and **Dr. Arin** (science specialist) are invented characters; the scenario is
disclosed as illustrative in chapter 0 and in the panel's mission-log line — never an
actual Artemis/CLPS flight plan. Every number in the dialogue is computed live.

| Ch | Title | Real interaction (completion witness) |
|---|---|---|
| 0 | First shift | Choose *Start the training mission* (explicit notice + snapshot first) or *Explore first* (no state change) |
| 1 | Pick the ground | Select a site in the real catalogue (or explicitly keep the current region); provenance + region-center vs surveyed-point teaching |
| 2 | Follow the Sun | Scrub the real time slider (≥30 min movement); live elevation/azimuth/clearance + illumination |
| 3 | Find Earth | Scrub again; live Earth elevation, sub-Earth point, DTE %; prominent "geometric LOS is NOT an RF link budget" |
| 4 | Budget the power | Open real Mission settings; any config change (preset experiment); presets disclosed as illustrative, not NASA specs |
| 5 | The slip | Move the real launch-slip slider; narrative reads the actual baseline-vs-slipped delta (better / worse / similar / computing / blocked) |
| 6 | Read the battery report | Inspect the telemetry rail + answer the check; generated/consumed/SOC/deficit from the live summary; energy ≠ survival |
| 7 | Compare like with like | Pin ≥2 real scenarios (slip change between pins) with the comparison view open; confidence tiers + heuristic disclosure |
| 8 | File the report | A real, guard-passing JSON export (counter witness); blocked analyses cannot finish via export |

Each chapter has a scene, dialogue, objective, live readouts, a knowledge check
(chapters 1–7), and *Go deeper* formal definitions deep-linked to the canonical
glossary. Debrief offers Replay / Explore / Glossary / Terrain Lab.

### Architecture (no duplicate tutorial system)

- `src/tutorial/story.ts` — static chapter structure only (no mission numbers).
- `src/tutorial/narrative.ts` — pure `(chapter, live world) → dialogue + readouts`;
  reuses `explain.ts` and the discriminated `AnalysisAssessment`. Blocked ⇒ reason +
  resolution, **no verdict**.
- `src/tutorial/progress.ts` — immutable state machine; versioned key
  `chandra-story-v1`; corrupt/foreign payloads ⇒ fresh, never a crash; returning users
  are never re-suggested.
- `src/tutorial/useStoryTutorial.ts` — React binding; objectives complete only from
  real app-state witnesses (selection, time, config, slip, pins, export counter).
- `src/tutorial/StoryTutorial.tsx` — compact docked panel (mobile bottom sheet),
  chapter stamps, mission-log UTC, initial-avatar dialogue cards (restrained, no fake
  photos), non-blocking `pointer-events:none` spotlight on real `data-tour` controls,
  focus management, `aria-live` chapter announcements, `prefers-reduced-motion`.
- Entry points: dismissible post-onboarding suggestion, workspace launcher, Field
  Guide card (start/resume/restart). Pause keeps place + training mission; **Exit
  restores the pre-briefing snapshot** (site/date/slip/config/view/mode). `Esc` pauses
  when no overlay is open. The existing Onboarding / WorkflowGuide / EducatorOverlay /
  glossary are reused, not duplicated.

### Educational-content repairs (audit-driven)

- `guidedScenarios.ts`: "survival-risk" → ENERGY DEFICIT; "cut the radio link" →
  geometric DTE window; "mission survives" → energy-balance statement; the false
  "only time the lander can generate power **and** talk to Earth" claim corrected
  (power needs Sun only; DTE needs Earth only; green = both); stale pre-allowlist
  frame text → allowlist + rotation + gating; **unused legacy `GLOSSARY` export
  deleted** after merging its unique terms.
- `glossary.ts`: 16 → **22 entries** (horizon mask, LOS/AOS, cosine loss, synodic day,
  MJD, PSR) in the canonical plain+technical format.
- `EducatorOverlay.tsx`: "freeze your lander in permanent shadow" hyperbole removed;
  libration FAQ reframed from "the radio" to Earth visibility; far-side answer reports
  geometry, not radio performance; "most of the way around" → "about halfway"
  (0.51°/h × 336 h ≈ 171°); DEM FAQ now states the allowlist behavior.
- `TelemetryPanel.tsx`: ambiguous "LOS" badge → "Earth blocked"; "radio passes" →
  "Earth-visibility passes". `powerComms.ts`: internal `survivalScore` →
  `energyMarginScore` (no behavior change).

### Defect fix: instantaneous visibility gate

Persona D exposed a pre-existing leak: with an ME-frame DEM site at epoch 2040
(outside the SPICE-validated 2020–2035 range), the window analysis was correctly
blocked but the instantaneous chips still claimed "Window viable" / "Sunlit" /
"DTE open". `App` now assesses `assessTerrainEligibility(site, timeMs, timeMs)` and
passes `visibilityBlocked` to the telemetry header/body, panorama chips + marker
styling, and site-brief clearance values. Sky positions (pure ephemeris) stay visible;
terrain-visibility claims are replaced by explicit blocked labels. See
SCIENTIFIC_METHOD §11.

---

## 2. Verification (all executed in this sandbox)

| Suite | Result |
|---|---|
| `tsc` typecheck | clean |
| `npm test` | **192 passed / 20 files** (151 existing + 41 new story tests) |
| `npm run test:python` | **92 passed, 4 skipped** (SPICE-kernel-gated — skipped, never passed) |
| `npm run test:geometry` | passed |
| `npm run test:parity` | passed |
| `npm run build` | clean, ~5.5 s |
| `npm run test:browser` (existing full E2E) | passed ~175 s incl. multi-TZ — no regressions |
| `npm run test:story` (new, personas A–E) | **passed ~256 s** |
| CI | story E2E step added to the browser job (first GH-runner run pending) |

Persona coverage: **A** beginner full run to a real exported report and 9/9 debrief;
**B** student Go-deeper/glossary round-trip without progress loss, keyboard scrubbing,
Escape-pause, explore-first state preservation; **C** returning user never forced or
re-suggested, resume/restart/reload; **D** invalid data — real Terrain Lab import of an
ME-frame DEM (API payload stubbed; conversion/gating live) + epoch 2040 ⇒ blocked
narrative, gated instruments, refused export (no download, objective not credited),
unknown-frame import disabled with alert; **E** mobile 390×844 — no overflow,
collapse/expand, real interactions, reduced-motion ⇒ 0 s spotlight transition.

Screenshots: `screenshots/15…22-story-*.png` (desktop + mobile). 7 of 8 captured; the
ch5 slip capture timed out under SwiftShader while workers were computing (best-effort
capture; the ch5 state assertions passed).

## 3. Honest limitations

1. **Persona D DEM payloads are stubbed at the network boundary** (NASA downloads are
   unavailable in CI). Everything downstream — frame classification, ME→IAU conversion,
   import gating, analysis status, narrative, export guard — runs live.
2. FRAME_UNVERIFIED / INCOMPLETE_COVERAGE are unreachable through the planner UI
   (the Terrain Lab import gate fires first); their narrative branches are unit-tested
   (5 blocked statuses × 7 chapters), not browser-tested.
3. Sparticuz single-process Chromium shares localStorage across contexts and stalls
   some screenshots mid-compute; the suite seeds storage once per tab via a
   sessionStorage marker and treats captures as best-effort. Assertions are the
   verification.
4. Characters use initial avatars, not portraits — deliberate restraint so fictional
   people are never mistaken for real personnel.
5. The ch6 witness is the knowledge check after inspecting the rail (reading cannot be
   observed directly); all other chapters witness real state changes.
6. CI story step has not yet run on a GitHub-hosted runner (merge will trigger it).
7. The 4 SPICE-kernel Python tests remain skipped in ordinary runs (kernels not
   fetched); the optional CI job runs them for real.

## 4. Follow-ups

- Watch the first GH-runner execution of the story E2E step.
- Consider a ch5 screenshot retry strategy that pauses workers before capture.
- Possible future: narrate comparison-matrix deltas directly in ch7 (currently the
  matrix itself shows them; the story guides the reading).
