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
      { title: 'Watch Earth wobble', body: 'Earth hovers near the horizon and drifts in a slow libration loop. A ridge only a few degrees high can close the geometric Direct-to-Earth window for days — line-of-sight geometry, not a radio-link prediction.', action: 'panorama' },
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
      { title: 'Baseline window', body: 'The green track shows when both Sun and Earth are visible. Power needs only the Sun; direct-to-Earth needs only Earth clearance. Green marks when both hold at once.', action: 'slip' },
      { title: 'Slip +14 days', body: 'Drag the mission window or use the slip slider. The terrain mask stays fixed, but the Sun and Earth move — a ridge that was harmless can now block Earth.', action: 'slip' },
      { title: 'Read the verdict', body: 'Check minimum battery state-of-charge and longest combined gap. A “CONDITIONAL” verdict means the window works only with stored-energy management and scheduled Earth-visibility passes — an energy-balance statement, not a survival prediction.', action: 'slip' },
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
      { title: 'Compare the energy budget', body: 'Pin both configurations in Compare. The vertical mast can turn an ENERGY DEFICIT window into a NOMINAL one without moving the lander.', action: 'compare' },
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
      { title: 'Send it to the mission planner', body: '“Use in mission” creates a custom site with the DEM-derived mask. Check the frame gate: allowlisted frames (MOON_ME / MOON_PA · DE421, IAU 2015) are rotated into the ephemeris frame with a disclosed residual; unknown frames are blocked from quantitative mission use, and incomplete coverage is flagged.', action: 'terrain' },
    ],
  },
];
