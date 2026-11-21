import { describe, expect, it } from 'vitest';
import { BUILT_IN_REGIONS, registerRegion, sideOfCoordinates, sideOfLongitude, validateRegionEntry } from '../src/data/lunarRegions';
import { FAR_SIDE_SITES, LANDING_SITES, siteFromRegion } from '../src/data/landingSites';

describe('extensible lunar-region catalogue', () => {
  it('classifies near, limb and far hemispheres using east-positive selenographic longitude', () => {
    expect(sideOfLongitude(0)).toBe('near');
    expect(sideOfLongitude(80)).toBe('near');
    expect(sideOfLongitude(90)).toBe('limb');
    expect(sideOfLongitude(100)).toBe('far');
    expect(sideOfLongitude(180)).toBe('far');
    expect(sideOfLongitude(-180)).toBe('far');
    expect(sideOfCoordinates(89.9, 0)).toBe('limb');
    expect(sideOfCoordinates(-89.9, 180)).toBe('limb');
    expect(sideOfCoordinates(45, 180)).toBe('far');
  });

  it('includes named far-side candidate regions without claiming bundled elevations or DEMs', () => {
    const ids = FAR_SIDE_SITES.map((s) => s.id);
    expect(ids).toContain('von-karman-region');
    expect(ids).toContain('apollo-basin');
    expect(ids).toContain('hertzsprung-basin');
    for (const site of FAR_SIDE_SITES.filter((s) => s.elevationAvailable === false)) {
      expect(site.elevationM).toBe(0); // disclosed datum placeholder, not reported as a measurement
      expect(site.terrain.kind).toBe('illustrative');
      expect(site.terrain.synthetic).not.toBe(true);
    }
    expect(LANDING_SITES.length).toBeGreaterThan(FAR_SIDE_SITES.length);
  });

  it('requires provenance and validates custom catalogue entries before registration', () => {
    const invalid = validateRegionEntry({ id: 'test-region', latitudeDeg: 0, longitudeDeg: 180 });
    expect(invalid.ok).toBe(false);
    const input = {
      id: 'test-region', name: 'Test region', shortName: 'Test', latitudeDeg: 12.3, longitudeDeg: -185,
      kind: 'basin', elevationM: null, description: 'Test candidate; not a real lunar measurement.',
      sourceUrl: 'https://example.invalid/catalogue', sourceDate: 'unspecified', coordinateUncertaintyDeg: 2,
      candidate: true, coordinateProvenance: 'Test-only fixture.',
    };
    const valid = validateRegionEntry(input);
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    expect(valid.entry.longitudeDeg).toBeCloseTo(175);
    expect(siteFromRegion(valid.entry).elevationAvailable).toBe(false);
    expect(registerRegion(input).ok).toBe(true);
    expect(registerRegion(input).ok).toBe(false); // duplicate ids are rejected
  });

  it('uses approximate coordinates for region centres, not surveyed-point labels', () => {
    const vonKarman = BUILT_IN_REGIONS.find((r) => r.id === 'von-karman-region')!;
    expect(vonKarman.candidate).toBe(true);
    expect(vonKarman.coordinateUncertaintyDeg).toBeGreaterThan(0);
    expect(vonKarman.coordinateProvenance).toMatch(/not independently verified/i);
    expect(vonKarman.coordinateProvenance).toMatch(/NOT a surveyed landing point/i);
  });
});
