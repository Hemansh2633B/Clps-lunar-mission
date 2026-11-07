/** Plain-language explanations + glossary integrity (Section 5). */
import { describe, expect, it } from 'vitest';
import { explainClearance, explainIllumination, explainEarthLos } from '../src/utils/explain';
import { GLOSSARY, GLOSSARY_BY_ID } from '../src/data/glossary';
import type { VisibilityState } from '../src/types/mission';

const vis = (over: Partial<VisibilityState>): VisibilityState => ({
  visible: false, geometricVisible: true, clearanceDeg: -1.25, terrainElevationDeg: 2, reason: 'terrain', ...over,
});

describe('plain-language explanations', () => {
  it('explains a blocked Earth clearance with the magnitude and the geometric caveat', () => {
    const s = explainClearance('Earth', vis({ clearanceDeg: -1.25, reason: 'terrain' }));
    expect(s).toContain('1.25°');
    expect(s.toLowerCase()).toContain('blocked');
  });
  it('explains a clear Sun without overstating', () => {
    expect(explainClearance('Sun', vis({ visible: true, clearanceDeg: 3.4, reason: 'clear' }))).toContain('3.40°');
  });
  it('explains illumination as a fraction of the interval', () => {
    expect(explainIllumination(67)).toContain('67%');
    expect(explainIllumination(67).toLowerCase()).toContain('mission interval');
  });
  it('never-visible Earth recommends a relay and denies RF certainty', () => {
    const s = explainEarthLos(0, true);
    expect(s.toLowerCase()).toContain('relay');
    expect(s.toLowerCase()).toContain('not an rf link budget');
  });
});

describe('glossary integrity', () => {
  it('covers every required instrument term with plain + technical text', () => {
    const required = ['sun-elevation', 'sun-azimuth', 'earth-elevation', 'earth-azimuth', 'libration', 'clearance', 'horizon-elevation', 'solar-flux', 'soc', 'sampling', 'frame-residual'];
    for (const id of required) {
      const g = GLOSSARY_BY_ID[id];
      expect(g, id).toBeDefined();
      expect(g.plain.length).toBeGreaterThan(10);
      expect(g.technical.length).toBeGreaterThan(10);
    }
  });
  it('has unique ids and honest caveats on the score / Earth LOS', () => {
    expect(new Set(GLOSSARY.map((g) => g.id)).size).toBe(GLOSSARY.length);
    expect(GLOSSARY_BY_ID['score'].technical.toLowerCase()).toContain('not a nasa methodology');
    expect(GLOSSARY_BY_ID['dte'].technical.toLowerCase()).toContain('not an rf link budget');
  });
});
