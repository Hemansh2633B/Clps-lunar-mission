import { describe, expect, it } from 'vitest';
import { LANDING_SITES } from '../src/data/landingSites';
import { DEFAULT_CONFIG, evaluateAt, simulateMission } from '../src/engine/simulation';
import { DAY_MS } from '../src/engine/constants';
import type { AnalysisAssessment, MissionConfig } from '../src/types/mission';
import { chapterNarrative, describeProvenance, slipOutcome, type StoryWorld } from '../src/tutorial/narrative';

const START = Date.parse('2027-03-01T00:00:00Z');
const site = LANDING_SITES.find((s) => s.id === 'shackleton-rim')!;
const config: MissionConfig = { ...DEFAULT_CONFIG, durationDays: 3, stepMinutes: 60 };
const sim = simulateMission(site, START, START + 3 * DAY_MS, config);
const current = evaluateAt(site, START + DAY_MS, config);

function world(overrides: Partial<StoryWorld> = {}): StoryWorld {
  return {
    site, current, config, presetName: 'Custom', slipDays: 0, missionStartMs: START,
    summary: sim.summary, baselineSummary: sim.summary, analysis: sim.analysis,
    loading: false, scenarioCount: 0, compareMode: false, scenarioOutcomes: [], userScenarioIds: [], ...overrides,
  };
}

const BLOCKED_STATUSES = [
  'FRAME_UNVERIFIED', 'INCOMPLETE_COVERAGE', 'FRAME_MODEL_OUTSIDE_VALIDATED_RANGE',
  'NUMERICAL_RESOLUTION_INSUFFICIENT', 'COMPUTATION_FAILED',
] as const;

function blocked(status: (typeof BLOCKED_STATUSES)[number]): AnalysisAssessment {
  return { status, quantitativeEligible: false, demoEligible: false, reason: 'Test reason.', resolution: 'Test resolution.' } as AnalysisAssessment;
}

describe('live narrative reads the engine, never a script', () => {
  it('ch1 reports the actual site coordinates and provenance', () => {
    const n = chapterNarrative(1, world());
    expect(n.readouts.find((r) => r.label === 'Latitude / longitude')?.value).toBe(`${site.latitude.toFixed(2)}° / ${site.longitude.toFixed(2)}°`);
    expect(n.lines.map((l) => l.text).join(' ')).toContain(site.name);
  });

  it('ch2 sun readouts equal the live evaluated sample', () => {
    const n = chapterNarrative(2, world());
    expect(n.readouts[0].value).toBe(`${current.sun.elevationDeg.toFixed(1)}° / ${current.sun.azimuthDeg.toFixed(1)}°`);
    expect(n.readouts.find((r) => r.label === 'Window illumination')?.value).toBe(`${sim.summary!.illuminationPct.toFixed(0)}%`);
  });

  it('ch3 always carries the RF disclaimer and live libration', () => {
    const n = chapterNarrative(3, world());
    expect(n.note).toMatch(/NOT an RF link budget/);
    expect(n.readouts.find((r) => r.label === 'Sub-Earth point (lat, lon)')?.value)
      .toBe(`${current.libration.subEarthLatitudeDeg.toFixed(2)}°, ${current.libration.subEarthLongitudeDeg.toFixed(2)}°`);
    expect(n.readouts.find((r) => r.label === 'Window DTE availability')?.value).toBe(`${sim.summary!.dtePct.toFixed(0)}%`);
  });

  it('ch4 power readouts equal the live power state and name the preset', () => {
    const n = chapterNarrative(4, world({ presetName: 'General surface lander' }));
    expect(n.readouts.find((r) => r.label === 'Selected array output')?.value).toBe(`${current.power.selectedW.toFixed(0)} W`);
    expect(n.lines.map((l) => l.text).join(' ')).toMatch(/General surface lander/);
    expect(n.lines.map((l) => l.text).join(' ')).toMatch(/not NASA vehicle specs/);
    expect(n.note).toMatch(/rate.*accumulated over time/i);
  });

  it('ch6 battery totals are computed from the real summary and config', () => {
    const n = chapterNarrative(6, world());
    const s = sim.summary!;
    const consumed = (config.loadW * s.durationHours) / 1000;
    expect(n.readouts[0].value).toBe(`${s.selectedEnergyKWh.toFixed(1)} / ${consumed.toFixed(1)} kWh`);
    expect(n.readouts.find((r) => r.label === 'Verdict')?.value).toBe(s.verdict);
    expect(n.note).toMatch(/not thermal or spacecraft survival/);
    if (s.depletionHours > 0) {
      expect(n.lines.map((l) => l.text).join(' ')).toMatch(/not a survival prediction/);
    }
  });

  it('ch8 reports the actual sampling used', () => {
    const n = chapterNarrative(8, world());
    expect(n.readouts[0].value).toBe(`${sim.summary!.sampling.sampleCount.toLocaleString()} / ${sim.summary!.sampling.effectiveStepMinutes.toFixed(1)} min`);
    expect(n.lines.map((l) => l.text).join(' ')).toMatch(/reproduce/);
  });

  it('produces no NaN or undefined in any chapter for the live fixture', () => {
    for (let c = 0; c <= 8; c++) {
      const n = chapterNarrative(c, world({ scenarioCount: 2, compareMode: true, slipDays: 14 }));
      const text = JSON.stringify(n);
      expect(text, `chapter ${c}`).not.toMatch(/NaN|undefined/);
    }
  });
});

describe('slip branching follows the actual simulation', () => {
  it('classifies baseline / computing / better / worse / similar', () => {
    expect(slipOutcome(world({ slipDays: 0 }))).toBe('baseline');
    expect(slipOutcome(world({ slipDays: 14, summary: null }))).toBe('computing');
    const b = { ...sim.summary!, combinedPct: 50 };
    expect(slipOutcome(world({ slipDays: 14, summary: { ...b, combinedPct: 60 }, baselineSummary: b }))).toBe('better');
    expect(slipOutcome(world({ slipDays: 14, summary: { ...b, combinedPct: 40 }, baselineSummary: b }))).toBe('worse');
    expect(slipOutcome(world({ slipDays: 14, summary: { ...b, combinedPct: 50.4 }, baselineSummary: b }))).toBe('similar');
  });

  it('tells the truth in each direction with the real deltas', () => {
    const b = { ...sim.summary!, combinedPct: 50 };
    const worse = chapterNarrative(5, world({ slipDays: 14, summary: { ...b, combinedPct: 40 }, baselineSummary: b }));
    expect(worse.lines[0].text).toMatch(/drops by 10\.0 percentage points/);
    const better = chapterNarrative(5, world({ slipDays: 14, summary: { ...b, combinedPct: 60 }, baselineSummary: b }));
    expect(better.lines[0].text).toMatch(/rises by 10\.0 percentage points/);
    const computing = chapterNarrative(5, world({ slipDays: 14, summary: null }));
    expect(computing.note).toMatch(/Waiting/);
    expect(computing.lines[0].text).toMatch(/no guessed numbers/);
  });
});

describe('blocked analyses explain, never fabricate', () => {
  for (const status of BLOCKED_STATUSES) {
    it(`${status}: every quantitative chapter refuses a verdict`, () => {
      for (const c of [2, 3, 4, 5, 6, 7, 8]) {
        const n = chapterNarrative(c, world({ analysis: blocked(status), summary: null, slipDays: 14 }));
        const text = n.lines.map((l) => l.text).join(' ');
        expect(text, `chapter ${c}`).toContain('Test reason.');
        expect(text).toContain('Test resolution.');
        expect(n.readouts).toEqual([{ label: 'Analysis status', value: status }]);
        expect(n.note).toMatch(/blocked/i);
        expect(n.readouts.some((r) => r.label === 'Verdict')).toBe(false);
      }
    });
  }

  it('ch8 explicitly says the export guard will refuse', () => {
    const n = chapterNarrative(8, world({ analysis: blocked('FRAME_UNVERIFIED'), summary: null }));
    expect(n.lines.map((l) => l.text).join(' ')).toMatch(/export guard will refuse/);
  });

  it('a null summary while loading says computing, not a verdict', () => {
    const n = chapterNarrative(6, world({ summary: null, analysis: null, loading: true }));
    expect(n.note).toMatch(/Computing/);
    expect(n.readouts).toEqual([]);
  });
});

describe('comparison and provenance branches', () => {
  it('ch7 guides pinning until two DISTINCT briefing scenarios exist', () => {
    expect(chapterNarrative(7, world({ scenarioCount: 0 })).lines[0].text).toMatch(/Nothing pinned/);
    const scA = { id: 'a', siteId: site.id, startMs: START, config };
    const outA = { scenario: scA, site, state: 'valid' as const, summary: sim.summary, analysis: sim.analysis };
    expect(chapterNarrative(7, world({ scenarioCount: 1, scenarioOutcomes: [outA] })).lines[0].text).toMatch(/One briefing window pinned/);
    // An identical repeat does not create a comparison.
    const dup = { ...outA, scenario: { ...scA, id: 'dup' } };
    expect(chapterNarrative(7, world({ scenarioCount: 2, scenarioOutcomes: [outA, dup], compareMode: true })).lines[0].text).toMatch(/Two DIFFERENT windows|One briefing window pinned/);
  });

  it('provenance language matches the confidence tier', () => {
    const region = LANDING_SITES.find((s) => s.dataConfidence === 'region-approximate')!;
    expect(describeProvenance(region)).toMatch(/region center/);
    expect(describeProvenance(region)).toMatch(/not a surveyed landing point/);
    // No catalogue site is 'measured' (Apollo/Chang'e horizons are idealized) —
    // measured tier comes from a real DEM, so construct one honestly.
    const demSite = { ...site, dataConfidence: 'measured' as const, coordinateType: 'surveyed' as const, terrain: { ...site.terrain, kind: 'dem' as const, sourceFrame: 'MOON_ME/DE421', frameVerified: true } };
    expect(describeProvenance(demSite)).toMatch(/measured reference data/);
    expect(describeProvenance(demSite)).toMatch(/surveyed reference point/);
    expect(describeProvenance(demSite)).toMatch(/allowlisted and rotated/);
    expect(describeProvenance({ ...demSite, terrain: { ...demSite.terrain, frameVerified: false } })).toMatch(/NOT verified/);
    expect(describeProvenance({ ...site, dataConfidence: 'synthetic', terrain: { ...site.terrain, synthetic: true } })).toMatch(/synthetic demo terrain/);
  });
});
