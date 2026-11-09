# Manual screen-reader protocol · CHANDRA

**Execution status: NOT EXECUTED.** No NVDA or VoiceOver run has been performed
in this environment. Automated Playwright `aria-label` assertions and Vitest
wording tests are **not** a screen-reader pass. Record a result below only after
running the step with the named assistive technology; otherwise leave it
`NOT RUN` / `NOT OBSERVED`.

Linked from [accessibility.md](accessibility.md). The protocol covers the
current workspace (v1.11) and marks future landing-page steps as **not yet
implemented**.

---

## 1. Recording template

Copy one block per environment. Do not fill versions/dates/pass-fail from
assumption.

```text
Date (UTC):
Tester:
OS + version:
Browser + version:
Screen reader + version:
CHANDRA commit / APP_VERSION:
Route / build (dev, static preview, deployed URL):
Result: PASS / FAIL / PARTIAL / NOT RUN
Failures (step id, observed announcement, expected announcement, severity):
Artifacts (audio/log/screenshot paths, if any):
```

Target environments:

| ID | Screen reader | Browser | OS |
|---|---|---|---|
| NVDA-FF | NVDA | Firefox | Windows 10/11 |
| NVDA-CH | NVDA | Chrome | Windows 10/11 |
| VO-MAC | VoiceOver | Safari | macOS |
| VO-IOS | VoiceOver | Safari | iOS/iPadOS |

Minimum useful evidence: NVDA-FF or NVDA-CH **and** VO-MAC. VO-IOS is valuable
for the mobile reader layout but does not replace desktop.

---

## 2. Setup

1. Build or run the dev stack from the repository root. Record the exact URL.
2. Clear `chandra-story-session-v1`, `chandra-story-v1` and first-run keys for a
   clean first visit; keep a second profile with a valid briefing session for
   resume/recovery steps.
3. Enable the screen reader's speech viewer or logging if available. Do not
   record audio containing unrelated personal data.
4. Use keyboard only unless a step explicitly tests touch. Disable browser
   extensions that rewrite the page.

---

## 3. Current workspace steps and expected results

### SR-01 · Landmarks and heading order

Action: navigate by landmark and heading from the top of the workspace.

Expected: one primary heading/wordmark region; site rail, center instruments,
telemetry rail and story panel (when open) are reachable as labeled
regions/landmarks; panel headings are in a logical order; the decorative ticker
is not announced.

Fail if: multiple unlabeled regions trap navigation, heading order skips levels
without structure, or the ticker is read as content.

### SR-02 · First-run / welcome choice

Action: open Help → welcome guide; tab through the demo and real-DEM choices.

Expected: dialog role and title announced; focus trapped; Escape closes and
returns focus; demo choice announces **illustrative terrain**, real-DEM choice
announces that no DEM is configured when applicable. “Skip for now” is reachable.

Note: the proposed non-modal Start panel in `product-design.md` is not shipped;
when it lands, add a step confirming it is a region, not a modal trap.

### SR-03 · Site selection and first result

Action: choose a catalogue site by keyboard; wait for the worker result.

Expected: site name and confidence tier are announced; progress is polite and
not spammed; the resolved telemetry summary and verdict are readable; demo /
illustrative labels remain present. Blocked sites announce the blocked reason
instead of numeric visibility verdicts.

### SR-04 · Time scrubber and playback

Action: focus the mission scrubber; arrow through time; toggle playback.

Expected: slider label, value and UTC value-text announced; no double
announcement from a live region on every arrow key; playback state change is
announced once.

### SR-05 · Blocked-state chart descriptions

Action: import/select an ME-DEM scenario and scrub to epoch 2040 (or use the
persona D fixture path). Read the panorama, timeline and polar-map descriptions.

Expected: panorama says visibility is **BLOCKED** and reads sky positions only;
timeline names the blocked status/reason; polar map flags azimuth-only / LOS
unverified; no “Sunlit”, “DTE open” or clearance percentage is announced.

### SR-06 · Horizon table at a blocked epoch

Action: open the horizon table; read cells; attempt CSV.

Expected: clearance cells read “blocked”; explanatory note is present; CSV
button is disabled and its disabled state is announced.

### SR-07 · Settings and custom-site modals

Action: open Mission parameters; tab through fields; Escape. Open custom-site
modal; read each field label; Escape.

Expected: dialog role + label; focus trap and return; every input announces its
label and units; clamped/out-of-range notices are readable; no unlabeled icon
buttons.

### SR-08 · Comparison matrix

Action: pin a valid and a blocked scenario; open Compare; read the matrix by
row/column; export comparison CSV/JSON if permitted.

Expected: headers associate with cells; blocked/stale/computing rows announce
their explicit state; blank numeric cells are not read as zero; export-policy
note is reachable; ranking/heuristic disclosure is announced.

### SR-09 · Export initiation and refusal

Action: keyboard-initiate each of the six export kinds on a valid analysis;
then attempt a blocked export.

Expected: `role="status"` announces “Export initiated — … Check your browser's
downloads to confirm the file arrived.” once per action; blocked export
announces the refusal reason via an alert/status; no claim that the file was
“saved”. The toast has a reachable **Dismiss notice** button (v1.11).

### SR-10 · Session rejection: corrupt / out-of-range

Action: in devtools set `chandra-story-session-v1` to `{bad`, reload; repeat
with a valid-shaped payload whose `config.durationDays = 200`.

Expected: a persistent notice says the saved briefing could not be restored and
failed validation; nothing is partially applied; briefing recovery offers
**Rebuild / Exit**; the notice can be dismissed by keyboard and is announced
once, not auto-vanishing after 2.6 s.

### SR-11 · Session rejection: oversized payload (v1.11)

Action: in devtools run:

```js
localStorage.setItem('chandra-story-session-v1', 'x'.repeat(800001));
localStorage.setItem('chandra-story-v1', JSON.stringify({
  v: 1, status: 'paused', chapter: 5, completed: [0,1,2,3,4],
  answers: {}, suggestionDismissed: true
}));
location.reload();
```

Expected: notice includes “too large to restore safely”, the 800,000-character
limit, “Nothing was applied”, and Rebuild / Exit; the payload is cleared; the
workspace is unchanged; Dismiss is keyboard-reachable. Record the exact
announcement, not just the visible text.

### SR-12 · Coarse energy-integration warning (v1.11)

Action: produce or load an analysis whose export reports
`integration_resolution = coarse` / `ENERGY_RESOLUTION_COARSE`. If no coarse
result can be produced with supported inputs, record **NOT OBSERVED** — do not
mark this pass from unit tests alone.

Expected: telemetry and comparison cards contain a persistent note labeled
“Energy integration resolution warning”; it names the ≥1% threshold, the
Richardson estimate as **not a confidence interval**, possible shifts in energy
totals/SOC/deficit hours, that export remains available, and that thermal/
radiation survival is not modeled. The timeline description includes the same
warning code. The note is not an auto-dismissing toast.

### SR-13 · Terrain Lab and Space views

Action: open Terrain Lab; read the data-status note, mode selector and import
gate. Open Space; read the planet/fleet labels.

Expected: synthetic/demo banner is announced; real-mode no-DEM error is
actionable; unknown-frame import refusal names the frame and allowlist; 3D
canvas is not claimed to be non-visually navigable; quantitative outputs are
available in labeled text panels.

### SR-14 · Mobile reflow and zoom

Action: 390 px viewport (or iOS); 200% zoom at 1280 px and 400% at 320 px
equivalent; navigate rails/tabs, scrubber, export menu and recovery notice.

Expected: no loss of content/function; bottom sheet/stacked panels reachable;
touch targets usable; toast does not cover the only action; no horizontal
scroll trap.

### SR-15 · Reduced motion

Action: enable OS reduced motion; reload; open briefing and charts.

Expected: no marquee/spotlight movement; scrolling is instant; no information
is conveyed by motion alone.

---

## 4. Future landing-page steps (not yet implemented)

Add these only after the landing route ships:

- LP-01: one h1, skip link, CTA order, diagram text alternative + ordered list.
- LP-02: “Launch Workspace” navigates and announces the new page/region; focus
  is not lost.
- LP-03: demo entry card announces **illustrative** before activation.
- LP-04: footer version/schema/“Not flight software” reachable; no endorsement
  claims.
- LP-05: 390 px and reduced-motion landing has no horizontal scroll or animation.

---

## 5. Honesty rules for recording

- `PASS` means the expected announcement/behavior was observed in the named
  environment on the named date.
- `NOT OBSERVED` means the state could not be produced; it is not a pass.
- `NOT RUN` means the step was skipped; it is not a pass.
- A failing automated label test is a defect even if no screen reader is
  available; a passing automated label test is not a screen-reader pass.
- Update `docs/verification.md` with the executed environments and failures.
  Do not summarize partial execution as “accessibility verified”.
