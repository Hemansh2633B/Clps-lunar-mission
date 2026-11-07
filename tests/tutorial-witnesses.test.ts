import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/engine/simulation';
import type { Scenario } from '../src/types/mission';
import { comparisonWitness, creditsMissionReport, sameConfig, scenarioFingerprint, type ScenarioResolution } from '../src/tutorial/witnesses';

const START = Date.parse('2026-09-01T00:00:00Z');
const sc = (id: string, over: Partial<Scenario> = {}): Scenario => ({
  id, siteId: 'connecting-ridge', startMs: START, config: { ...DEFAULT_CONFIG }, ...over,
});
const OK: ScenarioResolution = { resolved: true, eligible: true };
const PENDING: ScenarioResolution = { resolved: false, eligible: false };
const BLOCKED: ScenarioResolution = { resolved: true, eligible: false };

function witness(scenarios: Scenario[], resolutions: Record<string, ScenarioResolution>, over: Partial<Parameters<typeof comparisonWitness>[0]> = {}) {
  return comparisonWitness({
    userScenarioIds: [], chapterBaselineIds: [], scenarios, resolutions,
    compareMode: true, trainingActive: true, ...over,
  });
}

describe('scenario fingerprints', () => {
  it('config key order does not change identity', () => {
    const a = sc('a');
    const reordered = Object.fromEntries(Object.entries(a.config).reverse());
    expect(scenarioFingerprint(a)).toBe(scenarioFingerprint({ ...a, config: reordered as typeof a.config }));
  });
  it('site, start and every config knob make scenarios distinct', () => {
    const base = scenarioFingerprint(sc('a'));
    expect(scenarioFingerprint(sc('b', { siteId: 'shackleton-rim' }))).not.toBe(base);
    expect(scenarioFingerprint(sc('c', { startMs: START + 1 }))).not.toBe(base);
    expect(scenarioFingerprint(sc('d', { config: { ...DEFAULT_CONFIG, loadW: DEFAULT_CONFIG.loadW + 1 } }))).not.toBe(base);
    // label/id are presentation, not experiment identity
    expect(scenarioFingerprint(sc('e', { label: 'renamed' }))).toBe(base);
  });
  it('sameConfig compares content, not reference', () => {
    expect(sameConfig({ ...DEFAULT_CONFIG }, DEFAULT_CONFIG)).toBe(true);
    expect(sameConfig({ ...DEFAULT_CONFIG, durationDays: 15 }, DEFAULT_CONFIG)).toBe(false);
  });
});

describe('chapter 7 comparison witness', () => {
  it('two NEW distinct resolved scenarios + compare view satisfies it', () => {
    const a = sc('a'); const b = sc('b', { startMs: START + 14 * 86400000 });
    const w = witness([a, b], { a: OK, b: OK });
    expect(w.met).toBe(true);
    expect(w.distinctValid.map((s) => s.id)).toEqual(['a', 'b']);
  });
  it('pre-existing USER pins can never satisfy it, even if resolved', () => {
    const a = sc('user-a'); const b = sc('user-b', { startMs: START + 86400000 });
    const w = witness([a, b], { 'user-a': OK, 'user-b': OK }, { userScenarioIds: ['user-a', 'user-b'] });
    expect(w.met).toBe(false);
    expect(w.distinctNew).toHaveLength(0);
  });
  it('two identical new scenarios are one experiment, not a comparison', () => {
    const w = witness([sc('a'), sc('dup')], { a: OK, dup: OK });
    expect(w.met).toBe(false);
    expect(w.distinctNew).toHaveLength(1);
  });
  it('opening the comparison view alone never satisfies it', () => {
    expect(witness([], {}).met).toBe(false);
    expect(witness([sc('a')], { a: OK }).met).toBe(false);
    const a = sc('a'); const b = sc('b', { startMs: START + 86400000 });
    expect(witness([a, b], { a: OK, b: OK }, { compareMode: false }).met).toBe(false);
  });
  it('requires an active training session', () => {
    const a = sc('a'); const b = sc('b', { startMs: START + 86400000 });
    expect(witness([a, b], { a: OK, b: OK }, { trainingActive: false }).met).toBe(false);
  });
  it('unresolved (computing) scenarios do not count yet', () => {
    const a = sc('a'); const b = sc('b', { startMs: START + 86400000 });
    const w = witness([a, b], { a: OK, b: PENDING });
    expect(w.met).toBe(false);
    expect(w.pending).toBe(1);
    // A missing resolution entry is also pending, never eligible.
    expect(witness([a, b], { a: OK }).pending).toBe(1);
  });
  it('blocked or failed scenarios never count', () => {
    const a = sc('a'); const b = sc('b', { startMs: START + 86400000 });
    const w = witness([a, b], { a: OK, b: BLOCKED });
    expect(w.met).toBe(false);
    expect(w.blocked).toBe(1);
    expect(w.distinctValid).toHaveLength(1);
  });
  it('a pin rejected by the 4-scenario cap cannot count (it never enters state)', () => {
    // Workspace already holds 4 pins; pinCurrent refuses the 5th — scenarios unchanged.
    const four = [sc('s1'), sc('s2', { startMs: START + 1 }), sc('s3', { startMs: START + 2 }), sc('s4', { startMs: START + 3 })];
    const before = witness(four.slice(0, 1), { s1: OK });
    const after = witness(four.slice(0, 1), { s1: OK }); // rejected pin added nothing
    expect(after.met).toBe(before.met);
    expect(after.distinctNew).toHaveLength(1);
    // Even at capacity, credit needs two DISTINCT VALID rows, not four arbitrary ones.
    const cap = witness(four, { s1: OK, s2: BLOCKED, s3: PENDING, s4: BLOCKED });
    expect(cap.met).toBe(false);
  });
  it('two valid rows among extras still satisfy; chapter baseline is audit-only', () => {
    const a = sc('a'); const b = sc('b', { startMs: START + 86400000 }); const c = sc('c', { siteId: 'shackleton-rim' });
    const w = witness([a, b, c], { a: OK, b: OK, c: BLOCKED }, { chapterBaselineIds: ['a'] });
    // Pins created earlier in the SAME training journey count (refresh-stable),
    // the recorded chapter-start baseline never voids tutorial work.
    expect(w.met).toBe(true);
  });
});

describe('chapter 8 export witness', () => {
  it('only a guard-passing, completed JSON download earns credit', () => {
    expect(creditsMissionReport('json', true, true)).toBe(true);
    expect(creditsMissionReport('json', false, true)).toBe(false);
    expect(creditsMissionReport('json', true, false)).toBe(false);
  });
  it('CSV exports never earn mission-report credit', () => {
    for (const kind of ['timeseries', 'horizon', 'summary'] as const) {
      expect(creditsMissionReport(kind, true, true)).toBe(false);
    }
  });
});
