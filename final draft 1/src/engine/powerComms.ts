import type { EvaluatedSample, MissionConfig, MissionSummary, PowerState, TransitionEvent, VisibilityState } from '../types/mission';
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

export function simulateBattery(samples: EvaluatedSample[], config: MissionConfig): BatteryResult {
  const cap = Math.max(0.001, config.batteryCapacityKWh);
  let soc = (clamp(config.initialSocPct, 0, 100) / 100) * cap;
  let minSoc = soc;
  let depletionHours = 0;
  let firstDepletionMs: number | null = soc <= 0 ? samples[0]?.timeMs ?? null : null;
  for (let i = 1; i < samples.length; i++) {
    const dtH = (samples[i].timeMs - samples[i - 1].timeMs) / HOUR_MS;
    const avgW = (samples[i].power.selectedW + samples[i - 1].power.selectedW) / 2;
    const netKWh = ((avgW - config.loadW) * dtH) / 1000;
    const before = soc;
    const raw = before + (netKWh >= 0 ? netKWh * 0.92 : netKWh / 0.95);
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

function fraction(samples: EvaluatedSample[], pick: (s: EvaluatedSample) => boolean): number {
  if (samples.length < 2) return samples.length === 1 && pick(samples[0]) ? 100 : 0;
  const total = integrate(samples, (s) => (pick(s) ? 1 : 0));
  const hours = (samples[samples.length - 1].timeMs - samples[0].timeMs) / HOUR_MS;
  return hours > 0 ? clamp((total / hours) * 100, 0, 100) : 0;
}

export function summarizeMission(
  samples: EvaluatedSample[],
  events: TransitionEvent[],
  config: MissionConfig,
  startMs: number,
  endMs: number,
): MissionSummary {
  const durationHours = (endMs - startMs) / HOUR_MS;
  const sunElevs = samples.map((s) => s.sun.elevationDeg);
  const visibleSun = samples.filter((s) => s.sunVisibility.visible);
  const earthElevs = samples.map((s) => s.earth.elevationDeg);
  const peakSunElevationDeg = sunElevs.length ? Math.max(...sunElevs) : 0;
  const peakEarthElevationDeg = earthElevs.length ? Math.max(...earthElevs) : 0;
  const meanSunElevationDeg = sunElevs.length ? sunElevs.reduce((a, b) => a + b, 0) / sunElevs.length : 0;
  const meanVisibleSunElevationDeg = visibleSun.length ? visibleSun.reduce((a, s) => a + s.sun.elevationDeg, 0) / visibleSun.length : 0;
  const illuminationPct = fraction(samples, (s) => s.sunVisibility.visible);
  const dtePct = fraction(samples, (s) => s.earthVisibility.visible);
  const combinedPct = fraction(samples, (s) => s.viable);
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
  const feasibilityScore = Math.round(
    combinedPct * 0.45 + illuminationPct * 0.2 + dtePct * 0.15 + survivalScore * 0.2,
  );

  let verdict: MissionSummary['verdict'];
  let verdictReason: string;
  if (earthNeverVisible || dtePct === 0) {
    verdict = 'RELAY REQUIRED';
    verdictReason = 'Earth never clears the local horizon. A relay orbiter is mandatory for any communications.';
  } else if (battery.depletionHours > 0) {
    verdict = 'SURVIVAL RISK';
    verdictReason = `Battery reaches 0% after ${battery.depletionHours.toFixed(1)} h of cumulative deficit. Increase array area, reduce load, or shift the window.`;
  } else if (combinedPct >= 80 && illuminationPct >= 80 && dtePct >= 80) {
    verdict = 'NOMINAL';
    verdictReason = 'Sun and Earth are simultaneously visible for most of the window, with positive energy margin.';
  } else if (combinedPct >= 45) {
    verdict = 'CONDITIONAL';
    verdictReason = 'Operable with stored-energy management and scheduled DTE passes. Review the longest combined gap.';
  } else {
    verdict = 'HIGH RISK';
    verdictReason = 'Less than half of the window has simultaneous power and Direct-to-Earth visibility.';
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
  };
}
