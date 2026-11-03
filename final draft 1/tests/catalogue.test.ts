/**
 * Landing-site catalogue integrity: the nine Artemis III candidate regions are
 * present with honest region-approximate provenance (never precise surveyed points),
 * historical candidates are classified accurately, and Apollo/Chang'e are kept
 * separate with their published landing coordinates.
 */
import { describe, expect, it } from 'vitest';
import { LANDING_SITES, siteById } from '../src/data/landingSites';

const ARTEMIS_REGIONS = [
  'Peak near Cabeus B', 'Haworth', 'Malapert Massif', 'Mons Mouton Plateau',
  'Mons Mouton', 'Nobile Rim 1', 'Nobile Rim 2', 'de Gerlache Rim 2', 'Slater Plain',
];

describe('Artemis III catalogue', () => {
  const artemis = LANDING_SITES.filter((s) => (s.program ?? '').startsWith('Artemis III'));

  it('contains exactly the nine NASA Oct-2024 candidate regions', () => {
    expect(artemis.length).toBe(9);
    for (const region of ARTEMIS_REGIONS) {
      expect(artemis.some((s) => s.name === region), region).toBe(true);
    }
  });

  it('labels every region as an approximate center, never a surveyed point', () => {
    for (const s of artemis) {
      expect(s.coordinateType, s.id).toBe('region-center');
      expect(s.dataConfidence, s.id).toBe('region-approximate');
      expect(s.coordinateUncertaintyDeg, s.id).toBeGreaterThan(0);
      expect(s.coordinateProvenance, s.id).toContain('not a surveyed landing point');
      expect(s.sourceUrl, s.id).toContain('ntrs.nasa.gov');
      expect(s.sourceDate, s.id).toBe('2024-10-28');
      // Illustrative relief must not be presented as a measured elevation.
      expect(s.elevationProvenance, s.id).toContain('not a measured elevation');
      expect(s.terrain.kind, s.id).not.toBe('dem');
    }
  });

  it('keeps all regions in the south-polar category', () => {
    for (const s of artemis) {
      expect(s.category, s.id).toBe('polar');
      expect(s.latitude, s.id).toBeLessThan(-80);
    }
  });
});

describe('historical candidates and flown missions', () => {
  it('classifies historical polar candidates as illustrative, not Artemis III', () => {
    for (const id of ['shackleton-rim', 'connecting-ridge', 'leibnitz-beta']) {
      const s = siteById(id)!;
      expect(s.program).toBe('Historical polar candidate');
      expect(s.dataConfidence).toBe('illustrative');
      expect(s.program).not.toContain('Artemis');
    }
  });

  it('keeps Apollo and Chang\'e separate with surveyed coordinates', () => {
    const apollo11 = siteById('apollo-11')!;
    const apollo17 = siteById('apollo-17')!;
    const change4 = siteById('change-4')!;
    expect(apollo11.program).toContain('Apollo 11');
    expect(apollo17.program).toContain('Apollo 17');
    expect(change4.program).toContain("Chang'e 4");
    for (const s of [apollo11, apollo17, change4]) {
      expect(s.coordinateType).toBe('surveyed');
      expect(s.coordinateUncertaintyDeg).toBeLessThan(0.01);
      expect(s.category).toBe('reference');
    }
    // Chang'e 4 is far side: Earth never visible.
    expect(change4.longitude).toBeGreaterThan(90);
  });
});
