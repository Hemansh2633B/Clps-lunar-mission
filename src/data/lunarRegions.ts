/**
 * Lunar region catalogue and side classification.
 *
 * WHY A CATALOGUE (not a hard-coded site list)
 * CHANDRA's candidate sites are built from data entries. Adding a region means
 * adding one entry here (or calling `registerRegion` at runtime) — no code path
 * is specific to a named site. The catalogue also records where each coordinate
 * came from and whether it is a surveyed point, a region centre or unknown, so
 * the application can never present an approximate basin centre as a landing
 * point.
 *
 * COORDINATES
 * Selenographic, planetocentric latitude, EAST-POSITIVE longitude 0–360°
 * (IAU 2015 / MOON_ME convention used throughout the engine). The far-side
 * seeds in this file are approximate REGION CENTRES for catalogue/navigation
 * demonstration, with deliberately broad uncertainty. Their exact gazetteer
 * coordinates have not been independently checked in this repository session;
 * the generic USGS Gazetteer link is a source index, not a per-entry citation.
 * Do not treat the seed coordinates as survey control or a landing point.
 *
 * SIDE CLASSIFICATION
 * Static labels use angular distance from the nominal sub-Earth point (0°N,
 * 0°E), not longitude alone; this correctly places the poles in a limb band
 * regardless of their arbitrary longitude. ≤80° is near, ≥100° is far, and
 * 80°–100° is the libration/limb band. Actual Earth visibility is still
 * computed per epoch from the ephemeris and can differ as the Moon librates.
 */
import { wrap180, wrap360 } from '../engine/constants';
import type { LunarSide } from '../types/mission';

export type RegionKind = 'basin' | 'crater' | 'mare' | 'highland' | 'polar' | 'valley';

export interface RegionEntry {
  id: string;
  name: string;
  shortName: string;
  /** Planetocentric latitude, degrees north. */
  latitudeDeg: number;
  /** East-positive longitude, degrees 0–360 (values outside are wrapped). */
  longitudeDeg: number;
  kind: RegionKind;
  /** Published/estimated surface elevation, metres. null = NOT KNOWN in this build. */
  elevationM: number | null;
  description: string;
  /** Where the coordinate came from. Required: no anonymous coordinates. */
  sourceUrl: string;
  sourceDate: string;
  /** Coordinate uncertainty, degrees (radius of the region or the survey error). */
  coordinateUncertaintyDeg: number;
  /** True when the entry is offered as a landing-site candidate. */
  candidate: boolean;
  /** Programme/context label, when applicable. */
  program?: string;
  /** Free-text provenance note (basin centre ≠ landing point, etc.). */
  coordinateProvenance: string;
}

const GAZETTEER = 'https://planetarynames.wr.usgs.gov/';
const GAZETTEER_DATE = 'not recorded in this build';
const REGION_CENTRE = 'Approximate catalogue seed for this named region; exact IAU Gazetteer coordinate was not independently verified in this build. A region centre is NOT a surveyed landing point.';

/**
 * Built-in regions. The four far-side entries exercise the relay architecture:
 * all of them lie beyond the Earth-facing hemisphere, so direct-to-Earth line of
 * sight is geometrically impossible for most or all of the libration cycle.
 */
export const BUILT_IN_REGIONS: RegionEntry[] = [
  {
    id: 'von-karman-region',
    name: 'Von Kármán crater',
    shortName: 'Von Kármán',
    latitudeDeg: -44.4,
    longitudeDeg: 176.3,
    kind: 'crater',
    elevationM: null,
    description: 'A 180 km crater inside the South Pole–Aitken basin, and the host of the Chang’e 4 landing. Deeply far-side: the Moon blocks Earth at every libration phase, so any mission here needs a relay.',
    sourceUrl: GAZETTEER, sourceDate: GAZETTEER_DATE, coordinateUncertaintyDeg: 0.5,
    candidate: true, program: 'Far-side exploration candidate',
    coordinateProvenance: REGION_CENTRE,
  },
  {
    id: 'apollo-basin',
    name: 'Apollo basin',
    shortName: 'Apollo basin',
    latitudeDeg: -35.7,
    longitudeDeg: 208.5, // 151.5°W
    kind: 'basin',
    elevationM: null,
    description: 'A ~500 km impact basin within South Pole–Aitken, far-side at 151°W. Smooth basin floor with a raised rim; a classic far-side relay-dependent candidate.',
    sourceUrl: GAZETTEER, sourceDate: GAZETTEER_DATE, coordinateUncertaintyDeg: 0.8,
    candidate: true, program: 'Far-side exploration candidate',
    coordinateProvenance: REGION_CENTRE,
  },
  {
    id: 'hertzsprung-basin',
    name: 'Hertzsprung basin',
    shortName: 'Hertzsprung',
    latitudeDeg: 1.8,
    longitudeDeg: 231.3, // 128.7°W
    kind: 'basin',
    elevationM: null,
    description: 'A 570 km far-side multi-ring basin near the equator. The equatorial location produces a normal ~29.5-day day/night cycle but no direct Earth view: it is ~129°W, well beyond the limb.',
    sourceUrl: GAZETTEER, sourceDate: GAZETTEER_DATE, coordinateUncertaintyDeg: 0.8,
    candidate: true, program: 'Far-side exploration candidate',
    coordinateProvenance: REGION_CENTRE,
  },
  {
    id: 'spa-interior',
    name: 'South Pole–Aitken basin interior',
    shortName: 'SPA interior',
    latitudeDeg: -53.0,
    longitudeDeg: 191.0, // 169°W
    kind: 'basin',
    elevationM: null,
    description: 'The deepest confirmed impact structure on the Moon (~2,500 km across, floor several kilometres below the datum). Deep far-side terrain combines long polar-style shadows with complete Earth occultation.',
    sourceUrl: GAZETTEER, sourceDate: GAZETTEER_DATE, coordinateUncertaintyDeg: 1.5,
    candidate: true, program: 'Far-side exploration candidate',
    coordinateProvenance: REGION_CENTRE,
  },
  {
    id: 'tsiolkovskiy',
    name: 'Tsiolkovskiy crater',
    shortName: 'Tsiolkovskiy',
    latitudeDeg: -20.4,
    longitudeDeg: 128.9,
    kind: 'crater',
    elevationM: null,
    description: 'A far-side crater with a conspicuous dark mare floor — one of the few far-side mare deposits. Its longitude (~129°E) places it just past the limb.',
    sourceUrl: GAZETTEER, sourceDate: GAZETTEER_DATE, coordinateUncertaintyDeg: 0.5,
    candidate: true, program: 'Far-side exploration candidate',
    coordinateProvenance: REGION_CENTRE,
  },
  {
    id: 'imbrium-reference',
    name: 'Mare Imbrium (reference)',
    shortName: 'Mare Imbrium',
    latitudeDeg: 32.8,
    longitudeDeg: -15.6,
    kind: 'mare',
    elevationM: -2600,
    description: 'Near-side mare reference: high Earth visibility, normal day/night cycle. Included so a comparison can show what a near-side site looks like next to the far side.',
    sourceUrl: GAZETTEER, sourceDate: GAZETTEER_DATE, coordinateUncertaintyDeg: 1.0,
    candidate: false, program: 'Reference region',
    coordinateProvenance: REGION_CENTRE,
  },
];

/** Runtime-registered regions (validated). Kept separate so built-ins stay immutable. */
const registered: RegionEntry[] = [];

/** All known regions: built-ins plus anything registered at runtime. */
export function allRegions(): RegionEntry[] {
  return [...BUILT_IN_REGIONS, ...registered];
}

export function regionById(id: string): RegionEntry | undefined {
  return allRegions().find((r) => r.id === id);
}

export type RegionValidation = { ok: true; entry: RegionEntry } | { ok: false; error: string };

/** Validate one catalogue entry. Rejects rather than guessing. */
export function validateRegionEntry(raw: unknown): RegionValidation {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Region entry must be an object.' };
  const r = raw as Record<string, unknown>;
  const text = (k: string) => (typeof r[k] === 'string' && (r[k] as string).trim().length > 0 ? (r[k] as string) : null);
  const num = (k: string) => (typeof r[k] === 'number' && Number.isFinite(r[k] as number) ? (r[k] as number) : null);
  for (const key of ['id', 'name', 'shortName', 'description', 'sourceUrl', 'sourceDate', 'coordinateProvenance']) {
    if (!text(key)) return { ok: false, error: `Region entry field "${key}" must be a non-empty string.` };
  }
  const id = text('id')!;
  if (!/^[a-z0-9][a-z0-9._-]{1,80}$/.test(id)) return { ok: false, error: 'Region id must match [a-z0-9][a-z0-9._-]{1,80}.' };
  const lat = num('latitudeDeg');
  const lon = num('longitudeDeg');
  if (lat === null || lat < -90 || lat > 90) return { ok: false, error: 'latitudeDeg must be a number in [−90, 90].' };
  if (lon === null) return { ok: false, error: 'longitudeDeg must be a number.' };
  const elevationM = r.elevationM == null ? null : num('elevationM');
  if (r.elevationM != null && elevationM === null) return { ok: false, error: 'elevationM must be a finite number when provided.' };
  const uncertainty = num('coordinateUncertaintyDeg');
  if (uncertainty === null || uncertainty < 0 || uncertainty > 30) return { ok: false, error: 'coordinateUncertaintyDeg must be in [0, 30].' };
  const kinds: RegionKind[] = ['basin', 'crater', 'mare', 'highland', 'polar', 'valley'];
  const kind = (text('kind') ?? 'highland') as RegionKind;
  if (!kinds.includes(kind)) return { ok: false, error: `kind must be one of ${kinds.join(', ')}.` };
  if (allRegions().some((e) => e.id === id)) return { ok: false, error: `Region id "${id}" is already registered.` };
  return {
    ok: true,
    entry: {
      id, name: text('name')!, shortName: text('shortName')!,
      latitudeDeg: lat, longitudeDeg: wrap360(lon), kind, elevationM,
      description: text('description')!, sourceUrl: text('sourceUrl')!, sourceDate: text('sourceDate')!,
      coordinateUncertaintyDeg: uncertainty, candidate: r.candidate !== false,
      ...(text('program') ? { program: text('program')! } : {}),
      coordinateProvenance: text('coordinateProvenance')!,
    },
  };
}

/** Register a region at runtime (e.g. a mission-specific candidate list). */
export function registerRegion(raw: unknown): RegionValidation {
  const v = validateRegionEntry(raw);
  if (v.ok) registered.push(v.entry);
  return v;
}

/** Convenience classification for equatorial sites (lat = 0°); use sideOfCoordinates for general coordinates. */
export function sideOfLongitude(longitudeDeg: number): LunarSide {
  return sideOfCoordinates(0, longitudeDeg);
}

/** Static side from angular distance to the nominal sub-Earth point (0°, 0°E).
 * The 80°/100° thresholds leave an honest libration/limb band; at either pole
 * the point is always in that band regardless of its arbitrary longitude. */
export function sideOfCoordinates(latitudeDeg: number, longitudeDeg: number): LunarSide {
  const lat = (latitudeDeg * Math.PI) / 180;
  const lon = (wrap180(longitudeDeg) * Math.PI) / 180;
  const cosDistance = Math.max(-1, Math.min(1, Math.cos(lat) * Math.cos(lon)));
  const distanceDeg = Math.acos(cosDistance) * 180 / Math.PI;
  if (distanceDeg <= 80) return 'near';
  if (distanceDeg >= 100) return 'far';
  return 'limb';
}

export const SIDE_LABEL: Record<LunarSide, string> = {
  near: 'Near side',
  far: 'Far side',
  limb: 'Limb band',
};

export const SIDE_NOTE: Record<LunarSide, string> = {
  near: 'Faces Earth on average; direct geometric Earth line of sight is possible when the local horizon allows it.',
  far: 'Faces away from Earth: the lunar body itself blocks direct Earth line of sight. A relay (or stored data) is required.',
  limb: 'Within the libration band (±80°–100° longitude): direct Earth visibility can appear and disappear as the Moon librates. Computed per epoch, never assumed.',
};

/** Broad region class from latitude/longitude. Polar is defined at |lat| ≥ 80°. */
export function regionClassOf(latitudeDeg: number, longitudeDeg: number): 'north-polar' | 'south-polar' | LunarSide {
  if (latitudeDeg >= 80) return 'north-polar';
  if (latitudeDeg <= -80) return 'south-polar';
  return sideOfCoordinates(latitudeDeg, longitudeDeg);
}
