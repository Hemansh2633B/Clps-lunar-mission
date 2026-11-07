import { describe, expect, it } from 'vitest';
import { LANDING_SITES } from '../src/data/landingSites';
import { DEFAULT_CONFIG, simulateMission } from '../src/engine/simulation';
import { DAY_MS } from '../src/engine/constants';
import { missionExportGate, type ExportGateInput } from '../src/utils/exportGuard';
import { missionReportJSON } from '../src/utils/export';
import { evaluateAt } from '../src/engine/simulation';
import type { AnalysisAssessment } from '../src/types/mission';

const site = LANDING_SITES.find((s) => s.id === 'connecting-ridge')!;
const START = Date.parse('2026-09-01T00:00:00Z');
const config = { ...DEFAULT_CONFIG, durationDays: 3, stepMinutes: 60 };
const sim = simulateMission(site, START, START + 3 * DAY_MS, config);

function input(over: Partial<ExportGateInput> = {}): ExportGateInput {
  return {
    kind: 'json', loading: false, error: null, sim,
    expectedSiteId: site.id, expectedStartMs: START, expectedEndMs: START + 3 * DAY_MS,
    ...over,
  };
}

describe('mission export gate', () => {
  it('a resolved, eligible, current result passes for every export kind', () => {
    for (const kind of ['json', 'timeseries', 'horizon', 'summary'] as const) {
      expect(missionExportGate(input({ kind })).ok).toBe(true);
    }
  });
  it('computing windows never export', () => {
    const g = missionExportGate(input({ loading: true }));
    expect(g).toMatchObject({ ok: false, code: 'computing' });
  });
  it('failed windows never export', () => {
    expect(missionExportGate(input({ error: 'worker died' }))).toMatchObject({ ok: false, code: 'error' });
  });
  it('missing results never export (even horizon CSV needs a known analysis state)', () => {
    expect(missionExportGate(input({ sim: null }))).toMatchObject({ ok: false, code: 'missing' });
  });
  it('blocked analyses never export', () => {
    const blockedSim = {
      ...sim,
      analysis: { status: 'FRAME_UNVERIFIED', quantitativeEligible: false, demoEligible: false, reason: 'r', resolution: 'x' } as AnalysisAssessment,
    };
    expect(missionExportGate(input({ sim: blockedSim }))).toMatchObject({ ok: false, code: 'blocked' });
  });
  it('stale results (wrong site or window) never export', () => {
    expect(missionExportGate(input({ expectedSiteId: 'shackleton-rim' }))).toMatchObject({ ok: false, code: 'stale' });
    expect(missionExportGate(input({ expectedStartMs: START + DAY_MS }))).toMatchObject({ ok: false, code: 'stale' });
    expect(missionExportGate(input({ expectedEndMs: START + 4 * DAY_MS }))).toMatchObject({ ok: false, code: 'stale' });
  });
  it('horizon clearance CSV is blocked at unvalidated epochs even with a valid window', () => {
    expect(missionExportGate(input({ kind: 'horizon', horizonInstantBlocked: true }))).toMatchObject({ ok: false, code: 'blocked' });
    expect(missionExportGate(input({ kind: 'json', horizonInstantBlocked: true })).ok).toBe(true);
  });
});

describe('mission report content', () => {
  it('carries provenance, warnings and the analysis status alongside the numbers', () => {
    const current = evaluateAt(site, START + DAY_MS, config);
    const report = missionReportJSON(site, config, sim, current) as unknown as Record<string, unknown>;
    const json = JSON.stringify(report);
    expect(json).toContain('siteProvenance');
    expect(json).toContain('analysisStatus');
    expect(json).toContain('LOCAL HORIZON');
    expect(json).toContain('warnings');
    expect(json).toContain('dataConfidence');
  });
});
