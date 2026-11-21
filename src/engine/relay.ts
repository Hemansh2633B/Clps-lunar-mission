/**
 * Relay-spacecraft visibility (Phase 5).
 *
 * A far-side lander cannot see Earth: the Moon's body is between them. A relay
 * spacecraft turns one blocked link into two geometric links:
 *
 *     lander ──(leg A)──> relay ──(leg B)──> Earth
 *
 * This module computes the *geometry* of both legs. It deliberately makes no
 * claim about radio performance: antenna gain, transmit power, modulation, data
 * rate, Doppler and interference are not modelled, and the UI/exports never call
 * a clear line of sight "communication available". See docs/scientific-method.md
 * §7.3 for the boundary.
 *
 * OPERATIONAL DEFINITIONS
 *   leg A clear  = the segment site→relay misses the Moon's mean sphere AND the
 *                  relay is above the site's obstruction elevation
 *                  max(terrain horizon mask, mean lunar limb).
 *   leg B clear  = the segment relay→Earth misses the Moon's mean sphere.
 *   link up      = both legs clear at the same instant.
 *
 * SPACECRAFT MODELS (all deterministic; each is labelled in the UI and exports)
 *   • circular-lunar — two-body circular orbit about the Moon, Kepler period from
 *     a = R + altitude, user-specified inclination/RAAN/phase in EQJ. No
 *     perturbations, no station-keeping, no plane precession: a planning proxy,
 *     not an ephemeris.
 *   • earth-moon-l2-halo — a parametric ring around the Earth–Moon L2 point in
 *     the plane perpendicular to the Earth–Moon line. L2 itself is *solved* from
 *     the circular restricted three-body problem (not hard-coded); the ring
 *     radius and period are user-supplied. This is an idealised halo proxy, not
 *     a fitted halo ephemeris (Queqiao-class spacecraft fly real halo orbits).
 *   • fixed-body — a fixed selenographic position (surface asset or a user's own
 *     propagated state supplied as lat/lon/alt).
 *
 * Everything is computed from the SAME ephemeris sample as the Sun/Earth
 * geometry (no second source of truth), so the frames cannot drift apart.
 */
import type { LandingSite, RelayConfig, RelaySample, TerrainProfile } from '../types/mission';
import type { SiteGeometry } from '../types/geometry';
import type { V3 } from './vectors';
import { add, cross, dot, length, mul, norm, sub } from './vectors';
import { azElFromVector, wrap360 } from './vectors';
import { MOON_MASS_RATIO, MOON_MU_KM3_S2, MOON_RADIUS_KM } from './constants';
import { raySphereOcclusion } from './occultation';
import { terrainElevationAt } from './horizonPhysics';

/** J2000.0 (2000-01-01T12:00:00Z) — the default phase epoch, for reproducibility. */
export const DEFAULT_RELAY_EPOCH_MS = Date.parse('2000-01-01T12:00:00Z');
export const DEFAULT_HALO_PERIOD_DAYS = 14;
export const DEFAULT_HALO_AMPLITUDE_KM = 15_000;
export const RELAY_DISCLAIMER =
  'Geometric two-hop line-of-sight only. A clear path is NOT an RF link: no link budget, antenna gain, data rate or interference model is applied.';

/**
 * Distance of the Earth–Moon L2 point beyond the Moon, in units of the
 * Earth–Moon distance (γ). Solved from the collinear equilibrium condition
 *
 *     (1−μ)/(1+γ)² + μ/γ² = 1 − μ + γ
 *
 * by bisection (the left side decreases monotonically while the right side
 * increases, so the root is unique). For μ = 0.0123 this gives γ ≈ 0.1678,
 * i.e. L2 sits ≈64,500 km beyond the Moon — matching published values.
 */
export function collinearL2Gamma(mu = MOON_MASS_RATIO): number {
  const f = (g: number) => (1 - mu) / ((1 + g) * (1 + g)) + mu / (g * g) - (1 - mu + g);
  let lo = 1e-3;
  let hi = 0.9;
  if (f(lo) <= 0 || f(hi) >= 0) return 0.1678; // cannot bracket → documented nominal value
  for (let i = 0; i < 120; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

export interface RelayPosition {
  positionEqjKm: V3;
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
}

const Z_AXIS: V3 = { x: 0, y: 0, z: 1 };

/** Inertial (EQJ) position of the configured relay state at `timeMs`. */
export function relayPosition(relay: RelayConfig, geom: SiteGeometry, timeMs: number): RelayPosition {
  const moonPos = geom.moonPositionEqjKm;
  const earthFromMoon = geom.earthFromMoonEqjKm;
  const epoch = Number.isFinite(relay.epochMs) ? (relay.epochMs as number) : DEFAULT_RELAY_EPOCH_MS;
  let offset: V3;

  switch (relay.model) {
    case 'circular-lunar': {
      const a = MOON_RADIUS_KM + Math.max(0, relay.altitudeKm ?? 100);
      const periodS = relay.periodMinutes && relay.periodMinutes > 0
        ? relay.periodMinutes * 60
        : 2 * Math.PI * Math.sqrt((a * a * a) / MOON_MU_KM3_S2);
      const inc = ((relay.inclinationDeg ?? 0) * Math.PI) / 180;
      const raan = ((relay.raanDeg ?? 0) * Math.PI) / 180;
      const u = ((relay.phaseDeg ?? 0) * Math.PI) / 180 + (2 * Math.PI * (timeMs - epoch)) / (periodS * 1000);
      const p = { x: Math.cos(raan), y: Math.sin(raan), z: 0 } as V3;
      const q = { x: -Math.sin(raan) * Math.cos(inc), y: Math.cos(raan) * Math.cos(inc), z: Math.sin(inc) } as V3;
      offset = mul(add(mul(p, Math.cos(u)), mul(q, Math.sin(u))), a);
      break;
    }
    case 'earth-moon-l2-halo': {
      const d = length(earthFromMoon);
      if (!(d > 0)) throw new Error('Earth–Moon distance is unavailable; the L2 relay state cannot be located.');
      const gamma = collinearL2Gamma();
      const antiEarth = norm(mul(earthFromMoon, -1)); // Moon → away from Earth
      const l2 = add(moonPos, mul(antiEarth, gamma * d));
      let inPlane = cross(antiEarth, Z_AXIS);
      if (length(inPlane) < 1e-6) inPlane = cross(antiEarth, { x: 1, y: 0, z: 0 });
      const vHat = norm(inPlane);
      const wHat = norm(cross(antiEarth, vHat));
      const amplitude = Math.max(0, relay.haloAmplitudeKm ?? DEFAULT_HALO_AMPLITUDE_KM);
      const periodDays = relay.haloPeriodDays && relay.haloPeriodDays > 0 ? relay.haloPeriodDays : DEFAULT_HALO_PERIOD_DAYS;
      const theta = ((relay.haloPhaseDeg ?? 0) * Math.PI) / 180 + (2 * Math.PI * (timeMs - epoch)) / (periodDays * 86_400_000);
      offset = sub(add(l2, mul(vHat, amplitude * Math.cos(theta))), moonPos);
      offset = add(offset, mul(wHat, amplitude * Math.sin(theta)));
      break;
    }
    case 'fixed-body': {
      const lat = ((relay.latitudeDeg ?? 0) * Math.PI) / 180;
      const lon = ((relay.longitudeDeg ?? 0) * Math.PI) / 180;
      const r = MOON_RADIUS_KM + Math.max(0, relay.altitudeKm ?? 0);
      const f = geom.bodyFrame;
      const up = add(
        add(mul(f.x, Math.cos(lat) * Math.cos(lon)), mul(f.y, Math.cos(lat) * Math.sin(lon))),
        mul(f.z, Math.sin(lat)),
      );
      offset = mul(up, r);
      break;
    }
    default: {
      throw new Error(`Unsupported relay model "${String((relay as { model?: string }).model)}".`);
    }
  }

  const positionEqjKm = add(moonPos, offset);
  const body = sub(positionEqjKm, moonPos);
  const b = { x: dot(body, geom.bodyFrame.x), y: dot(body, geom.bodyFrame.y), z: dot(body, geom.bodyFrame.z) };
  const radius = length(body);
  return {
    positionEqjKm,
    latitudeDeg: (Math.asin(Math.max(-1, Math.min(1, b.z / (radius || 1)))) * 180) / Math.PI,
    longitudeDeg: wrap360((Math.atan2(b.y, b.x) * 180) / Math.PI),
    altitudeKm: radius - MOON_RADIUS_KM,
  };
}

export interface RelayEvaluationInput {
  relay: RelayConfig;
  site: LandingSite;
  profile: TerrainProfile;
  geom: SiteGeometry;
  timeMs: number;
}

/** Geometric state of both relay legs at one epoch. */
export function evaluateRelay({ relay, site, profile, geom, timeMs }: RelayEvaluationInput): RelaySample {
  const pos = relayPosition(relay, geom, timeMs);
  const sitePos = geom.sitePositionEqjKm;
  const toRelay = sub(pos.positionEqjKm, sitePos);
  const rangeKm = length(toRelay);
  const { azimuthDeg, elevationDeg } = azElFromVector(toRelay, geom.local);

  const legA = raySphereOcclusion(sitePos, pos.positionEqjKm);
  const terrainElevationDeg = terrainElevationAt(profile, azimuthDeg);
  const siteLimitDeg = Math.max(terrainElevationDeg, geom.limb.limbElevationDeg);
  const siteTerrainClear = elevationDeg >= siteLimitDeg;

  const earthPos = add(geom.moonPositionEqjKm, geom.earthFromMoonEqjKm);
  const legB = raySphereOcclusion(pos.positionEqjKm, earthPos);

  return {
    id: relay.id,
    name: relay.name,
    model: relay.model,
    azimuthDeg,
    elevationDeg,
    rangeKm,
    siteBodyClear: !legA.occluded,
    siteTerrainClear,
    siteLimitDeg,
    earthClear: !legB.occluded,
    earthClearanceKm: legB.clearanceKm,
    linkUp: !legA.occluded && siteTerrainClear && !legB.occluded,
    relayLatitudeDeg: pos.latitudeDeg,
    relayLongitudeDeg: pos.longitudeDeg,
    relayAltitudeKm: pos.altitudeKm,
  };
}

/** Convenience predicate for tests and UI: is the relay state usable at all? */
export function relayConfigured(relay: RelayConfig | null | undefined): relay is RelayConfig {
  return !!relay && typeof relay.id === 'string' && relay.id.length > 0;
}

/** Sky position of the relay above the site horizon, for the panorama overlay. */
export function relaySkyDirection(sample: RelaySample): { azimuthDeg: number; elevationDeg: number } {
  return { azimuthDeg: sample.azimuthDeg, elevationDeg: sample.elevationDeg };
}
