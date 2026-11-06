/**
 * Computation-boundary scientific validation (Section 8). The engine itself must block
 * invalid terrain from producing ordinary quantitative results — independent of any UI
 * import gate. Eligible demos compute but are flagged; blocked analyses yield summary=null.
 */
import { describe, expect, it } from 'vitest';
import { simulateMission, DEFAULT_CONFIG } from '../src/engine/simulation';
import { assessTerrainEligibility } from '../src/engine/analysisStatus';
import { sanitizeConfig, validateConfig } from '../src/engine/configLimits';
import { makeCustomSite, siteById } from '../src/data/landingSites';
import type { HorizonMask } from '../src/terrain/types';
import { DAY_MS } from '../src/engine/constants';

const START = Date.parse('2027-03-01T00:00:00Z');
const END = START + 10 * DAY_MS;

function mask(over: Partial<HorizonMask> = {}, frame = 'MOON_ME (JPL DE421)', synthetic = false): HorizonMask {
  const n = 360;
  return {
    latitude: -85, longitude: 0, radius_km: 5, horizon_radius_km: 4.9, edge_inset_m: 20,
    sampling_step_m: 40, grid_size: 257, grid_spacing_m: 40, eye_height_m: 2, azimuth_step_deg: 1,
    azimuths_deg: Array.from({ length: n }, (_, i) => i), elevations_deg: new Array(n).fill(0),
    ray_coverage_percent: new Array(n).fill(100), max_obstacle_range_km: new Array(n).fill(1),
    mean_coverage_percent: 100, synthetic,
    source: { filename: 'test.tif', lunar_radius_m: 1737400, elevation_reference_radius_m: 1737400, elevation_reference: 'sphere', lunar_reference_frame: frame, synthetic },
    model: 'ray-march', frame_note: '', ...over,
  };
}
const demSite = (frame?: string, over: Partial<HorizonMask> = {}, synthetic = false) =>
  makeCustomSite({ name: 'DEM', latitude: -85, longitude: 0, elevationM: 0, preset: 'flat', horizon: mask(over, frame, synthetic) });

describe('computation-boundary assessment', () => {
  it('a verified, complete, in-range measured DEM is VALID and quantitative', () => {
    const site = demSite();
    const a = assessTerrainEligibility(site, START, END);
    expect(a.status).toBe('VALID');
    expect(a.quantitativeEligible).toBe(true);
    const sim = simulateMission(site, START, END, DEFAULT_CONFIG);
    expect(sim.analysis.status).toBe('VALID');
    expect(sim.summary).not.toBeNull();
    expect(sim.samples.length).toBeGreaterThan(0);
  });

  it('an unknown-frame DEM is blocked at the engine even though it reached simulateMission', () => {
    const site = demSite('TOTALLY_UNKNOWN_FRAME');
    const sim = simulateMission(site, START, END, DEFAULT_CONFIG);
    expect(sim.analysis.status).toBe('FRAME_UNVERIFIED');
    expect(sim.analysis.quantitativeEligible).toBe(false);
    expect(sim.summary).toBeNull();
    expect(sim.samples.length).toBe(0); // no ordinary quantitative samples produced
    if ('reason' in sim.analysis) expect(sim.analysis.reason.length).toBeGreaterThan(0);
  });

  it('incomplete coverage blocks even with a verified frame', () => {
    const site = demSite('MOON_ME (JPL DE421)', { mean_coverage_percent: 92 });
    const sim = simulateMission(site, START, END, DEFAULT_CONFIG);
    expect(sim.analysis.status).toBe('INCOMPLETE_COVERAGE');
    expect(sim.summary).toBeNull();
  });

  it('a frame-corrected DEM outside the validated 2020–2035 range is blocked (no silent extrapolation)', () => {
    const site = demSite();
    const lateStart = Date.parse('2036-06-01T00:00:00Z');
    const sim = simulateMission(site, lateStart, lateStart + 10 * DAY_MS, DEFAULT_CONFIG);
    expect(sim.analysis.status).toBe('FRAME_MODEL_OUTSIDE_VALIDATED_RANGE');
    expect(sim.summary).toBeNull();
    // The same site inside the range is VALID.
    expect(simulateMission(site, START, END, DEFAULT_CONFIG).analysis.status).toBe('VALID');
  });

  it('synthetic terrain computes as a labeled demo, never quantitative', () => {
    const site = demSite('SYNTHETIC', {}, true);
    const sim = simulateMission(site, START, END, DEFAULT_CONFIG);
    expect(sim.analysis.status).toBe('SYNTHETIC_DEMO');
    expect(sim.analysis.quantitativeEligible).toBe(false);
    expect(sim.analysis.demoEligible).toBe(true);
    expect(sim.summary).not.toBeNull();
    expect(sim.summary!.dataConfidence).toBe('synthetic');
  });

  it('illustrative built-in sites compute as indicative demos', () => {
    const site = siteById('shackleton-rim')!;
    const sim = simulateMission(site, START, END, DEFAULT_CONFIG);
    expect(sim.analysis.status).toBe('ILLUSTRATIVE');
    expect(sim.analysis.demoEligible).toBe(true);
    expect(sim.summary).not.toBeNull();
  });

  it('invalid / reversed dates fail safely with COMPUTATION_FAILED', () => {
    const site = siteById('apollo-11')!;
    expect(simulateMission(site, END, START, DEFAULT_CONFIG).analysis.status).toBe('COMPUTATION_FAILED');
    expect(simulateMission(site, NaN, END, DEFAULT_CONFIG).summary).toBeNull();
  });
});

describe('config sanitization + validation', () => {
  it('clamps out-of-range and non-finite values so they never propagate', () => {
    const bad = { ...DEFAULT_CONFIG, arrayAreaM2: -5, loadW: NaN, cellEfficiency: 2, initialSocPct: 150, stepMinutes: 0 };
    const clean = sanitizeConfig(bad);
    expect(clean.arrayAreaM2).toBeGreaterThanOrEqual(0.1);
    expect(Number.isFinite(clean.loadW)).toBe(true);
    expect(clean.cellEfficiency).toBeLessThanOrEqual(0.5);
    expect(clean.initialSocPct).toBeLessThanOrEqual(100);
    expect(clean.stepMinutes).toBeGreaterThanOrEqual(1);
    expect(validateConfig(clean)).toHaveLength(0);
  });

  it('reports actionable validation issues for invalid input', () => {
    const issues = validateConfig({ ...DEFAULT_CONFIG, arrayAreaM2: -5, loadW: NaN });
    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(issues.some((i) => i.field === 'arrayAreaM2')).toBe(true);
    expect(issues.every((i) => i.message.length > 0)).toBe(true);
  });

  it('a sanitized simulation still produces a valid result', () => {
    const site = siteById('apollo-11')!;
    const sim = simulateMission(site, START, END, { ...DEFAULT_CONFIG, arrayAreaM2: -5, loadW: NaN });
    expect(sim.summary).not.toBeNull();
    expect(Number.isFinite(sim.summary!.selectedEnergyKWh)).toBe(true);
  });
});
