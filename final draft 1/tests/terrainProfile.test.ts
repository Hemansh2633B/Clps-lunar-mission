import { describe, expect, it } from 'vitest';
import { syntheticTerrain } from '../src/terrain/synthetic';
import { horizonFromGrid } from '../src/terrain/horizon';
import { terrainProfileFromHorizon, horizonImportBlocked } from '../src/terrain/missionProfile';
import { makeCustomSite } from '../src/data/landingSites';
import { terrainElevationAt } from '../src/engine/horizonPhysics';
import { evaluateAt, DEFAULT_CONFIG } from '../src/engine/simulation';
import { missionReportJSON, horizonCSV } from '../src/utils/export';
import type { HorizonMask } from '../src/terrain/types';

// Default to the IAU frame (no rotation) so these tests isolate the "no illustrative
// ripple / no clamp / verbatim samples" property from frame rotation, which is
// exercised separately in frame-gating.test.ts. Pass frame='MOON_ME DE421' to test
// the ME->IAU path (e.g. provenance export).
function maskWith(elevations: number[], overrides: Partial<HorizonMask> = {}, frame = 'IAU_MOON'): HorizonMask {
  const step = 360 / elevations.length;
  return {
    latitude: -89.5, longitude: 45, radius_km: 5, horizon_radius_km: 4.9, edge_inset_m: 55,
    sampling_step_m: 20, grid_size: 257, grid_spacing_m: 39, eye_height_m: 2,
    azimuth_step_deg: step, azimuths_deg: elevations.map((_, i) => i * step), elevations_deg: elevations,
    ray_coverage_percent: elevations.map(() => 100), max_obstacle_range_km: elevations.map(() => 1),
    mean_coverage_percent: 100, synthetic: false,
    source: { filename: 'test.tif', lunar_radius_m: 1737400, elevation_reference_radius_m: 1737400, elevation_reference: 'test datum', lunar_reference_frame: frame, synthetic: false },
    model: 'test', frame_note: 'verify frame', ...overrides,
  };
}

describe('DEM horizon → mission profile', () => {
  it('preserves ray-marched samples verbatim without illustrative ripple or clamping', () => {
    const data = syntheticTerrain(-89.5, 45, 5, 'low');
    const mask = horizonFromGrid(data, 5, 2);
    const profile = terrainProfileFromHorizon(mask);
    expect(profile.kind).toBe('dem');
    expect(profile.elevations).toEqual(mask.elevations_deg);
    expect(profile.resolutionDeg).toBe(5);
    expect(profile.features).toEqual([]);
    expect(profile.coveragePercent).toBe(100);
    expect(profile.sourceFrame).toBe(data.source.lunar_reference_frame);
  });

  it('does not clamp extreme DEM elevations to the illustrative mask range', () => {
    const elevations = Array.from({ length: 24 }, (_, i) => (i === 0 ? 25 : i === 1 ? -8 : 1));
    const profile = terrainProfileFromHorizon(maskWith(elevations));
    expect(profile.elevations[0]).toBe(25);
    expect(profile.elevations[1]).toBe(-8);
    expect(terrainElevationAt(profile, 0)).toBe(25);
    expect(terrainElevationAt(profile, 15)).toBe(-8);
    expect(terrainElevationAt(profile, 7.5)).toBeCloseTo(8.5, 6);
    expect(terrainElevationAt(profile, 352.5)).toBeCloseTo(13, 6); // wraps to 0°
  });

  it('labels synthetic imports as demo and blocks incomplete real masks', () => {
    const synth = horizonFromGrid(syntheticTerrain(-89.5, 45, 2, 'low'), 10, 2);
    const demoSite = makeCustomSite({ name: 'Demo', latitude: -89.5, longitude: 45, elevationM: 0, preset: 'flat', horizon: synth });
    expect(demoSite.terrain.synthetic).toBe(true);
    expect(demoSite.description).toMatch(/NOT real lunar data/i);
    expect(horizonImportBlocked(synth)).toBeNull();

    const partial = maskWith([1, 2, 3, 4], { mean_coverage_percent: 99, ray_coverage_percent: [100, 100, 96, 100] });
    expect(horizonImportBlocked(partial)).toMatch(/incomplete ray coverage/i);
    const complete = maskWith([1, 2, 3, 4]);
    expect(horizonImportBlocked(complete)).toBeNull();
    const realSite = makeCustomSite({ name: 'Real', latitude: -89.5, longitude: 45, elevationM: 0, preset: 'flat', horizon: complete });
    expect(realSite.terrain.kind).toBe('dem');
    expect(realSite.terrain.elevations).toEqual([1, 2, 3, 4]);
  });

  it('exports DEM provenance and native-resolution horizon rows', () => {
    const mask = maskWith(Array.from({ length: 72 }, (_, i) => Math.sin(i / 72 * Math.PI * 2) * 3), {}, 'MOON_ME DE421');
    const site = makeCustomSite({ name: 'DEM site', latitude: -89.5, longitude: 45, elevationM: -100, preset: 'flat', horizon: mask });
    const current = evaluateAt(site, Date.parse('2026-12-20T08:00:00Z'), DEFAULT_CONFIG);
    const report = JSON.parse(missionReportJSON(site, DEFAULT_CONFIG, null, current));
    expect(report.disclaimer).toMatch(/DEM-derived horizon preserved/);
    expect(report.disclaimer).toMatch(/MOON_ME DE421/);
    expect(report.horizonProfile.kind).toBe('dem');
    const csv = horizonCSV(site, current);
    const rows = csv.trim().split('\n');
    expect(rows.length - 1).toBe(72); // 5° bins preserved, not resampled to 5° illustrative table
  });
});
