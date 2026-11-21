import { describe, expect, it } from 'vitest';
import { solarIncidence, terrainNormal } from '../src/engine/incidence';
import { slopeAtLandingPoint } from '../src/terrain/slope';
import type { TerrainData } from '../src/terrain/types';

const data = (values: (number | null)[], size = 5): TerrainData => ({
  mode: 'real', synthetic: false, latitude: 0, longitude: 0, radius_km: 0.1,
  grid: { size, spacing_m: 10, order: 'row-major; rows north-to-south, columns west-to-east', elevations_m: values },
  landing_elevation_m: 0,
  statistics: { minimum_m: 0, maximum_m: 0, range_m: 0, coverage_percent: 100 },
  source: {
    filename: 'test-dem.tif', lunar_radius_m: 1_737_400, elevation_reference_radius_m: 1_737_400,
    elevation_reference: 'test fixture only', synthetic: false,
  },
});

describe('terrain-aware solar incidence', () => {
  it('reduces to the flat-surface relation: incidence = 90° − elevation', () => {
    const incidence = solarIncidence(120, 30, { slopeDeg: 0, aspectDeg: 77, source: 'dem' });
    expect(incidence.incidenceDeg).toBeCloseTo(60, 10);
    expect(incidence.cosIncidence).toBeCloseTo(0.5, 10);
    expect(incidence.source).toBe('dem');
  });

  it('uses the downslope aspect and surface normal rather than a horizontal-only proxy', () => {
    const normal = terrainNormal(30, 180);
    expect(normal.north).toBeLessThan(0);
    const facingSun = solarIncidence(180, 45, { slopeDeg: 30, aspectDeg: 180, source: 'dem' });
    const flat = solarIncidence(180, 45, { slopeDeg: 0, aspectDeg: 0, source: 'dem' });
    expect(facingSun.incidenceDeg).toBeCloseTo(15, 10);
    expect(facingSun.cosIncidence).toBeGreaterThan(flat.cosIncidence);
    const back = solarIncidence(0, 10, { slopeDeg: 30, aspectDeg: 180, source: 'dem' });
    expect(back.incidenceDeg).toBeGreaterThan(90);
    expect(back.cosIncidence).toBe(0);
  });

  it('estimates central slope/aspect with Horn 3×3 from a metric grid', () => {
    // Elevation rises 1 m per 10 m to the north (rows run north→south), so
    // downhill is south (aspect 180°), with atan(0.1) = 5.7106°.
    const values = Array.from({ length: 5 }, (_, row) => Array.from({ length: 5 }, () => 10 - row).flat()).flat();
    const slope = slopeAtLandingPoint(data(values));
    expect(slope).not.toBeNull();
    expect(slope!.slopeDeg).toBeCloseTo(Math.atan(0.1) * 180 / Math.PI, 8);
    expect(slope!.aspectDeg).toBeCloseTo(180, 8);
    expect(slope!.method).toBe('horn-3x3');
    expect(slope!.source).toBe('dem');
    expect(slope!.spacingM).toBe(10);
  });

  it('does not turn NoData into a zero slope', () => {
    const values: (number | null)[] = new Array(25).fill(null);
    expect(slopeAtLandingPoint(data(values))).toBeNull();
  });
});
