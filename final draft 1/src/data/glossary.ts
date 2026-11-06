/**
 * Accessible glossary: plain-language meaning alongside the technical definition for
 * every instrument term. Tooltips and the Field Guide reference these so a student and
 * an engineer read the same honest explanation. Explanations never overstate certainty.
 */
export interface GlossaryEntry {
  id: string;
  term: string;
  unit?: string;
  plain: string;
  technical: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  { id: 'sun-elevation', term: 'Solar elevation', unit: '°', plain: 'How high the Sun sits above the flat mathematical horizon. 0° is on the horizon; negative means below it.', technical: 'Angle of the topocentric Sun direction above the local tangent plane, IAU 2015 frame, light-time corrected + aberrated, no refraction.' },
  { id: 'sun-azimuth', term: 'Solar azimuth', unit: '°', plain: 'The compass direction of the Sun, measured clockwise from local north (0° = north, 90° = east).', technical: 'atan2(east, north) of the Sun direction in the local east-north-up frame, wrapped to 0–360°.' },
  { id: 'earth-elevation', term: 'Earth elevation', unit: '°', plain: 'How high Earth sits above the flat horizon. If it stays below the terrain, the site cannot see Earth directly.', technical: 'Angle of the geometric Earth direction above the local tangent plane (center of disk; ~0.26° lunar-radius parallax included).' },
  { id: 'earth-azimuth', term: 'Earth azimuth', unit: '°', plain: 'The compass direction of Earth in the sky, clockwise from local north.', technical: 'Azimuth of the Earth direction in the local east-north-up frame.' },
  { id: 'libration', term: 'Libration', unit: '°', plain: 'The Moon’s slow apparent wobble. It makes Earth drift a few degrees in the lunar sky, so Earth-visibility near the limb changes over the month.', technical: 'Optical libration in latitude/longitude; the sub-Earth point moves ±~6.7° lat / ±~7.9° lon over the draconic/anomalistic cycles.' },
  { id: 'clearance', term: 'Terrain clearance', unit: '°', plain: 'The gap between a body and the terrain in that direction. Positive means it clears the hills; negative means a hill blocks it.', technical: 'Body elevation minus the terrain-horizon elevation at the body’s azimuth (minus any comms margin for Earth).' },
  { id: 'horizon-elevation', term: 'Horizon elevation', unit: '°', plain: 'The height of the surrounding terrain skyline in a given compass direction — how high a hill rises above the flat horizon.', technical: 'Maximum ray-marched terrain angle per azimuth bin from the DEM (or an illustrative mask), at the configured eye height.' },
  { id: 'solar-flux', term: 'Solar flux', unit: 'W/m²', plain: 'The sunlight power arriving per square metre at the Moon’s distance from the Sun (~1361 W/m²).', technical: '1361 / au² W/m², where au is the Moon–Sun distance in astronomical units.' },
  { id: 'soc', term: 'Battery state of charge', unit: '%', plain: 'How full the battery is. 100% is full; 0% means the stored energy is used up under the current load.', technical: 'Stored energy / capacity, integrated from net power with 92% charge / 95% discharge efficiency and hard [0, capacity] bounds. Energy-balance only, not thermal survival.' },
  { id: 'sampling', term: 'Mission sampling interval', unit: 'min', plain: 'The time between computed telemetry points. If the window is long, the step is coarsened evenly so the whole mission is still covered.', technical: 'Uniform step, coarsened to respect the 20,000-sample cap (both endpoints preserved). Visibility/energy use refined event crossings, not just these samples.' },
  { id: 'frame-residual', term: 'Reference-frame residual', unit: '°', plain: 'The small leftover alignment error after converting a DEM’s coordinates to the ephemeris frame. It is disclosed, not hidden.', technical: 'Max time-variation of the constant ME/PA→IAU correction vs SPICE over 2020–2035 (≤0.0039°, ~120 m on the surface).' },
  { id: 'illumination', term: 'Solar illumination availability', unit: '%', plain: 'The fraction of the mission window when the Sun is above the modeled terrain horizon and can make power.', technical: 'Visible time from refined illumination crossings / window duration. Geometric visibility above the local terrain, not a certified illumination product.' },
  { id: 'dte', term: 'Geometric Earth line-of-sight', unit: '%', plain: 'The fraction of the window when Earth clears the terrain so the lander could point at Earth directly. This is geometry only — not a guarantee a radio link works.', technical: 'Earth-clearance-visible time / duration. No antenna gain, transmit power, coding or pointing loss — NOT an RF link budget.' },
  { id: 'combined', term: 'Simultaneous Sun + Earth visibility', unit: '%', plain: 'The fraction of the window when the lander can both make solar power and see Earth at the same time.', technical: 'Intersection of Sun- and Earth-visible intervals from refined crossings.' },
  { id: 'energy-deficit', term: 'Energy deficit', plain: 'The modeled battery reaches zero under the current power-generation and load assumptions — more array area, less load, or a different window is needed.', technical: 'Cumulative hours the battery model spends at 0% SOC. Energy-balance result only; thermal/radiation survival is not modeled.' },
  { id: 'score', term: 'Feasibility score', unit: '0–100', plain: 'A single indicative number combining visibility and energy. It is a helper for comparing scenarios, not an official ranking.', technical: 'Application-defined heuristic: 0.45·combined + 0.20·illumination + 0.15·Earth + 0.20·energy-margin. NOT a NASA methodology; data confidence is reported separately.' },
];

export const GLOSSARY_BY_ID: Record<string, GlossaryEntry> = Object.fromEntries(GLOSSARY.map((g) => [g.id, g]));
