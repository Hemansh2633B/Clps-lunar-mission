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
  const count = profile.elevations.length;
  const idx = az / profile.resolutionDeg;
  const i0 = Math.floor(idx) % count;
  const i1 = (i0 + 1) % count;
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

/** Signed clearance (degrees): visible iff >= 0. Matches visibilityFor(). */
function clearanceOf(sample: EvaluatedSample, body: BodyKind | 'combined', commsMarginDeg: number): number {
  const sun = sample.sunVisibility.clearanceDeg;
  const earth = sample.earthVisibility.clearanceDeg - commsMarginDeg;
  if (body === 'sun') return sun;
  if (body === 'earth') return earth;
  return Math.min(sun, earth);
}

function clearanceAt(site: LandingSite, config: MissionConfig, t: number, body: BodyKind | 'combined'): number {
  const s = computeEphemeris(site, t);
  const sun = s.sun.elevationDeg - terrainElevationAt(site.terrain, s.sun.azimuthDeg);
  const earth = s.earth.elevationDeg - terrainElevationAt(site.terrain, s.earth.azimuthDeg) - config.commsMarginDeg;
  if (body === 'sun') return sun;
  if (body === 'earth') return earth;
  return Math.min(sun, earth);
}

/**
 * Conservative upper bound on |d(clearance)/dt| (deg/hour) for this terrain.
 * clearance = body elevation - terrain(azimuth); its rate is bounded by the
 * elevation rate plus the terrain's max azimuthal gradient times the azimuth
 * rate. Used to flag intervals where a crossing is kinematically possible so a
 * short visibility window entirely inside one coarse step is not missed.
 */
function clearanceRateBound(profile: TerrainProfile): number {
  const e = profile.elevations;
  let maxGradient = 0;
  for (let i = 0; i < e.length; i++) {
    const g = Math.abs(e[(i + 1) % e.length] - e[i]) / profile.resolutionDeg;
    if (g > maxGradient) maxGradient = g;
  }
  // Lunar rotation ~0.55 deg/h; libration adds Earth motion. Use a generous
  // azimuth-rate allowance; elevation rate is small at the pole.
  return Math.min(40, Math.max(2, 0.6 + maxGradient * 2.0));
}

/**
 * Detect visibility transitions with adaptive temporal refinement.
 *
 * Consecutive-sample sign changes alone miss a short window that begins and ends
 * inside one coarse interval. For each interval we flag a crossing as possible
 * when the endpoint clearances change sign OR approach zero within the kinematic
 * rate bound, then sub-sample flagged intervals finely and bisect each crossing.
 * The effective coarse step is uniform (see simulateMission), so this resolves
 * windows down to ~15 s without assuming a fixed step is always sufficient.
 */
export function findTransitions(
  site: LandingSite,
  config: MissionConfig,
  samples: EvaluatedSample[],
): TransitionEvent[] {
  const events: TransitionEvent[] = [];
  if (samples.length < 2) return events;
  const rateBoundPerMs = clearanceRateBound(site.terrain) / HOUR_MS;
  const MIN_STEP_MS = 15_000;
  const NODE_BUDGET = 256; // bounds worst-case work per coarse interval
  const bodies: (BodyKind | 'combined')[] = ['sun', 'earth', 'combined'];

  for (const body of bodies) {
    const seen = new Set<number>();
    const record = (t0: number, t1: number, c1: number) => {
      const targetVisible = c1 >= 0;
      const tc = refineCrossing(site, config, t0, t1, body, targetVisible);
      const key = Math.round(tc / 1000);
      if (!seen.has(key)) {
        seen.add(key);
        events.push({ timeMs: tc, body, visible: targetVisible });
      }
    };
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      const c0 = clearanceOf(a, body, config.commsMarginDeg);
      const c1 = clearanceOf(b, body, config.commsMarginDeg);
      if (b.timeMs - a.timeMs <= 0) continue;
      // Recursive adaptive subdivision: a crossing can hide in [t0,t1] only if the
      // endpoints change sign OR approach zero within the kinematic rate bound.
      // Halves where no crossing is possible are pruned immediately, so effort
      // concentrates near real crossings instead of uniformly sampling every
      // flagged interval. Resolves down to MIN_STEP_MS, then bisects each crossing.
      let budget = NODE_BUDGET;
      const examine = (t0: number, cc0: number, t1: number, cc1: number): void => {
        const span = t1 - t0;
        if (span <= 0 || budget <= 0) return;
        const signChange = (cc0 >= 0) !== (cc1 >= 0);
        const nearZero = Math.min(Math.abs(cc0), Math.abs(cc1)) < rateBoundPerMs * span;
        if (!signChange && !nearZero) return; // crossing kinematically impossible
        if (span <= MIN_STEP_MS) {
          if (signChange) record(t0, t1, cc1);
          return;
        }
        budget--;
        const tm = (t0 + t1) / 2;
        const cm = clearanceAt(site, config, tm, body);
        examine(t0, cc0, tm, cm);
        examine(tm, cm, t1, cc1);
      };
      examine(a.timeMs, c0, b.timeMs, c1);
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
