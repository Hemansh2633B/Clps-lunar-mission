import type { EvaluatedSample, LandingSite, MissionConfig, MissionSummary, PowerState, SamplingInfo, ScoreBreakdown, TransitionEvent, VisibilityState } from '../types/mission';
import { AU_KM, HOUR_MS, SOLAR_CONSTANT_WM2, clamp, wrap180 } from './constants';

export function solarFlux(distanceKm: number): number {
  const au = distanceKm / AU_KM;
  return SOLAR_CONSTANT_WM2 / (au * au);
}

export function computePower(
  elevationDeg: number,
  azimuthDeg: number,
  distanceKm: number,
  sunVisibility: VisibilityState,
  config: MissionConfig,
): PowerState {
  const fluxWm2 = solarFlux(distanceKm);
  const area = config.arrayAreaM2 * config.cellEfficiency * config.systemDerate;
  // Visibility is terrain-relative: a Sun slightly below the reference tangent
  // can still illuminate a site whose local DEM horizon is lower. Horizontal
  // decks receive nothing at negative elevation; vertical masts can still track.
  if (!sunVisibility.visible) {
    return {
      fluxWm2,
      horizontalW: 0,
      verticalTrackingW: 0,
      verticalFixedW: 0,
      selectedW: 0,
      horizontalIncidence: 0,
      verticalIncidence: 0,
    };
  }
  const el = (elevationDeg * Math.PI) / 180;
  const horizontalIncidence = Math.max(0, Math.sin(el));
  const verticalTrackingIncidence = Math.max(0, Math.cos(el));
  const azDiff = (wrap180(azimuthDeg - config.fixedPanelAzimuthDeg) * Math.PI) / 180;
  const verticalFixedIncidence = Math.max(0, Math.cos(el) * Math.cos(azDiff));
  const horizontalW = fluxWm2 * area * horizontalIncidence;
  const verticalTrackingW = fluxWm2 * area * verticalTrackingIncidence;
  const verticalFixedW = fluxWm2 * area * verticalFixedIncidence;
  const selectedW =
    config.arrayMode === 'horizontal' ? horizontalW
      : config.arrayMode === 'vertical-fixed' ? verticalFixedW
        : verticalTrackingW;
  return {
    fluxWm2,
    horizontalW,
    verticalTrackingW,
    verticalFixedW,
    selectedW,
    horizontalIncidence,
    verticalIncidence: config.arrayMode === 'vertical-fixed' ? verticalFixedIncidence : verticalTrackingIncidence,
  };
}

export interface BatteryResult {
  minSocPct: number;
  finalSocPct: number;
  depletionHours: number;
  firstDepletionMs: number | null;
}

// Battery engineering assumptions (documented; NOT thermal survival): charge
// efficiency 0.92, discharge efficiency 0.95, hard SOC bounds [0, capacity],
// configurable initial SOC, per-interval integration (works for irregular steps),
// zero-crossing interpolated within the crossing interval. No thermal, radiation,
// or depth-of-discharge life modeling is performed.
export const BATTERY_CHARGE_EFF = 0.92;
export const BATTERY_DISCHARGE_EFF = 0.95;

export function simulateBattery(samples: EvaluatedSample[], config: MissionConfig): BatteryResult {
  const cap = Math.max(0.001, config.batteryCapacityKWh);
  const initSoc = clamp(config.initialSocPct, 0, 100);
  if (samples.length === 0) {
    return { minSocPct: initSoc, finalSocPct: initSoc, depletionHours: 0, firstDepletionMs: null };
  }
  let soc = (initSoc / 100) * cap;
  let minSoc = soc;
  let depletionHours = 0;
  let firstDepletionMs: number | null = soc <= 0 ? samples[0]?.timeMs ?? null : null;
  for (let i = 1; i < samples.length; i++) {
    const dtH = (samples[i].timeMs - samples[i - 1].timeMs) / HOUR_MS;
    if (dtH <= 0) continue; // guard against non-monotonic / duplicate timestamps
    const avgW = (samples[i].power.selectedW + samples[i - 1].power.selectedW) / 2;
    const netKWh = ((avgW - config.loadW) * dtH) / 1000;
    const before = soc;
    const raw = before + (netKWh >= 0 ? netKWh * BATTERY_CHARGE_EFF : netKWh / BATTERY_DISCHARGE_EFF);
    if (raw <= 0) {
      // Linearly interpolate the zero-crossing inside this sample interval.
      const frac = before > 0 ? clamp(before / Math.max(1e-9, before - raw), 0, 1) : 0;
      if (firstDepletionMs === null) {
        firstDepletionMs = samples[i - 1].timeMs + frac * (samples[i].timeMs - samples[i - 1].timeMs);
      }
      depletionHours += dtH * (1 - frac);
    }
    soc = clamp(raw, 0, cap);
    minSoc = Math.min(minSoc, soc);
  }
  return {
    minSocPct: (minSoc / cap) * 100,
    finalSocPct: (soc / cap) * 100,
    depletionHours,
    firstDepletionMs,
  };
}

function longestGapHours(samples: EvaluatedSample[], events: TransitionEvent[], body: 'sun' | 'earth' | 'combined', startMs: number, endMs: number): number {
  if (samples.length === 0) return 0;
  const stateAt = (s: EvaluatedSample) => body === 'sun' ? s.sunVisibility.visible : body === 'earth' ? s.earthVisibility.visible : s.viable;
  let visible = stateAt(samples[0]);
  let cursor = startMs;
  let longest = 0;
  const relevant = events.filter((e) => e.body === body).sort((a, b) => a.timeMs - b.timeMs);
  for (const e of relevant) {
    if (!visible) longest = Math.max(longest, (e.timeMs - cursor) / HOUR_MS);
    visible = e.visible;
    cursor = e.timeMs;
  }
  if (!visible) longest = Math.max(longest, (endMs - cursor) / HOUR_MS);
  return longest;
}

function integrate(samples: EvaluatedSample[], pick: (s: EvaluatedSample) => number): number {
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    const dtH = (samples[i].timeMs - samples[i - 1].timeMs) / HOUR_MS;
    total += ((pick(samples[i]) + pick(samples[i - 1])) / 2) * dtH;
  }
  return total;
}

/**
 * Exact visible duration (hours) from the refined transition timestamps. The events
 * partition [startMs, endMs] into intervals of constant visibility, so this uses the
 * accurately bisected crossing times rather than a coarse trapezoid over samples.
 */
function visibleHoursFromEvents(
  samples: EvaluatedSample[], events: TransitionEvent[], body: 'sun' | 'earth' | 'combined',
  startMs: number, endMs: number,
): number {
  if (samples.length === 0 || endMs <= startMs) return 0;
  const stateAt = (s: EvaluatedSample) => body === 'sun' ? s.sunVisibility.visible : body === 'earth' ? s.earthVisibility.visible : s.viable;
  let visible = stateAt(samples[0]);
  let cursor = startMs;
  let totalMs = 0;
  const relevant = events.filter((e) => e.body === body).sort((a, b) => a.timeMs - b.timeMs);
  for (const e of relevant) {
    const t = clamp(e.timeMs, startMs, endMs);
    if (t < cursor) continue;
    if (visible) totalMs += t - cursor;
    visible = e.visible;
    cursor = t;
  }
  if (visible) totalMs += endMs - cursor;
  return totalMs / HOUR_MS;
}

function pctFromHours(hours: number, durationHours: number): number {
  return durationHours > 0 ? clamp((hours / durationHours) * 100, 0, 100) : 0;
}

export function terrainDataConfidence(site: LandingSite): MissionSummary['dataConfidence'] {
  if (site.terrain.synthetic) return 'synthetic';
  if (site.terrain.kind === 'dem') return 'measured';
  if (site.dataConfidence) return site.dataConfidence;
  if (site.terrain.kind === 'illustrative' || site.terrain.kind === 'custom') return 'illustrative';
  return 'synthetic';
}

export function summarizeMission(
  samples: EvaluatedSample[],
  events: TransitionEvent[],
  config: MissionConfig,
  startMs: number,
  endMs: number,
  sampling?: SamplingInfo,
  site?: LandingSite,
): MissionSummary {
  const durationHours = (endMs - startMs) / HOUR_MS;
  const sunElevs = samples.map((s) => s.sun.elevationDeg);
  const visibleSun = samples.filter((s) => s.sunVisibility.visible);
  const earthElevs = samples.map((s) => s.earth.elevationDeg);
  const peakSunElevationDeg = sunElevs.length ? Math.max(...sunElevs) : 0;
  const peakEarthElevationDeg = earthElevs.length ? Math.max(...earthElevs) : 0;
  const meanSunElevationDeg = sunElevs.length ? sunElevs.reduce((a, b) => a + b, 0) / sunElevs.length : 0;
  const meanVisibleSunElevationDeg = visibleSun.length ? visibleSun.reduce((a, s) => a + s.sun.elevationDeg, 0) / visibleSun.length : 0;
  // Percentages integrate the refined transition timestamps (exact interval boundaries),
  // not a coarse trapezoid over samples — so they converge as the sampling is refined.
  const illuminationPct = pctFromHours(visibleHoursFromEvents(samples, events, 'sun', startMs, endMs), durationHours);
  const dtePct = pctFromHours(visibleHoursFromEvents(samples, events, 'earth', startMs, endMs), durationHours);
  const combinedPct = pctFromHours(visibleHoursFromEvents(samples, events, 'combined', startMs, endMs), durationHours);
  const horizontalEnergyKWh = integrate(samples, (s) => s.power.horizontalW) / 1000;
  const verticalEnergyKWh = integrate(samples, (s) => s.power.verticalTrackingW) / 1000;
  const selectedEnergyKWh = integrate(samples, (s) => s.power.selectedW) / 1000;
  const meanHours = Math.max(durationHours, 1e-9);
  const battery = simulateBattery(samples, config);
  const earthNeverVisible = peakEarthElevationDeg < -5;
  const longestEclipseHours = longestGapHours(samples, events, 'sun', startMs, endMs);
  const longestDteGapHours = longestGapHours(samples, events, 'earth', startMs, endMs);
  const longestCombinedGapHours = longestGapHours(samples, events, 'combined', startMs, endMs);

  const survivalScore = battery.depletionHours <= 0 ? 100 : clamp(100 - (battery.depletionHours / Math.max(1, durationHours)) * 160, 0, 100);
  // Application-defined heuristic weights (documented, NOT a NASA methodology).
  const W = { combined: 0.45, illumination: 0.2, earth: 0.15, energy: 0.2 };
  const feasibilityScore = Math.round(
    combinedPct * W.combined + illuminationPct * W.illumination + dtePct * W.earth + survivalScore * W.energy,
  );
  const dataConfidence = site ? terrainDataConfidence(site) : 'illustrative';
  const frameVerified = site ? (site.terrain.kind === 'dem' ? (site.terrain.frameVerified ?? false) : true) : true;
  const scoreBreakdown: ScoreBreakdown = {
    heuristic: true,
    weightsSum: W.combined + W.illumination + W.earth + W.energy,
    dataConfidence,
    components: [
      { key: 'combined', label: 'Simultaneous Sun + Earth visibility', valuePct: combinedPct, weight: W.combined, contribution: combinedPct * W.combined },
      { key: 'illumination', label: 'Solar illumination', valuePct: illuminationPct, weight: W.illumination, contribution: illuminationPct * W.illumination },
      { key: 'earth', label: 'Geometric Earth line-of-sight', valuePct: dtePct, weight: W.earth, contribution: dtePct * W.earth },
      { key: 'energy', label: 'Energy-balance margin (battery model)', valuePct: survivalScore, weight: W.energy, contribution: survivalScore * W.energy },
    ],
    note: 'Application-defined heuristic, not a NASA methodology. '
      + (dataConfidence !== 'measured' ? 'Terrain is not a measured DEM — treat this ranking as indicative, not as a measured-terrain comparison. ' : '')
      + 'The energy component reflects the battery model only, not thermal or other engineering survival constraints.',
  };

  let verdict: MissionSummary['verdict'];
  let verdictReason: string;
  if (earthNeverVisible || dtePct === 0) {
    verdict = 'RELAY REQUIRED';
    verdictReason = 'Earth never clears the local geometric horizon: direct-to-Earth visibility is zero, so a relay orbiter is required. (Geometric line-of-sight only — not an RF link budget.)';
  } else if (battery.depletionHours > 0) {
    verdict = 'ENERGY DEFICIT';
    verdictReason = `The battery model reaches 0% after ${battery.depletionHours.toFixed(1)} h of cumulative energy deficit. Increase array area, reduce load, or shift the window. Energy-balance result only — thermal survival is not modeled.`;
  } else if (combinedPct >= 80 && illuminationPct >= 80 && dtePct >= 80) {
    verdict = 'NOMINAL';
    verdictReason = 'Sun and Earth are simultaneously visible for most of the window, with a positive modeled energy margin.';
  } else if (combinedPct >= 45) {
    verdict = 'CONDITIONAL';
    verdictReason = 'Operable with stored-energy management and scheduled Earth-visibility passes. Review the longest combined gap.';
  } else {
    verdict = 'HIGH RISK';
    verdictReason = 'Less than half of the window has simultaneous solar power and geometric Earth line-of-sight.';
  }

  return {
    startMs,
    endMs,
    durationHours,
    sampleCount: samples.length,
    illuminationPct,
    dtePct,
    combinedPct,
    meanSunElevationDeg,
    meanVisibleSunElevationDeg,
    peakSunElevationDeg,
    peakEarthElevationDeg,
    meanHorizontalW: (horizontalEnergyKWh * 1000) / meanHours,
    meanVerticalTrackingW: (verticalEnergyKWh * 1000) / meanHours,
    meanSelectedW: (selectedEnergyKWh * 1000) / meanHours,
    peakSelectedW: samples.length ? Math.max(...samples.map((s) => s.power.selectedW)) : 0,
    horizontalEnergyKWh,
    verticalEnergyKWh,
    selectedEnergyKWh,
    longestEclipseHours,
    longestDteGapHours,
    longestCombinedGapHours,
    minBatterySocPct: battery.minSocPct,
    finalBatterySocPct: battery.finalSocPct,
    depletionHours: battery.depletionHours,
    firstDepletionMs: battery.firstDepletionMs,
    earthNeverVisible,
    feasibilityScore: clamp(feasibilityScore, 0, 100),
    verdict,
    verdictReason,
    sampling: sampling ?? {
      requestedStepMinutes: config.stepMinutes, effectiveStepMinutes: config.stepMinutes,
      sampleCount: samples.length, capped: false, maxGapMinutes: 0, strategy: 'uniform',
    },
    scoreBreakdown,
    dataConfidence,
    frameVerified,
  };
}
