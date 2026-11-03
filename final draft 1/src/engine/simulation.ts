import type { EvaluatedSample, LandingSite, MissionConfig, SimulationResult } from '../types/mission';
import { DAY_MS, HOUR_MS, clamp } from './constants';
import { computeEphemeris } from './ephemeris';
import { findTransitions, visibilityFor } from './horizonPhysics';
import { computePower, summarizeMission } from './powerComms';

export const DEFAULT_CONFIG: MissionConfig = {
  durationDays: 10,
  arrayMode: 'vertical-tracking',
  arrayAreaM2: 6,
  cellEfficiency: 0.28,
  systemDerate: 0.85,
  fixedPanelAzimuthDeg: 0,
  loadW: 180,
  batteryCapacityKWh: 20,
  initialSocPct: 80,
  commsMarginDeg: 0,
  stepMinutes: 15,
};

export function evaluateAt(site: LandingSite, timeMs: number, config: MissionConfig): EvaluatedSample {
  const eph = computeEphemeris(site, timeMs);
  const sunVisibility = visibilityFor('sun', eph.sun.elevationDeg, eph.sun.azimuthDeg, site.terrain);
  const earthVisibility = visibilityFor('earth', eph.earth.elevationDeg, eph.earth.azimuthDeg, site.terrain, config.commsMarginDeg);
  const power = computePower(eph.sun.elevationDeg, eph.sun.azimuthDeg, eph.sun.distanceKm, sunVisibility, config);
  return {
    timeMs,
    sun: eph.sun,
    earth: eph.earth,
    sunVisibility,
    earthVisibility,
    power,
    viable: sunVisibility.visible && earthVisibility.visible,
    libration: eph.libration,
    subsolarLatitudeDeg: eph.subsolarLatitudeDeg,
    subsolarLongitudeDeg: eph.subsolarLongitudeDeg,
  };
}

export function simulateMission(site: LandingSite, startMs: number, endMs: number, config: MissionConfig): SimulationResult {
  const t0 = performance.now();
  const stepMs = clamp(config.stepMinutes, 1, 240) * 60_000;
  const span = Math.max(HOUR_MS, endMs - startMs);
  const count = Math.min(20_000, Math.max(2, Math.ceil(span / stepMs) + 1));
  const samples: EvaluatedSample[] = [];
  for (let i = 0; i < count; i++) {
    const timeMs = i === count - 1 ? endMs : startMs + i * stepMs;
    samples.push(evaluateAt(site, timeMs, config));
  }
  const events = findTransitions(site, config, samples);
  const summary = summarizeMission(samples, events, config, startMs, endMs);
  return { site, config, samples, events, summary, computeMs: performance.now() - t0 };
}

export function simulationKey(site: LandingSite, startMs: number, endMs: number, config: MissionConfig): string {
  const terrainHash = site.terrain.elevations.map((v) => v.toFixed(3)).join(',');
  return [
    site.id, site.latitude.toFixed(5), site.longitude.toFixed(5), site.elevationM,
    site.terrain.kind, site.terrain.resolutionDeg, site.terrain.eyeHeightM, site.terrain.sourceFrame ?? '', site.terrain.synthetic ? 'synthetic' : 'real',
    terrainHash,
    Math.round(startMs / 60000), Math.round(endMs / 60000),
    config.durationDays, config.arrayMode, config.arrayAreaM2, config.cellEfficiency, config.systemDerate,
    config.fixedPanelAzimuthDeg, config.loadW, config.batteryCapacityKWh, config.initialSocPct,
    config.commsMarginDeg, config.stepMinutes,
  ].join('|');
}

export function analysisWindow(baselineMs: number, slipDays: number, durationDays: number, viewDays: number) {
  const startMs = baselineMs - 2 * DAY_MS;
  const missionStart = baselineMs + slipDays * DAY_MS;
  const needed = slipDays + durationDays + 5;
  const days = Math.max(viewDays, needed);
  return { startMs, endMs: startMs + days * DAY_MS, missionStart, missionEnd: missionStart + durationDays * DAY_MS };
}
