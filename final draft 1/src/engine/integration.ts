/**
 * Event-aware energy + battery integration.
 *
 * Visibility percentages integrate the refined transition timestamps, but a coarse
 * trapezoid over the display samples would smear the array-output discontinuity at a
 * sunrise/sunset across a whole sample interval — so energy accuracy would NOT match
 * visibility accuracy. This module integrates generation on a timeline partitioned at
 * the REFINED illumination transitions (the array on/off discontinuities), using
 * adaptive Simpson quadrature between transitions (the Sun's elevation/azimuth vary
 * smoothly inside each lit interval). The battery is stepped over the SAME accepted
 * quadrature sub-intervals with the SAME generation integral, so the energy-balance
 * result is physically consistent with the reported generation. Charge/discharge
 * efficiencies, capacity bounds, initial SOC and the depletion zero-crossing are all
 * handled. A Richardson error estimate is reported as numerical uncertainty.
 */
import type { LandingSite, MissionConfig, TransitionEvent } from '../types/mission';
import { HOUR_MS, clamp } from './constants';
import { computeEphemeris } from './ephemeris';
import { visibilityFor } from './horizonPhysics';
import { computePower, BATTERY_CHARGE_EFF, BATTERY_DISCHARGE_EFF, type BatteryResult } from './powerComms';

export interface IntegrationDiagnostics {
  method: string;
  quadratureEvaluations: number;
  /** Largest accepted quadrature sub-interval (minutes). */
  maxIntervalMinutes: number;
  sunTransitionsIncluded: number;
  estimatedEnergyErrorKWh: number;
  relativeEnergyError: number;
  toleranceKWhPerInterval: number;
  resolutionStatus: 'converged' | 'adequate' | 'coarse';
}

export interface EnergyIntegrationResult {
  horizontalEnergyKWh: number;
  verticalEnergyKWh: number;
  verticalFixedEnergyKWh: number;
  selectedEnergyKWh: number;
  battery: BatteryResult;
  diagnostics: IntegrationDiagnostics;
}

type Vec3 = [number, number, number]; // [horizontal, vertical-tracking, vertical-fixed] watts
const vadd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vscale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const simpson = (fa: Vec3, fm: Vec3, fb: Vec3, h: number): Vec3 => [
  (h / 6) * (fa[0] + 4 * fm[0] + fb[0]),
  (h / 6) * (fa[1] + 4 * fm[1] + fb[1]),
  (h / 6) * (fa[2] + 4 * fm[2] + fb[2]),
];

const MAX_DEPTH = 16;
const TOL_KWH_PER_HOUR = 2e-5; // ~0.002% of a typical polar interval; Richardson-checked

/**
 * Integrate generation + battery over [startMs, endMs], partitioned at the refined Sun
 * visibility transitions. `events` supplies the refined crossings (only 'sun' events
 * affect generation). Samples are NOT used for the energy integral — the quadrature
 * re-evaluates the ephemeris where it needs to, independent of the display sampling.
 */
export function integrateMissionEnergy(
  site: LandingSite, config: MissionConfig, events: TransitionEvent[], startMs: number, endMs: number,
): EnergyIntegrationResult {
  const durationHours = Math.max(0, (endMs - startMs) / HOUR_MS);
  const cap = Math.max(0.001, config.batteryCapacityKWh);
  const selectedIndex = config.arrayMode === 'horizontal' ? 0 : config.arrayMode === 'vertical-fixed' ? 2 : 1;

  // Battery state (stepped over the accepted quadrature sub-intervals, in order).
  let soc = (clamp(config.initialSocPct, 0, 100) / 100) * cap;
  let minSoc = soc;
  let depletionHours = 0;
  let firstDepletionMs: number | null = soc <= 0 ? startMs : null;

  const energy: Vec3 = [0, 0, 0]; // kWh
  let evals = 0;
  let maxIntervalH = 0;
  let errorEstimateKWh = 0;

  const stepBattery = (t0H: number, t1H: number, avgSelectedW: number) => {
    const dtH = t1H - t0H;
    if (dtH <= 0) return;
    const netKWh = ((avgSelectedW - config.loadW) * dtH) / 1000;
    const before = soc;
    const raw = before + (netKWh >= 0 ? netKWh * BATTERY_CHARGE_EFF : netKWh / BATTERY_DISCHARGE_EFF);
    if (raw <= 0) {
      const frac = before > 0 ? clamp(before / Math.max(1e-9, before - raw), 0, 1) : 0;
      if (firstDepletionMs === null) firstDepletionMs = startMs + (t0H + frac * dtH) * HOUR_MS;
      depletionHours += dtH * (1 - frac);
    }
    soc = clamp(raw, 0, cap);
    minSoc = Math.min(minSoc, soc);
  };

  // Power integrand (watts). `lit` is the interval's constant Sun-visibility state, so
  // the on/off discontinuity sits exactly on a partition boundary, never inside a panel.
  const powerAt = (tMs: number, lit: boolean): Vec3 => {
    evals++;
    if (!lit) return [0, 0, 0];
    const eph = computeEphemeris(site, tMs);
    const vis = visibilityFor('sun', eph.sun.elevationDeg, eph.sun.azimuthDeg, site.terrain);
    const p = computePower(eph.sun.elevationDeg, eph.sun.azimuthDeg, eph.sun.distanceKm, vis, config);
    return [p.horizontalW, p.verticalTrackingW, p.verticalFixedW];
  };

  // Partition [start,end] at the refined Sun transitions.
  const sunTimes = events
    .filter((e) => e.body === 'sun' && e.timeMs > startMs && e.timeMs < endMs)
    .map((e) => e.timeMs)
    .sort((a, b) => a - b);
  const boundaries = [startMs, ...sunTimes, endMs];
  const startEph = computeEphemeris(site, startMs);
  let lit = visibilityFor('sun', startEph.sun.elevationDeg, startEph.sun.azimuthDeg, site.terrain).visible;
  const sunEventByTime = new Map(events.filter((e) => e.body === 'sun').map((e) => [e.timeMs, e.visible]));

  let toleranceUsed = 0;
  for (let i = 1; i < boundaries.length; i++) {
    const aH = (boundaries[i - 1] - startMs) / HOUR_MS;
    const bH = (boundaries[i] - startMs) / HOUR_MS;
    const intervalLit = lit;
    // After this interval, the state flips to the event's post-transition value.
    const evVisible = sunEventByTime.get(boundaries[i]);
    if (evVisible !== undefined) lit = evVisible;
    if (bH <= aH) continue;
    maxIntervalH = Math.max(maxIntervalH, bH - aH);
    const eps = Math.max(1e-6, TOL_KWH_PER_HOUR * (bH - aH)); // kWh, per interval
    toleranceUsed = eps;

    const f = (tH: number): Vec3 => powerAt(startMs + tH * HOUR_MS, intervalLit);
    const mH = (aH + bH) / 2;
    const fa = f(aH), fm = f(mH), fb = f(bH);
    const whole = simpson(fa, fm, fb, bH - aH);

    const onInterval = (t0H: number, t1H: number, integralWh: Vec3) => {
      const kwh = vscale(integralWh, 1 / 1000);
      energy[0] += kwh[0]; energy[1] += kwh[1]; energy[2] += kwh[2];
      const dtH = t1H - t0H;
      const avgSelectedW = dtH > 0 ? integralWh[selectedIndex] / dtH : 0;
      stepBattery(t0H, t1H, avgSelectedW);
    };

    const recurse = (a: number, faV: Vec3, m: number, fmV: Vec3, b: number, fbV: Vec3, wholeV: Vec3, tol: number, depth: number): { int: Vec3; err: number } => {
      const lm = (a + m) / 2, rm = (m + b) / 2;
      const flm = f(lm), frm = f(rm);
      const left = simpson(faV, flm, fmV, m - a);
      const right = simpson(fmV, frm, fbV, b - m);
      const combined = vadd(left, right);
      const diff = vsub(combined, wholeV);
      const err = Math.max(Math.abs(diff[0]), Math.abs(diff[1]), Math.abs(diff[2])); // Wh
      if (depth <= 0 || err <= 15 * tol * 1000) {
        const corrected = vadd(combined, vscale(diff, 1 / 15));
        onInterval(a, b, corrected);
        return { int: corrected, err: err / 15 };
      }
      const L = recurse(a, faV, lm, flm, m, fmV, left, tol / 2, depth - 1);
      const R = recurse(m, fmV, rm, frm, b, fbV, right, tol / 2, depth - 1);
      return { int: vadd(L.int, R.int), err: L.err + R.err };
    };
    const result = recurse(aH, fa, mH, fm, bH, fb, whole, eps, MAX_DEPTH);
    errorEstimateKWh += result.err / 1000;
  }

  const selectedEnergyKWh = energy[selectedIndex];
  const relativeEnergyError = selectedEnergyKWh > 1e-9 ? errorEstimateKWh / selectedEnergyKWh : 0;
  const diagnostics: IntegrationDiagnostics = {
    method: 'event-partitioned adaptive Simpson (battery on the same generation timeline)',
    quadratureEvaluations: evals,
    maxIntervalMinutes: maxIntervalH * 60,
    sunTransitionsIncluded: sunTimes.length,
    estimatedEnergyErrorKWh: errorEstimateKWh,
    relativeEnergyError,
    toleranceKWhPerInterval: toleranceUsed,
    resolutionStatus: relativeEnergyError < 1e-4 ? 'converged' : relativeEnergyError < 1e-2 ? 'adequate' : 'coarse',
  };

  return {
    horizontalEnergyKWh: energy[0],
    verticalEnergyKWh: energy[1],
    verticalFixedEnergyKWh: energy[2],
    selectedEnergyKWh,
    battery: {
      minSocPct: (minSoc / cap) * 100,
      finalSocPct: (soc / cap) * 100,
      depletionHours,
      firstDepletionMs,
    },
    diagnostics,
  };
}
