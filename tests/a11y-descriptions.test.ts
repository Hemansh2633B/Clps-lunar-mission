import { describe, expect, it } from 'vitest';
import { LANDING_SITES } from '../src/data/landingSites';
import { DEFAULT_CONFIG, evaluateAt, simulateMission } from '../src/engine/simulation';
import { assessTerrainEligibility } from '../src/engine/analysisStatus';
import { DAY_MS } from '../src/engine/constants';
import type { AnalysisAssessment, LandingSite } from '../src/types/mission';
import { demFooterStatus, panoramaDescription, polarMapDescription, timelineDescription } from '../src/utils/a11y';

const site = LANDING_SITES.find((s) => s.id === 'connecting-ridge')!;
const START = Date.parse('2026-09-01T00:00:00Z');
const config = { ...DEFAULT_CONFIG, durationDays: 3, stepMinutes: 60 };
const current = evaluateAt(site, START + DAY_MS, config);
const sim = simulateMission(site, START, START + 3 * DAY_MS, config);

const blocked = (status: string): AnalysisAssessment => ({
  status, quantitativeEligible: false, demoEligible: false,
  reason: 'Frame not on allowlist.', resolution: 'Provide a compatible DEM.',
} as AnalysisAssessment);

describe('panorama role="img" description respects the visibility gate', () => {
  it('BLOCKED: sky positions only — no visibility claims, no DTE-open, no clearance values', () => {
    const d = panoramaDescription(current, true);
    expect(d).toContain('BLOCKED');
    expect(d).toContain('Sky positions come from the ephemeris and remain valid');
    expect(d).not.toMatch(/\bvisible\b/);
    expect(d).not.toMatch(/direct-to-Earth open/);
    expect(d).not.toMatch(/Sunlit|DTE open|occulted/);
    // The word may appear only in the NEGATION — never as a reported value.
    expect(d).toContain('no Sun or Earth visibility or clearance is claimed');
    expect(d).not.toMatch(/clearance[:\s]+[-+]?\d/);
    // Positions themselves ARE stated (they remain scientific).
    expect(d).toContain(`${current.sun.azimuthDeg.toFixed(0)} degrees azimuth`);
    expect(d).toContain(`${current.earth.elevationDeg.toFixed(1)} degrees elevation`);
  });
  it('UNBLOCKED: visibility wording tracks the engine exactly', () => {
    const d = panoramaDescription(current, false);
    expect(d).toContain(current.sunVisibility.visible ? 'visible' : 'below the horizon or terrain-occulted');
    expect(d).toContain(current.earthVisibility.visible ? 'visible, direct-to-Earth open' : 'not visible');
  });
});

describe('DEM footer is status-aware and never contradicts AnalysisAssessment', () => {
  const demSite: LandingSite = {
    ...site,
    terrain: {
      ...site.terrain, kind: 'dem', synthetic: false, sourceFrame: 'MOON_ME (JPL DE421)',
      frameVerified: true, frameTransform: 'me', frameResidualDeg: 0.0039, coveragePercent: 100,
    },
  };
  it('verified frame says verified, discloses the constant-rotation residual and coverage', () => {
    const analysis = assessTerrainEligibility(demSite, START, START + 3 * DAY_MS);
    const f = demFooterStatus(demSite, analysis, false);
    expect(f.tone).toBe('ok');
    expect(f.text).toMatch(/verified against the allowlist/);
    expect(f.text).toMatch(/constant ME rotation/);
    expect(f.text).toMatch(/0\.0039/);
    expect(f.text).toMatch(/Coverage 100\.0%/);
    expect(f.text).toMatch(/LOCAL horizon only/);
    expect(f.text).not.toMatch(/Verify frame alignment/);
  });
  it('a blocked assessment is quoted verbatim — the footer cannot disagree with the notice', () => {
    for (const status of ['FRAME_UNVERIFIED', 'INCOMPLETE_COVERAGE', 'FRAME_MODEL_OUTSIDE_VALIDATED_RANGE']) {
      const f = demFooterStatus(demSite, blocked(status), false);
      expect(f.tone).toBe('blocked');
      expect(f.text).toContain(status);
      expect(f.text).toContain('Frame not on allowlist.');
      expect(f.text).toContain('Provide a compatible DEM.');
      expect(f.text).not.toMatch(/verified against the allowlist/);
    }
  });
  it('out-of-range epoch: verified frame but instantaneous visibility blocked HERE', () => {
    const f = demFooterStatus(demSite, null, true);
    expect(f.tone).toBe('blocked');
    expect(f.text).toMatch(/NOT validated at the current epoch/);
    expect(f.text).toMatch(/2020–2035/);
  });
  it('unverified frame without an assessment is still blocked, never "verify later" ambiguity', () => {
    const f = demFooterStatus({ ...demSite, terrain: { ...demSite.terrain, frameVerified: false } }, null, false);
    expect(f.tone).toBe('blocked');
    expect(f.text).toMatch(/NOT verified/);
  });
  it('synthetic DEM is labeled a demo, never real data', () => {
    const f = demFooterStatus({ ...demSite, terrain: { ...demSite.terrain, synthetic: true } }, null, false);
    expect(f.tone).toBe('warn');
    expect(f.text).toMatch(/NOT real lunar data/);
  });
  it('illustrative and custom masks keep their honest tiers', () => {
    expect(demFooterStatus(site, null, false).text).toMatch(/illustrative/);
    const custom: LandingSite = { ...site, terrain: { ...site.terrain, kind: 'custom' } };
    expect(demFooterStatus(custom, null, false).text).toMatch(/User-edited/);
  });
});

describe('timeline description respects the analysis gate', () => {
  it('blocked: names the status and reason, claims no percentages or verdict', () => {
    const d = timelineDescription(null, blocked('FRAME_UNVERIFIED'));
    expect(d).toContain('BLOCKED');
    expect(d).toContain('FRAME_UNVERIFIED');
    expect(d).not.toMatch(/percent sunlit/);
    expect(d).not.toMatch(/Verdict/);
  });
  it('resolved: reads exactly the summary the tracks render', () => {
    const d = timelineDescription(sim.summary, sim.analysis);
    expect(d).toContain(`${sim.summary!.illuminationPct.toFixed(0)} percent sunlit`);
    expect(d).toContain(`Verdict ${sim.summary!.verdict}`);
  });
  it('computing: says computing, not "no results" ambiguity or invented numbers', () => {
    const d = timelineDescription(null, null);
    expect(d).toMatch(/still computing/);
    expect(d).not.toMatch(/percent/);
  });
});

describe('polar map description', () => {
  it('blocked epochs flag the Earth vector as azimuth-only', () => {
    expect(polarMapDescription(site.shortName, site.latitude, site.longitude, true)).toMatch(/line-of-sight status is unverified/);
    expect(polarMapDescription(site.shortName, site.latitude, site.longitude, false)).not.toMatch(/unverified/);
  });
});
