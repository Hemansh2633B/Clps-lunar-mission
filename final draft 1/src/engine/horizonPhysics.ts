import type { BodyKind, EvaluatedSample, LandingSite, MissionConfig, TerrainFeature, TerrainProfile, TransitionDiagnostics, TransitionEvent, UnresolvedInterval, VisibilityState } from '../types/mission';
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

/** Resolution floor for transition refinement (15 s). Crossings are bisected to here. */
export const TRANSITION_MIN_STEP_MS = 15_000;
/** Adaptive node budget per coarse interval before the safe fine-scan fallback engages. */
export const TRANSITION_NODE_BUDGET = 256;

/**
 * Upper bound on |d(clearance)/dt| (deg/hour) used to PRUNE intervals that cannot
 * contain a crossing. clearance = body elevation − terrain(azimuth), so
 * |dc/dt| ≤ |d(el)/dt| + G·|d(az)/dt| with G the mask's exact max azimuthal gradient.
 *
 * Assumptions (validated empirically against brute-force fine scanning in
 * tests/transition-stress.test.ts across polar AND low-latitude sites, 2020–2035):
 *  - Sun elevation rate ≤ the synodic angular rate (~0.51°/h); we allow 0.6°/h.
 *    Earth's libration-driven rate is smaller, so the same allowance over-bounds it.
 *  - A crossing only matters while elevation ≈ terrain (≤14°), where the azimuth-rate
 *    amplification 1/cos(el) ≤ 1.03. We nonetheless allow a generous 4°/h azimuth rate
 *    to cover low-latitude rise/set geometry. Near zenith the azimuth rate can spike,
 *    but clearance there is ≫0 (el − 14°) so no crossing is pruned incorrectly.
 * The bound is deliberately generous (larger ⇒ less pruning ⇒ safer). It is NOT
 * claimed as a tight analytic bound; it is a validated pruning heuristic, and any
 * interval where the adaptive budget is exhausted falls back to a uniform fine scan
 * so completeness never depends on the bound alone.
 */
export function clearanceRateBound(profile: TerrainProfile): number {
  const e = profile.elevations;
  let maxGradient = 0;
  for (let i = 0; i < e.length; i++) {
    const g = Math.abs(e[(i + 1) % e.length] - e[i]) / profile.resolutionDeg;
    if (g > maxGradient) maxGradient = g;
  }
  return 0.6 + maxGradient * 4.0; // no cap: steep terrain must not be under-bounded
}

export type { TransitionDiagnostics, UnresolvedInterval } from '../types/mission';

interface BodyDetection {
  events: TransitionEvent[];
  exhaustedCount: number;
  fallbackUsed: boolean;
  unresolved: UnresolvedInterval[];
  nodes: number;
}

/** Core adaptive detector for one body over coarse (time, clearance) samples. */
function detectBodyTransitions(
  site: LandingSite, config: MissionConfig, body: BodyKind | 'combined',
  coarse: { timeMs: number; c: number }[], rateBoundPerMs: number,
): BodyDetection {
  const events: TransitionEvent[] = [];
  const minStepMs = TRANSITION_MIN_STEP_MS;
  const evalC = (t: number) => clearanceAt(site, config, t, body);
  let exhaustedCount = 0;
  let fallbackUsed = false;
  let nodes = 0;
  const unresolved: UnresolvedInterval[] = [];
  const record = (t0: number, t1: number, c1: number) => {
    const targetVisible = c1 >= 0;
    const tc = refineCrossing(site, config, t0, t1, body, targetVisible);
    events.push({ timeMs: tc, body, visible: targetVisible });
  };
  for (let i = 1; i < coarse.length; i++) {
    const a = coarse[i - 1];
    const b = coarse[i];
    if (b.timeMs - a.timeMs <= 0) continue;
    let budget = TRANSITION_NODE_BUDGET;
    let hitBudget = false;
    const examine = (t0: number, cc0: number, t1: number, cc1: number): void => {
      const span = t1 - t0;
      if (span <= 0) return;
      if (budget <= 0) { hitBudget = true; return; }
      const signChange = (cc0 >= 0) !== (cc1 >= 0);
      const nearZero = Math.min(Math.abs(cc0), Math.abs(cc1)) < rateBoundPerMs * span;
      if (!signChange && !nearZero) return; // crossing kinematically impossible under the bound
      if (span <= minStepMs) { if (signChange) record(t0, t1, cc1); return; }
      budget--; nodes++;
      const tm = (t0 + t1) / 2;
      const cm = evalC(tm);
      examine(t0, cc0, tm, cm);
      examine(tm, cm, t1, cc1);
    };
    examine(a.timeMs, a.c, b.timeMs, b.c);
    if (hitBudget) {
      // Never silently return apparently-complete results: fall back to a uniform
      // fine scan of the WHOLE interval at the resolution floor, bisecting every sign
      // change. Duplicates with the partial adaptive pass are merged below.
      exhaustedCount++;
      fallbackUsed = true;
      const steps = Math.ceil((b.timeMs - a.timeMs) / minStepMs);
      const FALLBACK_CAP = 20_000;
      if (steps > FALLBACK_CAP) {
        unresolved.push({ startMs: a.timeMs, endMs: b.timeMs, body });
      } else {
        let pt = a.timeMs, pc = a.c;
        for (let k = 1; k <= steps; k++) {
          const nt = k === steps ? b.timeMs : a.timeMs + k * minStepMs;
          const nc = k === steps ? b.c : evalC(nt);
          nodes++;
          if ((pc >= 0) !== (nc >= 0)) record(pt, nt, nc);
          pt = nt; pc = nc;
        }
      }
    }
  }
  return { events, exhaustedCount, fallbackUsed, unresolved, nodes };
}

/** Merge duplicate crossings (same body + direction within the resolution floor). */
function dedupEvents(events: TransitionEvent[]): TransitionEvent[] {
  const sorted = [...events].sort((x, y) => x.timeMs - y.timeMs);
  const out: TransitionEvent[] = [];
  for (const e of sorted) {
    const dup = out.some((o) => o.body === e.body && o.visible === e.visible && Math.abs(o.timeMs - e.timeMs) <= TRANSITION_MIN_STEP_MS);
    if (!dup) out.push(e);
  }
  return out;
}

export interface TransitionResult { events: TransitionEvent[]; diagnostics: TransitionDiagnostics }

/**
 * Detect visibility transitions with adaptive temporal refinement + explicit
 * reliability diagnostics. Consecutive-sample sign changes alone miss a short window
 * that begins and ends inside one coarse interval, so flagged intervals are subdivided
 * adaptively and each crossing bisected to TRANSITION_MIN_STEP_MS. If the adaptive node
 * budget is exhausted the interval is re-scanned uniformly at the resolution floor
 * (safe fallback) and the diagnostics disclose it — results are never silently incomplete.
 */
export function findTransitions(
  site: LandingSite, config: MissionConfig, samples: EvaluatedSample[],
): TransitionResult {
  const rateBound = clearanceRateBound(site.terrain);
  const diagnostics: TransitionDiagnostics = {
    nodeBudgetPerInterval: TRANSITION_NODE_BUDGET, minStepMs: TRANSITION_MIN_STEP_MS,
    rateBoundDegPerHour: rateBound, budgetExhausted: false, exhaustedIntervals: 0,
    fallbackUsed: false, unresolvedIntervals: [], nodesEvaluated: 0, resolutionStatus: 'resolved',
  };
  if (samples.length < 2) return { events: [], diagnostics };
  const rateBoundPerMs = rateBound / HOUR_MS;
  const bodies: (BodyKind | 'combined')[] = ['sun', 'earth', 'combined'];
  let all: TransitionEvent[] = [];
  for (const body of bodies) {
    const coarse = samples.map((s) => ({ timeMs: s.timeMs, c: clearanceOf(s, body, config.commsMarginDeg) }));
    const det = detectBodyTransitions(site, config, body, coarse, rateBoundPerMs);
    all = all.concat(det.events);
    diagnostics.exhaustedIntervals += det.exhaustedCount;
    diagnostics.fallbackUsed = diagnostics.fallbackUsed || det.fallbackUsed;
    diagnostics.unresolvedIntervals.push(...det.unresolved);
    diagnostics.nodesEvaluated += det.nodes;
  }
  diagnostics.budgetExhausted = diagnostics.exhaustedIntervals > 0;
  diagnostics.resolutionStatus = diagnostics.unresolvedIntervals.length > 0
    ? 'degraded'
    : diagnostics.fallbackUsed ? 'fallback-resolved' : 'resolved';
  return { events: dedupEvents(all), diagnostics };
}

export interface NextEvent { timeMs: number; visible: boolean }

/**
 * Forward scan for countdowns when the active window has no crossing. Uses the SAME
 * adaptive detector as findTransitions (not an independent hourly sign-change scan that
 * could miss a short window): a coarse forward grid is built and passed through the
 * adaptive refinement, so a brief visibility window inside one coarse step is still found.
 */
export function findNextTransition(
  site: LandingSite, config: MissionConfig, fromMs: number, body: BodyKind, maxDays = 40,
): NextEvent | null {
  const endMs = fromMs + maxDays * 24 * HOUR_MS;
  const step = HOUR_MS;
  const coarse: { timeMs: number; c: number }[] = [];
  for (let t = fromMs; t <= endMs; t += step) coarse.push({ timeMs: t, c: clearanceAt(site, config, t, body) });
  if (coarse.length < 2) return null;
  const rateBoundPerMs = clearanceRateBound(site.terrain) / HOUR_MS;
  const det = detectBodyTransitions(site, config, body, coarse, rateBoundPerMs);
  const future = dedupEvents(det.events).filter((e) => e.timeMs > fromMs).sort((a, b) => a.timeMs - b.timeMs);
  if (future.length === 0) return null;
  return { timeMs: future[0].timeMs, visible: future[0].visible };
}
