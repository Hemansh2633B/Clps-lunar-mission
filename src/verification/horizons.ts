/**
 * Independent verification of CHANDRA's Sun / Earth sky geometry against the
 * NASA/JPL Horizons API.
 *
 * Horizons is NOT CHANDRA's ephemeris engine and is never used by the mission
 * simulation: it is a second opinion. The comparison is purely geometric —
 * Horizons knows nothing about terrain, so it can confirm where the Sun and
 * Earth are in the sky, never whether a ridge hides them.
 *
 * Frames are handled explicitly. Horizons lunar surface sites are MEAN_ME
 * (mean Earth / polar axis); CHANDRA sites are IAU 2015. The site is converted
 * with the transpose of the SPICE-verified ME→IAU constant rotation, and the
 * local-north azimuth offset of that conversion is removed from the Horizons
 * azimuths before any difference is taken.
 */
import * as A from 'astronomy-engine';
import { computeEphemeris } from '../engine/ephemeris';
import { convertSiteInverse } from '../engine/lunarFrame';
import type { LandingSite } from '../types/mission';

export type HorizonsTargetName = 'sun' | 'earth';

export interface HorizonsRow {
  utc: string;
  jd_ut?: number;
  azimuth_deg: number;
  elevation_deg: number;
  range_km: number;
  range_rate_km_s?: number;
  tdb_minus_ut_s?: number;
}

export interface HorizonsTarget {
  target: HorizonsTargetName;
  body_id: string;
  target_name: string;
  center_name: string;
  ephemeris_source: string;
  center_frame: string;
  center_radii_km: number[];
  site_east_longitude_deg: number;
  site_latitude_deg: number;
  site_altitude_km: number;
  atmospheric_refraction: string;
  eop_file?: string;
  generated?: string;
  api_version?: string;
  rows: HorizonsRow[];
  request_url?: string;
  retrieved_utc?: string;
  cache?: string;
  response_sha256?: string;
}

/** Response of POST /api/ephemeris/verify. */
export interface HorizonsVerifyResponse {
  service: { name: string; documentation: string; role: string };
  site: { frame: string; east_longitude_deg: number; latitude_deg: number; altitude_km: number; reference_sphere_km: number };
  query: { start_utc: string; step_minutes: number; samples: number; time_scale: string };
  conventions: Record<string, string>;
  targets: Partial<Record<HorizonsTargetName, HorizonsTarget>>;
  limits: { max_samples: number; cache_ttl_hours: number };
}

export interface SiteLike { latitude: number; longitude: number; elevationM: number; }

export interface HorizonsSite {
  frame: 'MOON_ME';
  east_longitude_deg: number;
  latitude_deg: number;
  altitude_km: number;
  /** Added to IAU-frame azimuths to obtain MEAN_ME azimuths at this site. */
  azimuthOffsetDeg: number;
}

/** Engineering tolerances for "agrees" — CHANDRA's documented ephemeris accuracy, not a mission requirement. */
export const VERIFY_TOLERANCE = {
  elevationDeg: 0.01,
  separationDeg: 0.02,
  /** Above this the comparison is treated as a disagreement rather than a review item. */
  failSeparationDeg: 0.1,
} as const;

export const MAX_VERIFY_SAMPLES = 400;

const DEG = Math.PI / 180;
const wrap180 = (d: number) => { const w = ((d % 360) + 360) % 360; return w > 180 ? w - 360 : w; };

/** CHANDRA (IAU 2015) site → the MEAN_ME site Horizons must be asked about. */
export function horizonsSiteFor(site: SiteLike): HorizonsSite {
  const me = convertSiteInverse(site.latitude, site.longitude, 'me');
  return {
    frame: 'MOON_ME',
    east_longitude_deg: ((me.longitude % 360) + 360) % 360,
    latitude_deg: me.latitude,
    altitude_km: site.elevationM / 1000,
    azimuthOffsetDeg: me.azimuthOffsetDeg,
  };
}

export interface ResidualRow {
  utc: string;
  chandraAzimuthDeg: number;
  chandraElevationDeg: number;
  horizonsAzimuthDeg: number; // expressed in CHANDRA's IAU frame (offset removed)
  horizonsElevationDeg: number;
  dAzimuthDeg: number;
  dElevationDeg: number;
  /** Great-circle angle between the two directions — the primary metric (well-conditioned at the pole). */
  separationDeg: number;
  dRangeKm: number;
}

export type Verdict = 'agree' | 'review' | 'disagree';

export interface Comparison {
  target: HorizonsTargetName;
  rows: ResidualRow[];
  maxAbsElevationDeg: number;
  maxAbsAzimuthDeg: number;
  maxSeparationDeg: number;
  rmsSeparationDeg: number;
  maxAbsRangeKm: number;
  maxRelativeRange: number;
  verdict: Verdict;
}

export class VerificationError extends Error {}

function separation(az1: number, el1: number, az2: number, el2: number): number {
  const c = Math.sin(el1 * DEG) * Math.sin(el2 * DEG) + Math.cos(el1 * DEG) * Math.cos(el2 * DEG) * Math.cos((az1 - az2) * DEG);
  // haversine-free but stable for tiny angles: use the chord.
  const x1 = Math.cos(el1 * DEG) * Math.sin(az1 * DEG), y1 = Math.cos(el1 * DEG) * Math.cos(az1 * DEG), z1 = Math.sin(el1 * DEG);
  const x2 = Math.cos(el2 * DEG) * Math.sin(az2 * DEG), y2 = Math.cos(el2 * DEG) * Math.cos(az2 * DEG), z2 = Math.sin(el2 * DEG);
  const chord = Math.hypot(x1 - x2, y1 - y2, z1 - z2);
  return c > 0.5 ? (2 * Math.asin(Math.min(1, chord / 2))) / DEG : Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
}

/**
 * Check that a Horizons table really answers the question asked: right body,
 * right frame, right site, airless, and a usable time grid. Throws a
 * VerificationError naming the first mismatch — a mismatched table is never compared.
 */
export function assertComparable(table: HorizonsTarget, target: HorizonsTargetName, expected: HorizonsSite): void {
  const wantBody = target === 'sun' ? '10' : '399';
  if (table.body_id !== wantBody) throw new VerificationError(`Horizons returned body ${table.body_id}, expected ${wantBody} (${target}).`);
  if (!/MEAN_ME/i.test(table.center_frame)) throw new VerificationError(`Horizons site frame is "${table.center_frame}", expected MEAN_ME.`);
  if (!/301|moon/i.test(table.center_name)) throw new VerificationError(`Horizons centre is "${table.center_name}", expected the Moon.`);
  if (!/NO/i.test(table.atmospheric_refraction)) throw new VerificationError('Horizons applied atmospheric refraction; the Moon has no atmosphere.');
  if (Math.abs(table.site_latitude_deg - expected.latitude_deg) > 1e-5 || Math.abs(wrap180(table.site_east_longitude_deg - expected.east_longitude_deg)) > 1e-4
    || Math.abs(table.site_altitude_km - expected.altitude_km) > 1e-4) {
    throw new VerificationError('Horizons echoed a different site than the one requested.');
  }
  if (!Array.isArray(table.rows) || table.rows.length === 0) throw new VerificationError('Horizons returned no ephemeris rows.');
  for (const r of table.rows) {
    if (!Number.isFinite(Date.parse(r.utc)) || ![r.azimuth_deg, r.elevation_deg, r.range_km].every(Number.isFinite)) {
      throw new VerificationError('Horizons returned a malformed ephemeris row.');
    }
  }
}

/** Difference CHANDRA − Horizons at each Horizons instant. */
export function compareWithHorizons(site: SiteLike, target: HorizonsTargetName, table: HorizonsTarget): Comparison {
  const hSite = horizonsSiteFor(site);
  assertComparable(table, target, hSite);
  const rows: ResidualRow[] = table.rows.map((r) => {
    const eph = computeEphemeris(site as LandingSite, Date.parse(r.utc))[target];
    const hAz = (((r.azimuth_deg - hSite.azimuthOffsetDeg) % 360) + 360) % 360;
    return {
      utc: r.utc,
      chandraAzimuthDeg: eph.azimuthDeg,
      chandraElevationDeg: eph.elevationDeg,
      horizonsAzimuthDeg: hAz,
      horizonsElevationDeg: r.elevation_deg,
      dAzimuthDeg: wrap180(eph.azimuthDeg - hAz),
      dElevationDeg: eph.elevationDeg - r.elevation_deg,
      separationDeg: separation(eph.azimuthDeg, eph.elevationDeg, hAz, r.elevation_deg),
      dRangeKm: eph.distanceKm - r.range_km,
    };
  });
  const max = (f: (r: ResidualRow) => number) => rows.reduce((m, r) => Math.max(m, Math.abs(f(r))), 0);
  const maxSeparationDeg = max((r) => r.separationDeg);
  const maxAbsElevationDeg = max((r) => r.dElevationDeg);
  const verdict: Verdict = maxSeparationDeg > VERIFY_TOLERANCE.failSeparationDeg ? 'disagree'
    : maxSeparationDeg <= VERIFY_TOLERANCE.separationDeg && maxAbsElevationDeg <= VERIFY_TOLERANCE.elevationDeg ? 'agree' : 'review';
  return {
    target, rows, maxAbsElevationDeg, maxSeparationDeg, verdict,
    maxAbsAzimuthDeg: max((r) => r.dAzimuthDeg),
    rmsSeparationDeg: Math.sqrt(rows.reduce((s, r) => s + r.separationDeg ** 2, 0) / rows.length),
    maxAbsRangeKm: max((r) => r.dRangeKm),
    maxRelativeRange: rows.reduce((m, r, i) => Math.max(m, Math.abs(r.dRangeKm) / table.rows[i].range_km), 0),
  };
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  agree: 'Agrees within tolerance',
  review: 'Outside tolerance — review',
  disagree: 'Disagrees',
};

/** Request body for POST /api/ephemeris/verify. Throws a VerificationError on unusable input. */
export function buildVerifyRequest(site: SiteLike, startMs: number, stepMinutes: number, samples: number, targets: HorizonsTargetName[] = ['sun', 'earth']) {
  if (!Number.isFinite(startMs)) throw new VerificationError('Start time is not a valid UTC instant.');
  if (!Number.isInteger(stepMinutes) || stepMinutes < 1 || stepMinutes > 1440) throw new VerificationError('Step must be a whole number of minutes between 1 and 1440.');
  if (!Number.isInteger(samples) || samples < 2 || samples > MAX_VERIFY_SAMPLES) throw new VerificationError(`Samples must be between 2 and ${MAX_VERIFY_SAMPLES}.`);
  if (![site.latitude, site.longitude, site.elevationM].every(Number.isFinite) || Math.abs(site.latitude) > 90) throw new VerificationError('Site coordinates are not valid.');
  const h = horizonsSiteFor(site);
  return {
    site: { frame: h.frame, east_longitude_deg: Number(h.east_longitude_deg.toFixed(6)), latitude_deg: Number(h.latitude_deg.toFixed(6)), altitude_km: Number(h.altitude_km.toFixed(4)) },
    targets,
    // Whole minutes: Horizons tabulates on the minute, and the comparison uses its own timestamps.
    start_utc: new Date(Math.floor(startMs / 60000) * 60000).toISOString().replace('.000Z', 'Z'),
    step_minutes: stepMinutes,
    samples,
  };
}

/**
 * TT − UT (seconds) that CHANDRA's engine (astronomy-engine's ΔT model) uses at an
 * instant. Horizons reports its own TDB − UT per row; the two differ by a few
 * seconds for future dates because ΔT is a prediction. Shown beside the
 * residuals so a time-scale contribution is visible rather than assumed away.
 */
export function engineDeltaTSeconds(timeMs: number): number {
  const t = new A.AstroTime(new Date(timeMs));
  return (t.tt - t.ut) * 86400;
}

export interface VerificationReport {
  kind: 'chandra-horizons-verification';
  schema: '1.0';
  generatedUtc: string;
  applicationVersion: string;
  source: 'recorded' | 'live';
  site: { name: string; iau2015: SiteLike; horizonsMeanMe: HorizonsSite };
  tolerances: typeof VERIFY_TOLERANCE;
  conventions: string[];
  targets: {
    target: HorizonsTargetName; verdict: Verdict; samples: number;
    maxAbsElevationDeg: number; maxAbsAzimuthDeg: number; maxSeparationDeg: number; rmsSeparationDeg: number; maxAbsRangeKm: number;
    horizons: Pick<HorizonsTarget, 'ephemeris_source' | 'center_frame' | 'atmospheric_refraction' | 'generated' | 'request_url' | 'retrieved_utc' | 'cache' | 'response_sha256'>;
    rows: ResidualRow[];
  }[];
}

export const VERIFICATION_CONVENTIONS = [
  'Horizons: airless apparent azimuth/elevation (light-time, stellar aberration, gravitational deflection), DE441, observer on the 1737.4 km sphere in MEAN_ME.',
  'CHANDRA: astronomy-engine analytic ephemerides, IAU 2015 lunar rotation; Sun light-time + aberration, Earth geometric.',
  'The CHANDRA site is converted IAU 2015 → MEAN_ME with the transpose of the SPICE-verified constant rotation; its azimuth offset is removed before differencing.',
  'Primary metric: great-circle separation. Azimuth alone is ill-conditioned within a fraction of a degree of the pole.',
  'Range differences are informational: range never enters a visibility decision.',
  'Terrain is NOT verified: Horizons has no terrain model, so this checks sky geometry only.',
];

export function buildReport(source: 'recorded' | 'live', siteName: string, site: SiteLike, comparisons: Comparison[],
  tables: Partial<Record<HorizonsTargetName, HorizonsTarget>>, applicationVersion: string, nowMs: number): VerificationReport {
  return {
    kind: 'chandra-horizons-verification', schema: '1.0', generatedUtc: new Date(nowMs).toISOString(), applicationVersion, source,
    site: { name: siteName, iau2015: { latitude: site.latitude, longitude: site.longitude, elevationM: site.elevationM }, horizonsMeanMe: horizonsSiteFor(site) },
    tolerances: VERIFY_TOLERANCE,
    conventions: VERIFICATION_CONVENTIONS,
    targets: comparisons.map((c) => {
      const t = tables[c.target]!;
      return {
        target: c.target, verdict: c.verdict, samples: c.rows.length,
        maxAbsElevationDeg: c.maxAbsElevationDeg, maxAbsAzimuthDeg: c.maxAbsAzimuthDeg, maxSeparationDeg: c.maxSeparationDeg,
        rmsSeparationDeg: c.rmsSeparationDeg, maxAbsRangeKm: c.maxAbsRangeKm,
        horizons: {
          ephemeris_source: t.ephemeris_source, center_frame: t.center_frame, atmospheric_refraction: t.atmospheric_refraction,
          generated: t.generated, request_url: t.request_url, retrieved_utc: t.retrieved_utc, cache: t.cache, response_sha256: t.response_sha256,
        },
        rows: c.rows,
      };
    }),
  };
}
