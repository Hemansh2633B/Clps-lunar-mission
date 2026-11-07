/**
 * Export integrity: reports carry full reproducibility metadata and honest
 * disclosures (heuristic score, geometric LOS not RF, battery not survival,
 * data confidence, frame status, sampling). Illustrative terrain is never
 * exported as measured; frame-unverified DEMs are flagged.
 */
import { describe, expect, it } from 'vitest';
import { missionReportJSON, summaryCSV, reportWarnings } from '../src/utils/export';
import { analysisFingerprint } from '../src/utils/analysisId';
import { simulateMission, DEFAULT_CONFIG, evaluateAt } from '../src/engine/simulation';
import { siteById, makeCustomSite } from '../src/data/landingSites';
import type { HorizonMask } from '../src/terrain/types';

const START = Date.parse('2026-12-18T00:00:00Z');
const cfg = { ...DEFAULT_CONFIG, stepMinutes: 60, durationDays: 10 };

function unknownFrameMask(): HorizonMask {
  const n = 72;
  return {
    latitude: -89.5, longitude: 45, radius_km: 5, horizon_radius_km: 4.9, edge_inset_m: 55,
    sampling_step_m: 20, grid_size: 257, grid_spacing_m: 39, eye_height_m: 2,
    azimuth_step_deg: 5, azimuths_deg: Array.from({ length: n }, (_, i) => i * 5),
    elevations_deg: new Array(n).fill(1), ray_coverage_percent: new Array(n).fill(100),
    max_obstacle_range_km: new Array(n).fill(1), mean_coverage_percent: 100, synthetic: false,
    source: { filename: 'mystery.tif', lunar_radius_m: 1737400, elevation_reference_radius_m: 1737400, elevation_reference: 'datum', lunar_reference_frame: 'UNKNOWN_FRAME', synthetic: false },
    model: 'test', frame_note: '',
  };
}

describe('JSON report reproducibility', () => {
  it('carries ephemeris, interval, terrain, sampling, power/battery and score metadata', async () => {
    const site = siteById('apollo-11')!;
    const sim = simulateMission(site, START, START + 10 * 86400000, cfg);
    const current = evaluateAt(site, START, cfg);
    const r = JSON.parse(await missionReportJSON(site, cfg, sim, current));
    expect(r.reproducibility).toBeDefined();
    expect(r.reproducibility.timeReference).toBe('UTC');
    expect(r.reproducibility.interval.startUtc).toBe(new Date(sim.summary!.startMs).toISOString());
    expect(r.reproducibility.ephemeris.moonRotation).toContain('IAU 2015');
    expect(r.reproducibility.ephemeris.lightTimeCorrected).toBe(true);
    expect(r.reproducibility.sampling.sampleCount).toBe(sim.sampling.sampleCount);
    expect(r.reproducibility.powerAssumptions.solarConstantWm2).toBe(1361);
    expect(r.reproducibility.batteryAssumptions.chargeEfficiency).toBeCloseTo(0.92, 6);
    expect(r.reproducibility.scoreMethodology.heuristic).toBe(true);
    const sum = r.reproducibility.scoreMethodology.components.reduce((a: number, c: { weight: number }) => a + c.weight, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('discloses heuristic, LOS-not-RF, battery-not-survival, and data confidence', async () => {
    const site = siteById('apollo-11')!;
    const sim = simulateMission(site, START, START + 10 * 86400000, cfg);
    const current = evaluateAt(site, START, cfg);
    const r = JSON.parse(await missionReportJSON(site, cfg, sim, current));
    expect(r.disclaimer).toContain('heuristic');
    expect(r.disclaimer).toContain('not an RF link budget');
    const warnings: string[] = r.reproducibility.warnings;
    expect(warnings.some((w) => w.includes('heuristic'))).toBe(true);
    expect(warnings.some((w) => w.includes('NOT an RF link budget'))).toBe(true);
    expect(warnings.some((w) => w.includes('NOT thermal'))).toBe(true);
    // Apollo-11 horizon is idealized flat -> never exported as measured terrain.
    expect(r.reproducibility.siteProvenance.dataConfidence).not.toBe('measured');
    expect(warnings.some((w) => w.includes('not measured'))).toBe(true);
  });

  it('labels the horizon LOCAL HORIZON in metadata, warnings and disclaimer (no fabricated regional horizon)', async () => {
    const site = siteById('apollo-11')!;
    const sim = simulateMission(site, START, START + 10 * 86400000, cfg);
    const current = evaluateAt(site, START, cfg);
    const r = JSON.parse(await missionReportJSON(site, cfg, sim, current));
    expect(r.reproducibility.terrain.horizonScale).toBe('LOCAL HORIZON');
    expect(r.reproducibility.terrain.horizonScaleNote).toContain('not a measured regional');
    expect(r.disclaimer).toContain('LOCAL (landing-centered)');
    const warnings: string[] = r.reproducibility.warnings;
    expect(warnings.some((w) => w.startsWith('LOCAL HORIZON'))).toBe(true);
  });

  it('LOCAL HORIZON disclosure for a DEM notes the ray-marched local crop, not a regional model', () => {
    const site = makeCustomSite({ name: 'Local DEM', latitude: -89.5, longitude: 45, elevationM: 0, preset: 'flat', horizon: unknownFrameMask() });
    const warnings = reportWarnings(site, null);
    const horizon = warnings.find((w) => w.startsWith('LOCAL HORIZON'))!;
    expect(horizon).toContain('ray-marched from the local elevation crop');
    expect(horizon).toContain('NOT a regional distant-horizon model');
  });

  it('flags a frame-unverified DEM and blocks it from quantitative use', () => {
    const site = makeCustomSite({ name: 'Unknown', latitude: -89.5, longitude: 45, elevationM: 0, preset: 'flat', horizon: unknownFrameMask() });
    const sim = simulateMission(site, START, START + 5 * 86400000, cfg);
    const warnings = reportWarnings(site, sim);
    expect(warnings.some((w) => w.includes('FRAME UNVERIFIED'))).toBe(true);
    expect(site.terrain.frameVerified).toBe(false);
  });
});

describe('CSV exports carry confidence + sampling', () => {
  it('summary CSV includes data_confidence, frame_verified and effective step', async () => {
    const site = siteById('shackleton-rim')!;
    const sim = simulateMission(site, START, START + 5 * 86400000, cfg);
    const fp = await analysisFingerprint(site, START, START + 5 * 86400000, cfg);
    const csv = await summaryCSV(sim, fp);
    const header = csv.split('\n')[0];
    for (const col of ['data_confidence', 'frame_verified', 'effective_step_min', 'sample_count', 'score_is_heuristic', 'sampling_capped']) {
      expect(header).toContain(col);
    }
    expect(csv).toContain('illustrative');
  });
});
