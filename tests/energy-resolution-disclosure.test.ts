/** v1.11: coarse integration is allowed only with an explicit, shared disclosure. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, simulateMission, evaluateAt } from '../src/engine/simulation';
import { siteById } from '../src/data/landingSites';
import { DAY_MS } from '../src/engine/constants';
import {
  reportWarnings, disclosureCodes, missionReportJSON, summaryCSV, timeseriesCSV,
  eventsCSV, energyHistoryCSV, horizonCSV, comparisonCSV, comparisonJSON, resolveComparisonRow,
} from '../src/utils/export';
import { missionExportGate } from '../src/utils/exportGuard';
import type { SimulationResult } from '../src/types/mission';

const CODE = 'ENERGY_RESOLUTION_COARSE';
const START = Date.parse('2026-12-18T00:00:00Z');
const site = siteById('de-gerlache-rim-2')!;
const cfg = { ...DEFAULT_CONFIG, durationDays: 5, stepMinutes: 60 };
const base = simulateMission(site, START, START + 5 * DAY_MS, cfg);
function coarse(): SimulationResult {
  const d = base.summary!.integrationDiagnostics!;
  return {
    ...base,
    summary: {
      ...base.summary!,
      integrationDiagnostics: { ...d, resolutionStatus: 'coarse', relativeEnergyError: 0.02, estimatedEnergyErrorKWh: base.summary!.selectedEnergyKWh * 0.02 },
    },
  };
}

describe('coarse energy-resolution policy', () => {
  it('emits one explicit warning and disclosure code, without changing eligibility', () => {
    const sim = coarse();
    expect(sim.analysis.demoEligible).toBe(true);
    expect(reportWarnings(site, sim).filter((w) => w.includes(CODE))).toHaveLength(1);
    expect(disclosureCodes(site, sim).filter((c) => c === CODE)).toHaveLength(1);
    const warning = reportWarnings(site, sim).find((w) => w.includes(CODE))!;
    expect(warning).toMatch(/1%/);
    expect(warning).toMatch(/energy|battery/i);
    expect(warning).toMatch(/not.*thermal|thermal.*not/i);
  });

  it('does not label converged, adequate or missing diagnostics as coarse', () => {
    for (const status of ['converged', 'adequate'] as const) {
      const sim = { ...base, summary: { ...base.summary!, integrationDiagnostics: { ...base.summary!.integrationDiagnostics!, resolutionStatus: status } } };
      expect(disclosureCodes(site, sim)).not.toContain(CODE);
      expect(reportWarnings(site, sim).join(' ')).not.toContain(CODE);
    }
    const { integrationDiagnostics: _omitted, ...rest } = base.summary!;
    expect(disclosureCodes(site, { ...base, summary: rest })).not.toContain(CODE);
    expect(disclosureCodes(site, null)).not.toContain(CODE);
  });

  it('allows export with the warning present in JSON and every mission CSV row', async () => {
    const sim = coarse();
    const gate = missionExportGate({ kind: 'energy', loading: false, error: null, sim, expectedSiteId: site.id, expectedStartMs: START, expectedEndMs: START + 5 * DAY_MS, expectedSite: site, expectedConfig: cfg });
    expect(gate.ok).toBe(true);
    const report = JSON.parse(await missionReportJSON(site, cfg, sim, evaluateAt(site, START, cfg)));
    expect(report.reproducibility.warnings.some((w: string) => w.includes(CODE))).toBe(true);
    expect(report.reproducibility.numericalUncertainty.integrationResolution).toBe('coarse');
    const fp = report.analysisFingerprint;
    const csvs = [await summaryCSV(sim, fp), await timeseriesCSV(sim, fp), await eventsCSV(sim, fp), await energyHistoryCSV(sim, fp), await horizonCSV(site, evaluateAt(site, START, cfg), sim, fp)];
    for (const csv of csvs) {
      const lines = csv.trim().split('\n');
      expect(lines.length).toBeGreaterThan(1);
      const header = lines[0].split(',');
      const index = header.indexOf('disclosures');
      expect(index).toBeGreaterThanOrEqual(0);
      for (const row of lines.slice(1)) expect(row.split(',')[index]).toContain(CODE);
    }
  });

  it('carries the same warning into comparison UI resolution and both comparison exports', async () => {
    const scenario = { id: 'coarse-case', siteId: site.id, startMs: START, config: cfg };
    const row = { scenario, site, sim: coarse() };
    const resolved = resolveComparisonRow(row);
    expect(resolved.resolutionState).not.toBe('BLOCKED');
    expect(resolved.warnings.some((w) => w.includes(CODE))).toBe(true);
    expect(await comparisonCSV([row])).toContain(CODE);
    const json = JSON.parse(await comparisonJSON([row]));
    expect(json.rows[0].warnings.some((w: string) => w.includes(CODE))).toBe(true);
  });
});
