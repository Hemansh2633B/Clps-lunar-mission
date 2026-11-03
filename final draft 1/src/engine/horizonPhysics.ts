import type { BodyKind, EvaluatedSample, LandingSite, MissionConfig, TerrainFeature, TerrainProfile, TransitionEvent, VisibilityState } from '../types/mission';
import { HOUR_MS, clamp, wrap180, wrap360 } from './constants';
import { computeEphemeris } from './ephemeris';

const DEG = Math.PI / 180;

/** Deterministic, LOLA-inspired illustrative horizon. NOT a measured DEM product. */
export function buildTerrainProfile(
  label: string,
  features: TerrainFeature[],
  baseElevationDeg = -0.08,
  seed = 1,
  kind: TerrainProfile['kind'] = 'illustrative',
  uncertaintyDeg = 0.75,
): TerrainProfile {
  const resolutionDeg = 1;
  const elevations: number[] = [];
  for (let az = 0; az <= 360; az += resolutionDeg) {
    let h = baseElevationDeg;
    for (const f of features) {
      const d = wrap180(az - f.azimuthDeg);
      const half = Math.max(1, f.widthDeg / 2);
      if (Math.abs(d) <= half) {
        const t = 0.5 + 0.5 * Math.cos((Math.PI * d) / half);
        h += f.elevationDeg * Math.pow(t, 1.35);
      }
    }
    if (kind === 'illustrative') {
      h += 0.11 * Math.sin((az * 7 + seed * 31) * DEG)
        + 0.07 * Math.sin((az * 13 + seed * 17) * DEG)
        + 0.045 * Math.sin((az * 29 + seed * 7) * DEG);
    }
    elevations.push(clamp(h, -2.5, 14));
  }
  elevations[360] = elevations[0];
  return { label, kind, resolutionDeg, elevations, features, uncertaintyDeg, eyeHeightM: 2 };
}

export function flatProfile(label = 'Idealized spherical horizon'): TerrainProfile {
  return buildTerrainProfile(label, [], -0.08, 0, 'flat', 0);
}

export function terrainElevationAt(profile: TerrainProfile, azimuthDeg: number): number {
  const az = wrap360(azimuthDeg);
  const idx = az / profile.resolutionDeg;
  const i0 = Math.floor(idx) % 360;
  const i1 = (i0 + 1) % 360;
  const f = idx - Math.floor(idx);
  return profile.elevations[i0] * (1 - f) + profile.elevations[i1] * f;
}

export function visibilityFor(
  body: BodyKind,
  elevationDeg: number,
  azimuthDeg: number,
  profile: TerrainProfile,
  commsMarginDeg = 0,
): VisibilityState {
  const terrainElevationDeg = terrainElevationAt(profile, azimuthDeg);
  const clearanceDeg = elevationDeg - terrainElevationDeg;
  const margin = body === 'earth' ? commsMarginDeg : 0;
  const geometricVisible = elevationDeg >= 0;
  const visible = clearanceDeg >= margin;
  return {
    visible,
    geometricVisible,
    clearanceDeg,
    terrainElevationDeg,
    reason: visible ? 'clear' : geometricVisible ? 'terrain' : 'below-horizon',
  };
}

export function evaluateVisibility(sample: EvaluatedSample, profile: TerrainProfile, config: MissionConfig) {
  return {
    sun: visibilityFor('sun', sample.sun.elevationDeg, sample.sun.azimuthDeg, profile),
    earth: visibilityFor('earth', sample.earth.elevationDeg, sample.earth.azimuthDeg, profile, config.commsMarginDeg),
  };
}

export interface HorizonRow {
  azimuthDeg: number;
  terrainElevationDeg: number;
  sunClearanceDeg: number | null;
  earthClearanceDeg: number | null;
}

export function horizonTable(site: LandingSite, sample: EvaluatedSample, stepDeg = 15): HorizonRow[] {
  const rows: HorizonRow[] = [];
  for (let az = 0; az < 360; az += stepDeg) {
    const terrain = terrainElevationAt(site.terrain, az);
    const nearSun = Math.abs(wrap180(sample.sun.azimuthDeg - az)) <= stepDeg / 2;
    const nearEarth = Math.abs(wrap180(sample.earth.azimuthDeg - az)) <= stepDeg / 2;
    rows.push({
      azimuthDeg: az,
      terrainElevationDeg: terrain,
      sunClearanceDeg: nearSun ? sample.sun.elevationDeg - terrain : null,
      earthClearanceDeg: nearEarth ? sample.earth.elevationDeg - terrain : null,
    });
  }
  return rows;
}

/** Bisection refinement of a visibility crossing between two coarse samples. */
export function refineCrossing(
  site: LandingSite,
  config: MissionConfig,
  t0: number,
  t1: number,
  body: BodyKind | 'combined',
  targetVisible: boolean,
): number {
  const stateAt = (t: number) => {
    const s = computeEphemeris(site, t);
    const sun = visibilityFor('sun', s.sun.elevationDeg, s.sun.azimuthDeg, site.terrain);
    const earth = visibilityFor('earth', s.earth.elevationDeg, s.earth.azimuthDeg, site.terrain, config.commsMarginDeg);
    if (body === 'sun') return sun.visible;
    if (body === 'earth') return earth.visible;
    return sun.visible && earth.visible;
  };
  let lo = t0;
  let hi = t1;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (stateAt(mid) === targetVisible) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export function findTransitions(
  site: LandingSite,
  config: MissionConfig,
  samples: EvaluatedSample[],
): TransitionEvent[] {
  const events: TransitionEvent[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const checks: [BodyKind | 'combined', boolean, boolean][] = [
      ['sun', a.sunVisibility.visible, b.sunVisibility.visible],
      ['earth', a.earthVisibility.visible, b.earthVisibility.visible],
      ['combined', a.viable, b.viable],
    ];
    for (const [body, was, now] of checks) {
      if (was !== now) {
        events.push({ timeMs: refineCrossing(site, config, a.timeMs, b.timeMs, body, now), body, visible: now });
      }
    }
  }
  return events.sort((x, y) => x.timeMs - y.timeMs);
}

export interface NextEvent {
  timeMs: number;
  visible: boolean;
}

/** Forward scan for countdowns when the active simulation window has no crossing. */
export function findNextTransition(
  site: LandingSite,
  config: MissionConfig,
  fromMs: number,
  body: BodyKind,
  maxDays = 40,
): NextEvent | null {
  const stateAt = (t: number) => {
    const s = computeEphemeris(site, t);
    return body === 'sun'
      ? visibilityFor('sun', s.sun.elevationDeg, s.sun.azimuthDeg, site.terrain).visible
      : visibilityFor('earth', s.earth.elevationDeg, s.earth.azimuthDeg, site.terrain, config.commsMarginDeg).visible;
  };
  const initial = stateAt(fromMs);
  const step = HOUR_MS;
  let prev = initial;
  for (let t = fromMs + step; t <= fromMs + maxDays * 24 * HOUR_MS; t += step) {
    const now = stateAt(t);
    if (now !== prev) {
      const refined = refineCrossing(site, config, t - step, t, body, now);
      return { timeMs: refined, visible: now };
    }
    prev = now;
  }
  return null;
}
