/**
 * v1.10 comparison exports: every row carries an EXPLICIT resolution state —
 * computing, blocked, failed, stale, missing-site and valid rows are never
 * conflated, and blank numeric cells are never an implicit status.
 * Written BEFORE the v1.10 implementation (tests-first).
 */
import { describe, expect, it } from 'vitest';
import {
  comparisonCSV, comparisonJSON, resolveComparisonRow, type ComparisonRow,
} from '../src/utils/export';
import { simulateMission, DEFAULT_CONFIG } from '../src/engine/simulation';
import { siteById, makeCustomSite } from '../src/data/landingSites';
import { DAY_MS } from '../src/engine/constants';
import type { Scenario, SimulationResult } from '../src/types/mission';
import type { HorizonMask } from '../src/terrain/types';

const START = Date.parse('2026-12-18T00:00:00Z');
const cfg = { ...DEFAULT_CONFIG, stepMinutes: 120, durationDays: 3 };
const illSite = siteById('connecting-ridge')!;
const illSim = simulateMission(illSite, START, START + 3 * DAY_MS, cfg);

function scenario(over: Partial<Scenario> = {}): Scenario {
  return { id: 'sc-1', siteId: illSite.id, startMs: START, config: { ...cfg }, label: 'A', ...over };
}
function row(over: Partial<ComparisonRow> = {}): ComparisonRow {
  return { scenario: scenario(), site: illSite, sim: illSim, loading: false, error: null, ...over };
}

function blockedSim(): { site: ReturnType<typeof makeCustomSite>; sim: SimulationResult } {
  const n = 72;
  const mask: HorizonMask = {
    latitude: -89.5, longitude: 45, radius_km: 5, horizon_radius_km: 4.9, edge_inset_m: 55,
    sampling_step_m: 20, grid_size: 257, grid_spacing_m: 39, eye_height_m: 2,
    azimuth_step_deg: 5, azimuths_deg: Array.from({ length: n }, (_, i) => i * 5),
    elevations_deg: new Array(n).fill(1), ray_coverage_percent: new Array(n).fill(100),
    max_obstacle_range_km: new Array(n).fill(1), mean_coverage_percent: 100, synthetic: false,
    source: { filename: 'bad.tif', lunar_radius_m: 1737400, elevation_reference_radius_m: 1737400, elevation_reference: 'datum', lunar_reference_frame: 'NOT_A_FRAME', synthetic: false },
    model: 'test', frame_note: '',
  };
  const site = makeCustomSite({ name: 'Blocked DEM', latitude: -89.5, longitude: 45, elevationM: 0, preset: 'flat', horizon: mask });
  return { site, sim: simulateMission(site, START, START + 3 * DAY_MS, cfg) };
}

describe('resolveComparisonRow — explicit states', () => {
  it('resolved eligible rows carry their analysis status (VALID / ILLUSTRATIVE / SYNTHETIC_DEMO)', () => {
    const r = resolveComparisonRow(row());
    expect(r.resolutionState).toBe('ILLUSTRATIVE');
    expect(r.quantitativeEligible).toBe(false); // illustrative is demo-eligible, not quantitative
    expect(r.summary).not.toBeNull();
    expect(r.failureReason).toBeNull();
  });
  it('computing rows are COMPUTING — never blank-status, never zero-valued', () => {
    for (const r of [resolveComparisonRow(row({ sim: null, loading: true })), resolveComparisonRow(row({ sim: null, loading: false }))]) {
      expect(r.resolutionState).toBe('COMPUTING');
      expect(r.summary).toBeNull();
    }
  });
  it('blocked rows are BLOCKED with the gate reason, no numbers', () => {
    const { site, sim } = blockedSim();
    const r = resolveComparisonRow(row({ site, sim, scenario: scenario({ siteId: site.id }) }));
    expect(r.resolutionState).toBe('BLOCKED');
    expect(r.analysisStatus).toBe('FRAME_UNVERIFIED');
    expect(r.summary).toBeNull();
    expect(r.failureReason).toMatch(/frame/i);
  });
  it('failed rows are COMPUTATION_FAILED with the error, no numbers', () => {
    const r = resolveComparisonRow(row({ sim: null, error: 'worker exploded' }));
    expect(r.resolutionState).toBe('COMPUTATION_FAILED');
    expect(r.failureReason).toContain('worker exploded');
    expect(r.summary).toBeNull();
  });
  it('missing site references are MISSING_SITE — never silently substituted', () => {
    const r = resolveComparisonRow(row({ site: null, sim: null }));
    expect(r.resolutionState).toBe('MISSING_SITE');
    expect(r.summary).toBeNull();
    expect(r.failureReason).toMatch(/site/i);
  });
  it('stale cache entries (result computed for a different config/site/window) are STALE, not exported as current', () => {
    const wrongConfig = resolveComparisonRow(row({ scenario: scenario({ config: { ...cfg, loadW: cfg.loadW + 50 } }) }));
    expect(wrongConfig.resolutionState).toBe('STALE');
    expect(wrongConfig.summary).toBeNull();
    const wrongWindow = resolveComparisonRow(row({ scenario: scenario({ startMs: START + DAY_MS }) }));
    expect(wrongWindow.resolutionState).toBe('STALE');
    const wrongSite = resolveComparisonRow(row({ scenario: scenario({ siteId: 'shackleton-rim' }) }));
    expect(wrongSite.resolutionState).toBe('STALE');
  });
});

describe('comparison CSV/JSON — per-row status + provenance', () => {
  it('all-resolved export carries status, confidence, provenance and warnings per row', async () => {
    const rows = [row(), row({ scenario: scenario({ id: 'sc-2', label: 'B', startMs: START + DAY_MS }), sim: simulateMission(illSite, START + DAY_MS, START + 4 * DAY_MS, cfg) })];
    const csv = await comparisonCSV(rows);
    const header = csv.split('\n')[0];
    for (const col of ['scenario_id', 'resolution_state', 'analysis_status', 'data_confidence', 'failure_reason', 'analysis_fingerprint', 'app_version', 'report_schema', 'site_id', 'terrain_kind', 'frame_transform', 'horizon_scale', 'warnings']) {
      expect(header).toContain(col);
    }
    expect(csv).toContain('ILLUSTRATIVE');
    const json = JSON.parse(await comparisonJSON(rows));
    expect(json.rows).toHaveLength(2);
    expect(json.rows[0].resolutionState).toBe('ILLUSTRATIVE');
    expect(json.rows[0].analysisFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(json.rows[0].warnings.length).toBeGreaterThan(0);
    expect(json.rows[0].siteProvenance).toBeTruthy();
    expect(json.policy).toMatch(/explicit/i);
  });
  it('mixed computing + blocked + failed + valid: invalid rows never appear as zero-valued valid cases', async () => {
    const { site: bSite, sim: bSim } = blockedSim();
    const rows = [
      row(),
      row({ scenario: scenario({ id: 'sc-2' }), sim: null, loading: true }),
      row({ scenario: scenario({ id: 'sc-3', siteId: bSite.id }), site: bSite, sim: bSim }),
      row({ scenario: scenario({ id: 'sc-4' }), sim: null, error: 'boom' }),
    ];
    const json = JSON.parse(await comparisonJSON(rows));
    const states = json.rows.map((r: { resolutionState: string }) => r.resolutionState);
    expect(states).toEqual(['ILLUSTRATIVE', 'COMPUTING', 'BLOCKED', 'COMPUTATION_FAILED']);
    for (const r of json.rows.slice(1)) {
      expect(r.summary).toBeNull();
      expect(r.failureReason ?? '').not.toBe('');
    }
    const csv = await comparisonCSV(rows);
    const lines = csv.split('\n');
    const header = lines[0].split(',');
    const iState = header.indexOf('resolution_state');
    const iIllum = header.indexOf('illumination_pct');
    const iScore = header.indexOf('score');
    for (let i = 2; i < lines.length; i++) {
      const cols = lines[i].split(',');
      expect(cols[iState]).not.toBe('');
      expect(cols[iIllum]).toBe(''); // blank, but ONLY alongside an explicit non-valid state
      expect(cols[iScore]).toBe('');
      expect(['COMPUTING', 'BLOCKED', 'COMPUTATION_FAILED']).toContain(cols[iState]);
    }
  });
  it('mixed confidence tiers are labeled per row and never ranked together', async () => {
    const rows = [row(), row({ scenario: scenario({ id: 'sc-2' }), site: siteById('apollo-11')!, sim: simulateMission(siteById('apollo-11')!, START, START + 3 * DAY_MS, cfg) })];
    rows[1].scenario.siteId = 'apollo-11';
    const json = JSON.parse(await comparisonJSON(rows));
    const confs = json.rows.map((r: { dataConfidence: string }) => r.dataConfidence);
    expect(new Set(confs).size).toBeGreaterThanOrEqual(1);
    expect(json.rankingNote).toMatch(/never rank/i);
    for (const r of json.rows) expect(r.dataConfidence).toBeTruthy();
  });
});
