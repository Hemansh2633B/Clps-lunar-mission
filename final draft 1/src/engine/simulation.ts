import type { EvaluatedSample, LandingSite, MissionConfig, SamplingInfo, SimulationResult } from '../types/mission';
import { DAY_MS, clamp } from './constants';
import { computeEphemeris } from './ephemeris';
import { findTransitions, visibilityFor } from './horizonPhysics';
import { computePower, summarizeMission } from './powerComms';
import { integrateMissionEnergy } from './integration';

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

export const MAX_SAMPLES = 20_000;

/**
 * Sample the mission window uniformly, preserving BOTH endpoints and the full
 * requested interval. If the requested step would exceed MAX_SAMPLES, the step is
 * coarsened UNIFORMLY across the whole window — never by keeping a fine step and
 * jumping to the end (which previously created an enormous final gap and corrupted
 * battery integration and visibility fractions). The effective step is reported.
 * Visibility transitions are then refined adaptively (see findTransitions).
 */
export function simulateMission(site: LandingSite, startMs: number, endMs: number, config: MissionConfig): SimulationResult {
  const t0 = performance.now();
  const requestedStepMinutes = clamp(config.stepMinutes, 1, 240);
  const requestedStepMs = requestedStepMinutes * 60_000;
  const span = Math.max(0, endMs - startMs);
  const requestedCount = span > 0 ? Math.floor(span / requestedStepMs) + 1 : 2;
  const count = Math.min(MAX_SAMPLES, Math.max(2, requestedCount));
  const capped = requestedCount > MAX_SAMPLES;
  const effectiveStepMs = span > 0 ? span / (count - 1) : 0;
  const samples: EvaluatedSample[] = [];
  let maxGapMs = 0;
  let prev = startMs;
  for (let i = 0; i < count; i++) {
    const timeMs = i === count - 1 ? endMs : startMs + i * effectiveStepMs;
    if (i > 0) maxGapMs = Math.max(maxGapMs, timeMs - prev);
    prev = timeMs;
    samples.push(evaluateAt(site, timeMs, config));
  }
  const sampling: SamplingInfo = {
    requestedStepMinutes,
    effectiveStepMinutes: effectiveStepMs / 60_000,
    sampleCount: count,
    capped,
    maxGapMinutes: maxGapMs / 60_000,
    strategy: capped
      ? 'uniform; step coarsened to respect the 20,000-sample cap; adaptive transition refinement'
      : 'uniform; adaptive transition refinement',
  };
  const { events, diagnostics: transitionDiagnostics } = findTransitions(site, config, samples);
  const integration = integrateMissionEnergy(site, config, events, startMs, endMs);
  const summary = summarizeMission(samples, events, config, startMs, endMs, sampling, site, integration);
  return { site, config, samples, events, summary, computeMs: performance.now() - t0, sampling, transitionDiagnostics };
}

export function simulationKey(site: LandingSite, startMs: number, endMs: number, config: MissionConfig): string {
  const terrainHash = site.terrain.elevations.map((v) => v.toFixed(3)).join(',');
  return [
    site.id, site.latitude.toFixed(5), site.longitude.toFixed(5), site.elevationM,
    site.terrain.kind, site.terrain.resolutionDeg, site.terrain.eyeHeightM, site.terrain.sourceFrame ?? '', site.terrain.synthetic ? 'synthetic' : 'real',
    site.terrain.frameVerified ? 'fv1' : 'fv0', site.terrain.frameTransform ?? '', (site.terrain.azimuthOffsetDeg ?? 0).toFixed(4),
    site.terrain.coveragePercent ?? '', site.terrain.radiusKm ?? '', site.terrain.analysisScale ?? 'local',
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
