import { describe, expect, it } from 'vitest';
import { LANDING_SITES } from '../src/data/landingSites';
import { DEFAULT_CONFIG, simulateMission } from '../src/engine/simulation';
import { DAY_MS } from '../src/engine/constants';
import type { AnalysisAssessment, Scenario } from '../src/types/mission';
import { comparisonNarrative, describeSettingDifferences, type ScenarioOutcome } from '../src/tutorial/narrative';

const site = LANDING_SITES.find((s) => s.id === 'connecting-ridge')!;
const other = LANDING_SITES.find((s) => s.id === 'shackleton-rim')!;
const START = Date.parse('2026-09-01T00:00:00Z');
const config = { ...DEFAULT_CONFIG, durationDays: 3, stepMinutes: 60 };
const simA = simulateMission(site, START, START + 3 * DAY_MS, config);
const simB = simulateMission(site, START + 14 * DAY_MS, START + 17 * DAY_MS, config);

const scA: Scenario = { id: 'a', siteId: site.id, startMs: START, config };
const scB: Scenario = { id: 'b', siteId: site.id, startMs: START + 14 * DAY_MS, config };
const outA: ScenarioOutcome = { scenario: scA, site, state: 'valid', summary: simA.summary, analysis: simA.analysis };
const outB: ScenarioOutcome = { scenario: scB, site, state: 'valid', summary: simB.summary, analysis: simB.analysis };

const blockedAnalysis = {
  status: 'FRAME_UNVERIFIED', quantitativeEligible: false, demoEligible: false,
  reason: 'Unknown frame.', resolution: 'Use an allowlisted DEM.',
} as AnalysisAssessment;

describe('comparison narrative reads REAL resolved results', () => {
  it('two valid windows: deltas equal the actual summaries, differences equal the actual settings', () => {
    const n = comparisonNarrative([outA, outB]);
    const sa = simA.summary!; const sb = simB.summary!;
    const combined = n.readouts.find((r) => r.label === 'Sun + Earth')!;
    expect(combined.value).toBe(`${sa.combinedPct.toFixed(0)}% → ${sb.combinedPct.toFixed(0)}% (${(sb.combinedPct - sa.combinedPct) > 0 ? '+' : ''}${(sb.combinedPct - sa.combinedPct).toFixed(1)} pp)`);
    expect(n.readouts.find((r) => r.label === 'Longest combined gap')!.value)
      .toBe(`${sa.longestCombinedGapHours.toFixed(1)} h → ${sb.longestCombinedGapHours.toFixed(1)} h`);
    expect(n.readouts.find((r) => r.label === 'Selected energy')!.value)
      .toBe(`${sa.selectedEnergyKWh.toFixed(1)} → ${sb.selectedEnergyKWh.toFixed(1)} kWh`);
    const text = n.lines.map((l) => l.text).join(' ');
    expect(text).toContain('window start +14.00 d');
    expect(text).toMatch(/not an RF link budget/);
    expect(text).toMatch(/not thermal or survival/);
    expect(n.note).toMatch(/matrix.*source of truth/i);
    expect(n.readouts.find((r) => r.label === 'Confidence tiers')!.value).toMatch(/matched/);
  });
  it('setting differences enumerate site, start and every changed knob — nothing invented', () => {
    const diffs = describeSettingDifferences(outA, outB);
    expect(diffs).toEqual(['window start +14.00 d']);
    const outSite: ScenarioOutcome = { ...outB, scenario: { ...scB, siteId: other.id }, site: other };
    const outCfg: ScenarioOutcome = { ...outSite, scenario: { ...outSite.scenario, config: { ...config, loadW: 220, arrayMode: 'horizontal' } } };
    const d2 = describeSettingDifferences(outA, outCfg);
    expect(d2).toContain(`site ${site.shortName} → ${other.shortName}`);
    expect(d2).toContain('load 180 → 220 W');
    expect(d2).toContain('array mode vertical-tracking → horizontal');
    expect(describeSettingDifferences(outA, { ...outA, scenario: { ...scA, id: 'copy' } })).toEqual([]);
  });
  it('computing scenarios produce a waiting branch, never numbers', () => {
    const pending: ScenarioOutcome = { ...outB, state: 'computing', summary: null, analysis: null };
    const n = comparisonNarrative([outA, pending]);
    expect(n.note).toMatch(/Waiting/);
    expect(n.lines.map((l) => l.text).join(' ')).toMatch(/No guessed numbers/);
    expect(n.readouts.some((r) => r.label === 'Sun + Earth')).toBe(false);
  });
  it('blocked scenarios produce the gate explanation, never deltas', () => {
    const bad: ScenarioOutcome = { ...outB, state: 'blocked', summary: null, analysis: blockedAnalysis };
    const n = comparisonNarrative([outA, bad]);
    const text = n.lines.map((l) => l.text).join(' ');
    expect(text).toContain('FRAME_UNVERIFIED');
    expect(text).toContain('Unknown frame.');
    expect(text).toContain('Use an allowlisted DEM.');
    expect(n.note).toMatch(/No quantitative comparison/);
    expect(n.readouts.some((r) => r.label === 'Sun + Earth')).toBe(false);
  });
  it('failed computations say failed, not blocked-or-valid', () => {
    const err: ScenarioOutcome = { ...outB, state: 'error', summary: null, analysis: null };
    const n = comparisonNarrative([outA, err]);
    expect(n.lines.map((l) => l.text).join(' ')).toMatch(/computation failed/);
  });
  it('mixed confidence tiers are flagged as NOT rankable — synthetic never outranks measured', () => {
    const synth: ScenarioOutcome = { ...outB, summary: { ...simB.summary!, dataConfidence: 'synthetic' } };
    const measured: ScenarioOutcome = { ...outA, summary: { ...simA.summary!, dataConfidence: 'measured' } };
    const n = comparisonNarrative([measured, synth]);
    const text = n.lines.map((l) => l.text).join(' ');
    expect(text).toMatch(/NOT comparable for ranking/);
    expect(text).toMatch(/never outranks stronger data/);
    expect(n.readouts.find((r) => r.label === 'Confidence tiers')!.value).toMatch(/not rankable/);
    expect(n.note).toMatch(/never a ranking/);
  });
  it('pre-existing user pins are excluded from the narrative entirely', () => {
    const n = comparisonNarrative([outA, outB], ['a', 'b']);
    expect(n.lines[0].text).toMatch(/Nothing pinned in this briefing yet/);
  });
  it('identical repeats dedupe — one experiment isn\'t a comparison', () => {
    const dup: ScenarioOutcome = { ...outA, scenario: { ...scA, id: 'dup' } };
    const n = comparisonNarrative([outA, dup]);
    expect(n.lines[0].text).toMatch(/One briefing window pinned/);
    expect(n.readouts[0].value).toBe('1 / 2 needed');
  });
});
