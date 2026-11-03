import type { GuidedScenario } from '../types/mission';

const DEC = Date.parse('2026-12-18T00:00:00Z');

export const GUIDED_SCENARIOS: GuidedScenario[] = [
  {
    id: 'pole-vs-apollo',
    title: 'Why is the South Pole so different from Apollo 11?',
    kicker: 'Lighting geometry',
    description: 'Compare a grazing polar Sun with the high equatorial Sun, and see why Earth sits on the horizon at 89.9°S but overhead at Tranquility Base.',
    siteId: 'shackleton-rim',
    startMs: DEC,
    durationDays: 30,
    slipDays: 0,
    arrayMode: 'vertical-tracking',
    steps: [
      { title: 'Start at Shackleton Rim', body: 'The Sun never climbs more than a couple of degrees above the horizon. Crater rims can block it even when it is geometrically “up”.', action: 'panorama' },
      { title: 'Watch Earth wobble', body: 'Earth hovers near the horizon and drifts in a slow libration loop. A ridge only a few degrees high can cut the radio link for days.', action: 'panorama' },
      { title: 'Compare with Apollo 11', body: 'Open Compare and pin Apollo 11 for the same dates. Its Sun reaches overhead, and Earth stays high in the sky — no terrain-driven DTE blackouts.', action: 'compare' },
    ],
  },
  {
    id: 'launch-delay-crisis',
    title: 'The Launch Delay Crisis',
    kicker: 'Schedule slip',
    description: 'A 10-day CLPS surface mission slips by two weeks. Drag the mission window and watch the combined power + comms budget change.',
    siteId: 'de-gerlache-rim-2',
    startMs: DEC,
    durationDays: 10,
    slipDays: 14,
    arrayMode: 'vertical-tracking',
    steps: [
      { title: 'Baseline window', body: 'The green track shows when both Sun and Earth are visible. This is the only time the lander can generate power and talk to Earth directly.', action: 'slip' },
      { title: 'Slip +14 days', body: 'Drag the mission window or use the slip slider. The terrain mask stays fixed, but the Sun and Earth move — a ridge that was harmless can now block Earth.', action: 'slip' },
      { title: 'Read the verdict', body: 'Check minimum battery state-of-charge and longest combined gap. A “CONDITIONAL” verdict means the mission survives only with careful energy and comms scheduling.', action: 'slip' },
    ],
  },
  {
    id: 'vertical-panels',
    title: 'Why Vertical Solar Panels Matter at 89° South',
    kicker: 'Power geometry',
    description: 'At grazing Sun angles, a horizontal deck collects almost nothing. A vertical mast that tracks the Sun’s azimuth can collect orders of magnitude more.',
    siteId: 'shackleton-rim',
    startMs: DEC,
    durationDays: 10,
    slipDays: 0,
    arrayMode: 'horizontal',
    steps: [
      { title: 'Horizontal deck', body: 'Power scales with sin(elevation). At 1.5° elevation a horizontal panel sees only ~2.6% of the flux — often less than the lander’s idle load.', action: 'panorama' },
      { title: 'Switch to vertical mast', body: 'Open Mission Parameters and choose “Vertical mast (azimuth tracking)”. Power now scales with cos(elevation) — nearly full flux at grazing angles.', action: 'panorama' },
      { title: 'Compare the energy budget', body: 'Pin both configurations in Compare. The vertical mast can turn a survival-risk mission into a nominal one without moving the lander.', action: 'compare' },
    ],
  },
  {
    id: 'terrain-lab',
    title: 'From DEM to Horizon Mask',
    kicker: 'Terrain Lab',
    description: 'Use the ported 3D terrain inspector to build a local elevation model, ray-march its horizon, and send that mask into the mission planner.',
    siteId: 'shackleton-rim',
    startMs: DEC,
    durationDays: 10,
    slipDays: 0,
    arrayMode: 'vertical-tracking',
    steps: [
      { title: 'Open Terrain Lab', body: 'Press T or use the header button. The lab starts in a clearly labeled synthetic demo. Choose “Real lunar DEM” only after configuring a local DEM backend.', action: 'terrain' },
      { title: 'Inspect the surface', body: 'Drag to orbit, scroll to zoom, and click the mesh to pin a sample. The inspector reports east/north position, elevation, distance, and latitude/longitude.', action: 'terrain' },
      { title: 'Compute the horizon', body: 'Press “Compute 360° horizon”. The tool ray-marches the loaded grid and reports coverage. NoData rays are flagged, never filled with invented terrain.', action: 'terrain' },
      { title: 'Send it to the mission planner', body: '“Use in mission” creates a custom site with the DEM-derived mask. Check the source frame warning: DEM MOON_ME/DE421 and the IAU ephemeris frame must be reconciled before operational use.', action: 'terrain' },
    ],
  },
];

export const GLOSSARY: { term: string; definition: string }[] = [
  { term: 'DTE', definition: 'Direct-to-Earth. A radio link that does not need a relay satellite. Requires Earth to be above the local terrain horizon.' },
  { term: 'LOS / AOS', definition: 'Loss of Signal / Acquisition of Signal. The moments Earth sets behind terrain or rises above it.' },
  { term: 'Libration', definition: 'The Moon’s slow wobble. From the surface, Earth traces a small loop in the sky over ~27.3 days, moving ±6.7° in latitude and ±7.9° in longitude.' },
  { term: 'Horizon mask', definition: 'A 360° profile of terrain elevation angle. An object is visible only if its elevation exceeds the mask at that azimuth.' },
  { term: 'Cosine loss', definition: 'Solar output scales with the cosine of the angle between sunlight and the panel normal. Grazing light punishes horizontal panels.' },
  { term: 'Synodic day', definition: 'The ~29.53 Earth-day cycle from one lunar noon to the next. At the pole the Sun circles the horizon instead of rising high.' },
  { term: 'MJD', definition: 'Modified Julian Date. A continuous day count used in ephemeris and mission operations.' },
  { term: 'PSR', definition: 'Permanently Shadowed Region. Terrain that never receives direct sunlight — a cold trap for water ice.' },
];
