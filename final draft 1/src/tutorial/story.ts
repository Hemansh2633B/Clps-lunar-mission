/**
 * THE 14-DAY WINDOW — chapter definitions for the interactive mission briefing.
 *
 * This file holds ONLY static story structure: scenes, character intros, objectives,
 * spotlight targets, knowledge checks and go-deeper references. Every live number the
 * story tells comes from `narrative.ts`, which reads the same engine results the
 * instruments display — the story never invents telemetry.
 *
 * Mira (ops lead) and Dr. Arin (science specialist) are fictional characters. The
 * training mission is illustrative; it is not an actual Artemis or CLPS flight plan.
 */

export type Speaker = 'MIRA' | 'ARIN';

export interface DialogueLine {
  speaker: Speaker;
  text: string;
}

export const CHARACTERS: Record<Speaker, { name: string; role: string; initial: string }> = {
  MIRA: { name: 'Mira', role: 'Operations lead (fictional)', initial: 'M' },
  ARIN: { name: 'Dr. Arin', role: 'Science specialist (fictional)', initial: 'A' },
};

export const FICTION_NOTICE =
  'A fictional training exercise. Mira and Dr. Arin are invented characters, the scenario is illustrative, and it is not an actual Artemis or CLPS flight plan. Every number you see is computed live by CHANDRA.';

/** What real app-state change completes a chapter's objective. */
export type ObjectiveKind =
  | 'choice'          // ch0: user picks training demo vs explore
  | 'site-selected'   // ch1: catalogue selection changed (or explicitly kept)
  | 'time-scrubbed'   // ch2: timeMs moved
  | 'earth-inspected' // ch3: timeMs moved again while Earth readouts shown
  | 'config-changed'  // ch4: any mission-config change via real settings
  | 'slip-changed'    // ch5: slipDays changed via the real slider
  | 'read-telemetry'  // ch6: knowledge check answered after inspecting the rail
  | 'compared'        // ch7: ≥2 pinned scenarios and comparison view open
  | 'exported';       // ch8: a real, guard-passing export succeeded

export interface KnowledgeCheck {
  question: string;
  options: string[];
  /** Index into options. */
  correct: number;
  /** Shown for both right and wrong answers — the teaching point. */
  why: string;
}

export interface StoryChapter {
  id: number;
  stamp: string;
  title: string;
  /** Field-journal scene setter, one line. */
  scene: string;
  intro: DialogueLine[];
  objective: string;
  /** data-tour key of the REAL control to spotlight (null = no spotlight). */
  target: string | null;
  /** View that must be active before the target exists. */
  view: 'planner' | 'compare' | null;
  completion: ObjectiveKind;
  /** Primary button drives a REAL app control/handler (never a fake interaction). */
  primary?: { label: string; action: 'focus' | 'settings' | 'pin' | 'export' };
  check?: KnowledgeCheck;
  deeper: { glossaryIds: string[]; text: string };
}

export const STORY_CHAPTERS: StoryChapter[] = [
  {
    id: 0,
    stamp: 'CH 00',
    title: 'First shift',
    scene: 'Shift one. The ops room is quiet: two desks, one solver, and a launch date that refuses to sit still.',
    intro: [
      { speaker: 'MIRA', text: 'Welcome aboard, analyst. Our lander is headed for the lunar south pole, and the launch may slip by two weeks. Your job: tell us what that does to sunlight, Earth contact and stored energy — and file a planning report we can trust.' },
      { speaker: 'ARIN', text: 'CHANDRA answers three questions for any site and window: does the Sun clear the terrain, does Earth clear the terrain, and does the energy budget close? The story never invents numbers — everything you read comes from the live solver.' },
      { speaker: 'MIRA', text: FICTION_NOTICE },
    ],
    objective: 'Choose how to begin. The training mission uses clearly-labeled illustrative terrain — no real DEM download is forced on you.',
    target: null,
    view: null,
    completion: 'choice',
    deeper: {
      glossaryIds: ['illumination', 'dte', 'soc'],
      text: 'Sunlight availability is geometric: the Sun above the modeled terrain horizon. Earth line-of-sight is also geometric — not an RF link budget. The battery is an energy-balance model — not thermal or spacecraft survival. Those three separations are the spine of this whole briefing.',
    },
  },
  {
    id: 1,
    stamp: 'CH 01',
    title: 'Pick the ground',
    scene: 'The catalogue is pinned open. Every entry carries coordinates, terrain and a provenance note.',
    intro: [
      { speaker: 'MIRA', text: 'Everything downstream depends on where we stand. Pick a region in the site catalogue on the left — or keep the current one if you already have a favorite.' },
      { speaker: 'ARIN', text: 'Read the provenance line before you trust a pin on the map. Artemis entries are approximate region centers from the 2024 downselection, not surveyed landing points — and that 2024 list is not an Artemis IV selection. Apollo and Chang’e coordinates are surveyed references.' },
    ],
    objective: 'Select a site in the catalogue (any region), or confirm the current one with “Use this region”.',
    target: 'catalog',
    view: 'planner',
    completion: 'site-selected',
    primary: { label: 'Open the catalogue', action: 'focus' },
    check: {
      question: 'The Artemis entries in this catalogue are…',
      options: [
        'Precise, surveyed landing coordinates',
        'Approximate region centers — not landing points, and not an Artemis IV selection',
        'Random points with no source',
      ],
      correct: 1,
      why: 'NASA’s 2024 downselection named ~15×15 km regions without publishing precise coordinates. CHANDRA marks these as region-approximate (±0.5°) with a dated source, so the app is never more precise than the data.',
    },
    deeper: {
      glossaryIds: ['horizon-mask', 'frame-residual'],
      text: 'A site is more than a dot: it carries a 360° horizon mask (the terrain skyline), an eye height, and a data-confidence tier. Measured data outranks region-approximate, which outranks illustrative, which outranks synthetic — and the tier travels with every result and export.',
    },
  },
  {
    id: 2,
    stamp: 'CH 02',
    title: 'Follow the Sun',
    scene: 'On the panorama the Sun crawls along the skyline. At the pole it never climbs — it circles.',
    intro: [
      { speaker: 'ARIN', text: 'Down here sunlight arrives sideways. The Sun’s elevation tells you how high it sits; its azimuth tells you which way to face. Whether it is actually visible depends on the terrain mask in that exact direction.' },
      { speaker: 'MIRA', text: 'Grab the time scrubber below the panorama — or press the arrow keys — and watch the Sun readouts change. The little event markers are refined horizon crossings, not guesses between samples.' },
    ],
    objective: 'Scrub time (drag the scrubber or press ← / →) and watch the Sun readout respond.',
    target: 'scrubber',
    view: 'planner',
    completion: 'time-scrubbed',
    primary: { label: 'Focus the time scrubber', action: 'focus' },
    check: {
      question: 'Near the lunar south pole, the Sun…',
      options: [
        'Circles close to the horizon, so terrain decides everything',
        'Climbs high overhead at local noon',
        'Stays motionless in the sky',
      ],
      correct: 0,
      why: 'The Moon’s spin axis is tilted only ~1.54°, so polar sunlight stays within a few degrees of the horizon and sweeps around it over the ~29.5-day synodic cycle. A ridge a few degrees high can shadow a site for days.',
    },
    deeper: {
      glossaryIds: ['sun-elevation', 'sun-azimuth', 'synodic-day', 'cosine-loss'],
      text: 'Elevation and azimuth come from the topocentric Sun direction in the IAU 2015 Moon frame (light-time corrected, no refraction — there is no air). Visibility compares that elevation against the horizon mask at the Sun’s azimuth; crossings are refined adaptively instead of being read off coarse samples.',
    },
  },
  {
    id: 3,
    stamp: 'CH 03',
    title: 'Find Earth',
    scene: 'Earth hangs low over the rim, tracing a slow loop as the Moon wobbles beneath it.',
    intro: [
      { speaker: 'ARIN', text: 'From the Moon, Earth barely moves — but libration, the Moon’s slow apparent wobble, drags the sub-Earth point a few degrees around the sky. Near the pole that small loop is the difference between clearing a rim and hiding behind it.' },
      { speaker: 'MIRA', text: 'Scrub time again and watch Earth’s elevation and the DTE percentage. And say it with me: geometric Earth line-of-sight is NOT an RF link budget. It tells us Earth clears the terrain — nothing about antennas, power or data rates.' },
    ],
    objective: 'Scrub time again and watch the Earth elevation / DTE readouts change.',
    target: 'scrubber',
    view: 'planner',
    completion: 'earth-inspected',
    primary: { label: 'Focus the time scrubber', action: 'focus' },
    check: {
      question: 'Geometric Earth line-of-sight tells you…',
      options: [
        'That the radio link will work at a known data rate',
        'Whether Earth clears the terrain — not whether a radio link works',
        'How strong the received signal will be',
      ],
      correct: 1,
      why: 'CHANDRA computes pure geometry: Earth’s center-of-disk direction versus the terrain mask (plus your clearance margin). Antenna gain, transmit power, pointing and coding are a separate RF link budget that this tool does not model.',
    },
    deeper: {
      glossaryIds: ['libration', 'earth-elevation', 'aos-los', 'dte'],
      text: 'The sub-Earth point is where Earth sits at the zenith on the Moon; optical libration moves it ±~6.7° in latitude and ±~7.9° in longitude. LOS/AOS events here are refined geometric crossings of the terrain skyline — acquisition and loss of geometric sight, not measured signal events.',
    },
  },
  {
    id: 4,
    stamp: 'CH 04',
    title: 'Budget the power',
    scene: 'Dr. Arin slides a spec sheet across the desk. Every line on it is an assumption, not hardware.',
    intro: [
      { speaker: 'ARIN', text: 'Solar power is flux × area × efficiency × derating × incidence. At the pole the incidence term is brutal for flat panels: grazing light barely registers. A vertical panel that faces the Sun trades that sine for a cosine.' },
      { speaker: 'MIRA', text: 'Open Mission settings and change one assumption — try a preset, or the array area, or the load. The presets are illustrative planning assumptions, not NASA vehicle specs. Watch the watts respond, and remember: power is a rate, energy is that rate accumulated over time.' },
    ],
    objective: 'Open Mission settings and change at least one power assumption (preset, area, efficiency, load…).',
    target: 'settings',
    view: 'planner',
    completion: 'config-changed',
    primary: { label: 'Open Mission settings', action: 'settings' },
    check: {
      question: 'Under identical sunlight, doubling the array area…',
      options: [
        'Roughly doubles the generated power',
        'Doubles the battery capacity',
        'Guarantees the lander survives the night',
      ],
      correct: 0,
      why: 'Generated power scales linearly with area in this model. Battery capacity is a separate assumption, and “survival” involves thermal, radiation and hardware behavior that an energy-balance model does not cover.',
    },
    deeper: {
      glossaryIds: ['solar-flux', 'cosine-loss', 'soc'],
      text: 'Flux is 1361/au² W/m² at the Moon’s distance. Horizontal panels collect flux·sin(elevation); a Sun-tracking vertical panel collects flux·cos(elevation) — near the horizon that is the whole game. Efficiency, system derating and incidence are all disclosed assumptions in the report.',
    },
  },
  {
    id: 5,
    stamp: 'CH 05',
    title: 'The slip',
    scene: 'The call comes in: launch may slide fourteen days. The terrain stays put. The sky does not.',
    intro: [
      { speaker: 'MIRA', text: 'This is the moment the briefing is named for. A slip moves our whole window along the Sun’s slow march around the horizon — about half a circle in fourteen days. Ridges that were harmless can end up dead ahead.' },
      { speaker: 'ARIN', text: 'Use the launch-slip slider — try +14 days. The scrubber shows the baseline window and the slipped window side by side, and I will read you the actual difference the solver computes. Better or worse, we report what the model says.' },
    ],
    objective: 'Move the launch-slip slider (try +14 d) and compare the slipped window against the baseline.',
    target: 'slip',
    view: 'planner',
    completion: 'slip-changed',
    primary: { label: 'Focus the slip slider', action: 'focus' },
    check: {
      question: 'A launch slip changes…',
      options: [
        'The terrain mask around the lander',
        'Where the Sun and Earth are in the sky during the mission window',
        'The solar constant',
      ],
      correct: 1,
      why: 'The terrain is fixed; the ephemeris is not. Sliding the window changes which solar azimuths and which libration phase you live through, so illumination, Earth visibility and their overlap all shift.',
    },
    deeper: {
      glossaryIds: ['synodic-day', 'combined'],
      text: 'Solar azimuth advances ≈0.51°/h, so +14 days ≈ +171° around the horizon. The combined metric is the intersection of Sun-visible and Earth-visible intervals — the overlap, computed from refined crossings, not from decorative tracks.',
    },
  },
  {
    id: 6,
    stamp: 'CH 06',
    title: 'Read the battery report',
    scene: 'The telemetry rail prints its verdict. Time to read it like an analyst, not a headline.',
    intro: [
      { speaker: 'ARIN', text: 'The battery model integrates generated minus consumed energy, with charge and discharge efficiencies and your initial state-of-charge assumption. I will read you the live totals for this window.' },
      { speaker: 'MIRA', text: 'If the verdict says ENERGY DEFICIT, it means the modeled battery hits zero under these assumptions — not that the lander freezes. Thermal behavior, radiation and hardware limits are not modeled, and we will never pretend otherwise.' },
    ],
    objective: 'Inspect Power & battery in the telemetry rail, then answer the check below.',
    target: 'telemetry',
    view: 'planner',
    completion: 'read-telemetry',
    primary: { label: 'Show the battery report', action: 'focus' },
    check: {
      question: 'An ENERGY DEFICIT verdict means…',
      options: [
        'The lander will physically freeze and fail',
        'The modeled battery reaches 0% under these assumptions — thermal survival is not modeled',
        'The mission is impossible under any configuration',
      ],
      correct: 1,
      why: 'It is an energy-balance result: generation minus load, integrated with efficiencies. More area, less load or a different window can close the deficit. Whether hardware survives the cold is a separate thermal analysis.',
    },
    deeper: {
      glossaryIds: ['soc', 'energy-deficit'],
      text: 'State of charge is stored energy over capacity, bounded to [0, 100%], integrated with 92% charge / 95% discharge efficiency from your initial SOC. The deficit counts hours at 0%. Every one of those assumptions is listed in the exported report.',
    },
  },
  {
    id: 7,
    stamp: 'CH 07',
    title: 'Compare like with like',
    scene: 'Two windows on one sheet. The comparison matrix does not care which one you were rooting for.',
    intro: [
      { speaker: 'MIRA', text: 'Pin this window, then change one thing — slip back to zero is a good test — and pin again. The comparison matrix lines the windows up under the same assumptions so the difference means something.' },
      { speaker: 'ARIN', text: 'Two rules. Keep every assumption except the one you are testing identical. And watch the confidence tiers: an illustrative mask never outranks measured data just because it scores higher. The feasibility score is our own heuristic, not a NASA methodology.' },
    ],
    objective: 'Create at least two different scenarios in this briefing (change one assumption — e.g. the slip — between pins), let both resolve, and inspect a meaningful difference in the comparison matrix.',
    target: 'compare',
    view: 'compare',
    completion: 'compared',
    primary: { label: 'Pin this window & compare', action: 'pin' },
    check: {
      question: 'A fair comparison keeps…',
      options: [
        'Every assumption identical except the one being tested',
        'As many differences as possible',
        'Only the best-looking result',
      ],
      correct: 0,
      why: 'Change one variable at a time — here, the slip — so the delta is attributable. And compare confidence tiers before scores: measured > region-approximate > illustrative > synthetic.',
    },
    deeper: {
      glossaryIds: ['score', 'sampling'],
      text: 'The score blends combined visibility (45%), illumination (20%), Earth visibility (15%) and energy margin (20%) — an application-defined heuristic, disclosed in every export. Sampling metadata travels with each scenario so differences are not artifacts of a coarser step.',
    },
  },
  {
    id: 8,
    stamp: 'CH 08',
    title: 'File the report',
    scene: 'Last page of the shift log. A result that cannot be reproduced is just a rumor.',
    intro: [
      { speaker: 'MIRA', text: 'Export the mission report with the real export control. It carries the site and its provenance, every configuration assumption, the sampling actually used, the verdict with its reason, and the model limitations.' },
      { speaker: 'ARIN', text: 'If the analysis is blocked — an unverified frame, incomplete coverage — the export guard refuses, and so do we. No verdict, no report, no invented numbers. Resolve the flag or return to a valid region first.' },
    ],
    objective: 'Export the mission report (.json) using the real export control. Blocked analyses cannot be exported — that is the point.',
    target: 'export',
    view: 'planner',
    completion: 'exported',
    primary: { label: 'Export mission report (.json)', action: 'export' },
    deeper: {
      glossaryIds: ['sampling', 'frame-residual'],
      text: 'The JSON report includes the effective sampling step and sample count (with the 20,000-sample cap disclosed), the frame verification state and residual, the data-confidence tier, and the full config — enough for someone else to reproduce your window exactly.',
    },
  },
];

export const LAST_CHAPTER = STORY_CHAPTERS.length - 1;

export const DEBRIEF = {
  title: 'Shift complete',
  lines: [
    { speaker: 'MIRA', text: 'Report filed. You joined with a launch date and left with a defensible window — sunlight, Earth geometry and an honest energy budget, all traceable to the solver.' },
    { speaker: 'ARIN', text: 'Keep the separations in your head: geometry is not radio performance, energy balance is not survival, and a heuristic score is not a ranking authority. That is how planning reports stay honest.' },
  ] as DialogueLine[],
};
