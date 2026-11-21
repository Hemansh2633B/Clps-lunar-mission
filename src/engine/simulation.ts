import type { AnalysisAssessment, EvaluatedSample, LandingSite, MissionConfig, SamplingInfo, SimulationResult, TransitionDiagnostics } from '../types/mission';
import { DAY_MS, clamp } from './constants';
import { computeEphemeris } from './ephemeris';
import { findTransitions, visibilityFor, TRANSITION_MIN_STEP_MS, TRANSITION_NODE_BUDGET } from './horizonPhysics';
import { computePower, summarizeMission } from './powerComms';
import { integrateMissionEnergy } from './integration';
import { assessTerrainEligibility, numericalResolutionBlocked, computationFailed } from './analysisStatus';
import { solarIncidence, type SlopeSpec } from './incidence';
import { evaluateRelay, relayConfigured } from './relay';
import { sanitizeConfig } from './configLimits';
import { canonicalJson } from './canonicalJson';

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

/**
 * Local slope for incidence, or null when none is known. A synthetic or
 * user-edited grid is labelled `custom`; only a real DEM is labelled `dem`.
 * Nothing is ever invented: `incidence` is absent without a slope.
 */
export function slopeOf(site: LandingSite): SlopeSpec | null {
  const t = site.terrain;
  if (t.slopeDeg == null || t.aspectDeg == null) return null;
  if (!Number.isFinite(t.slopeDeg) || !Number.isFinite(t.aspectDeg)) return null;
  return { slopeDeg: t.slopeDeg, aspectDeg: t.aspectDeg, source: t.kind === 'dem' && !t.synthetic ? 'dem' : 'custom' };
}

/**
 * One instant of the analysis. The three obstruction channels stay separate:
 * the lunar limb (curvature), the local terrain mask, and the local horizontal
 * plane. Relay geometry is evaluated only when a relay state is configured.
 */
export function evaluateAt(site: LandingSite, timeMs: number, config: MissionConfig): EvaluatedSample {
  const eph = computeEphemeris(site, timeMs);
  const limbFloorDeg = eph.geometry.limb.limbElevationDeg;
  const sunVisibility: EvaluatedSample['sunVisibility'] = {
    ...visibilityFor('sun', eph.sun.elevationDeg, eph.sun.azimuthDeg, site.terrain, 0, limbFloorDeg),
    bodyOccultation: eph.geometry.sunOccultation.state,
    occultedFraction: eph.geometry.sunOccultation.occultedFraction,
    angularRadiusDeg: eph.geometry.sunAngularRadiusDeg,
  };
  const earthVisibility: EvaluatedSample['earthVisibility'] = {
    ...visibilityFor('earth', eph.earth.elevationDeg, eph.earth.azimuthDeg, site.terrain, config.commsMarginDeg, limbFloorDeg),
    bodyOccultation: eph.geometry.earthOccultation.state,
    occultedFraction: eph.geometry.earthOccultation.occultedFraction,
    angularRadiusDeg: eph.geometry.earthAngularRadiusDeg,
  };
  const slope = slopeOf(site);
  const incidence = slope ? solarIncidence(eph.sun.azimuthDeg, eph.sun.elevationDeg, slope) : undefined;
  const power = computePower(eph.sun.elevationDeg, eph.sun.azimuthDeg, eph.sun.distanceKm, sunVisibility, config, incidence?.cosIncidence);
  const relay = relayConfigured(config.relay)
    ? evaluateRelay({ relay: config.relay, site, profile: site.terrain, geom: eph.geometry, timeMs })
    : null;
  return {
    timeMs,
    sun: eph.sun,
    earth: eph.earth,
    sunVisibility,
    earthVisibility,
    power,
    // Mission viability = surface power AND a path to Earth (direct geometric
    // LOS or a configured relay whose BOTH legs are geometrically clear).
    // Legacy mission viability remains the direct-to-Earth metric for API and
    // regression compatibility. Relay windows are a separate track/summary;
    // they never rewrite the direct-Earth availability claim.
    viable: sunVisibility.visible && earthVisibility.visible,
    libration: eph.libration,
    subsolarLatitudeDeg: eph.subsolarLatitudeDeg,
    subsolarLongitudeDeg: eph.subsolarLongitudeDeg,
    lunar: {
      dipDeg: eph.geometry.limb.dipDeg,
      limbElevationDeg: limbFloorDeg,
      sunOccultation: eph.geometry.sunOccultation.state,
      earthOccultation: eph.geometry.earthOccultation.state,
      sunLimbClearanceDeg: eph.geometry.sunOccultation.limbClearanceDeg,
      earthLimbClearanceDeg: eph.geometry.earthOccultation.limbClearanceDeg,
    },
    ...(incidence ? { incidence } : {}),
    relay,
  };
}

export const MAX_SAMPLES = 20_000;

/** Coarse phase progress for long windows. Fractions are approximate phase weights,
 *  not precise timing — the sampling loop dominates, refinement/integration follow. */
export interface SimulationProgress {
  phase: 'sampling' | 'transitions' | 'energy' | 'summary';
  fraction: number;
}
export type ProgressCallback = (p: SimulationProgress) => void;

/**
 * Sample the mission window uniformly, preserving BOTH endpoints and the full
 * requested interval. If the requested step would exceed MAX_SAMPLES, the step is
 * coarsened UNIFORMLY across the whole window — never by keeping a fine step and
 * jumping to the end (which previously created an enormous final gap and corrupted
 * battery integration and visibility fractions). The effective step is reported.
 * Visibility transitions are then refined adaptively (see findTransitions).
 */
const EMPTY_TRANSITION_DIAG: TransitionDiagnostics = {
  nodeBudgetPerInterval: TRANSITION_NODE_BUDGET, minStepMs: TRANSITION_MIN_STEP_MS, rateBoundDegPerHour: 0,
  budgetExhausted: false, exhaustedIntervals: 0, fallbackUsed: false, unresolvedIntervals: [], nodesEvaluated: 0, resolutionStatus: 'resolved',
};
const EMPTY_SAMPLING: SamplingInfo = {
  requestedStepMinutes: 0, effectiveStepMinutes: 0, sampleCount: 0, capped: false, maxGapMinutes: 0, strategy: 'not computed (analysis blocked)',
};

/** A blocked result carries NO samples/events/summary — terrain stays viewable via site.terrain. */
function blockedResult(site: LandingSite, config: MissionConfig, analysis: AnalysisAssessment, t0: number): SimulationResult {
  return { site, config, samples: [], events: [], summary: null, computeMs: performance.now() - t0, sampling: EMPTY_SAMPLING, transitionDiagnostics: EMPTY_TRANSITION_DIAG, analysis, energyHistory: null };
}

export function simulateMission(site: LandingSite, startMs: number, endMs: number, config: MissionConfig, onProgress?: ProgressCallback): SimulationResult {
  const t0 = performance.now();
  // Defensive sanitization: invalid numeric values never propagate into a calculation.
  const cfg = sanitizeConfig(config);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return blockedResult(site, cfg, computationFailed('mission start/end is not a valid increasing UTC interval.'), t0);
  }
  // Computation-boundary scientific gate (independent of any UI import restriction).
  const analysis = assessTerrainEligibility(site, startMs, endMs);
  if (!analysis.demoEligible) return blockedResult(site, cfg, analysis, t0);

  try {
    const requestedStepMinutes = clamp(cfg.stepMinutes, 1, 240);
    const requestedStepMs = requestedStepMinutes * 60_000;
    const span = Math.max(0, endMs - startMs);
    const requestedCount = span > 0 ? Math.floor(span / requestedStepMs) + 1 : 2;
    const count = Math.min(MAX_SAMPLES, Math.max(2, requestedCount));
    const capped = requestedCount > MAX_SAMPLES;
    const effectiveStepMs = span > 0 ? span / (count - 1) : 0;
    const samples: EvaluatedSample[] = [];
    let maxGapMs = 0;
    let prev = startMs;
    const progressEvery = Math.max(1, Math.floor(count / 24));
    for (let i = 0; i < count; i++) {
      const timeMs = i === count - 1 ? endMs : startMs + i * effectiveStepMs;
      if (i > 0) maxGapMs = Math.max(maxGapMs, timeMs - prev);
      prev = timeMs;
      samples.push(evaluateAt(site, timeMs, cfg));
      if (onProgress && i % progressEvery === 0) onProgress({ phase: 'sampling', fraction: (i / count) * 0.6 });
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
    onProgress?.({ phase: 'transitions', fraction: 0.6 });
    const { events, diagnostics: transitionDiagnostics } = findTransitions(site, cfg, samples);
    // Never present apparently-complete results when the detector left intervals unresolved.
    if (transitionDiagnostics.resolutionStatus === 'degraded') {
      return { ...blockedResult(site, cfg, numericalResolutionBlocked(transitionDiagnostics.unresolvedIntervals.length), t0), samples, events, sampling, transitionDiagnostics };
    }
    onProgress?.({ phase: 'energy', fraction: 0.8 });
    const integration = integrateMissionEnergy(site, cfg, events, startMs, endMs);
    onProgress?.({ phase: 'summary', fraction: 0.95 });
    const summary = summarizeMission(samples, events, cfg, startMs, endMs, sampling, site, integration);
    return { site, config: cfg, samples, events, summary, computeMs: performance.now() - t0, sampling, transitionDiagnostics, analysis, energyHistory: integration.history };
  } catch (err) {
    return blockedResult(site, cfg, computationFailed(err instanceof Error ? err.message : String(err)), t0);
  }
}

/** Internal identity-format tag; independent of REPORT_SCHEMA_VERSION. */
export const SIMULATION_IDENTITY_VERSION = 'chandra-analysis-v3';

/**
 * Exact, synchronous cache/guard identity (v1.11). The full JSON-safe site
 * (including every terrain bin and metadata field), millisecond window and
 * caller config are canonically serialized without rounding. This is deliberately
 * conservative: editing a label or provenance note creates a new identity even
 * if the numerical result would be unchanged. Export fingerprints hash this same
 * string with SHA-256 (see utils/analysisId), using the EFFECTIVE config.
 *
 * v1.10 rounded elevations/coordinates/azimuth offsets and minute-rounded the
 * window, allowing distinct inputs to share a cache/guard/fingerprint identity.
 * Keys and fingerprints therefore change across v1.11; the opaque fingerprint
 * field keeps report schema 2.0.0. The 36-entry LRU is unchanged.
 */
export function simulationKey(site: LandingSite, startMs: number, endMs: number, config: MissionConfig): string {
  return `${SIMULATION_IDENTITY_VERSION}:${canonicalJson({ site, startMs, endMs, config })}`;
}

export function analysisWindow(baselineMs: number, slipDays: number, durationDays: number, viewDays: number) {
  const startMs = baselineMs - 2 * DAY_MS;
  const missionStart = baselineMs + slipDays * DAY_MS;
  const needed = slipDays + durationDays + 5;
  const days = Math.max(viewDays, needed);
  return { startMs, endMs: startMs + days * DAY_MS, missionStart, missionEnd: missionStart + durationDays * DAY_MS };
}
