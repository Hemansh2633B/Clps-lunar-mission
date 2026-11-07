/**
 * v1.10 cross-output consistency: for the SAME site + analysis, the JSON report,
 * CSV exports, accessibility footer and tutorial-facing disclosures must agree
 * on confidence, status, frame verification, horizon scale, interval, effective
 * config, energy deficit and sampling. Also: honest download terminology.
 * Written BEFORE the v1.10 implementation (tests-first).
 */
import { describe, expect, it } from 'vitest';
import {
  missionReportJSON, timeseriesCSV, summaryCSV, eventsCSV, energyHistoryCSV,
  exportInitiatedMessage, reportWarnings,
} from '../src/utils/export';
import { demFooterStatus } from '../src/utils/a11y';
import { creditsMissionReport } from '../src/tutorial/witnesses';
import { simulateMission, DEFAULT_CONFIG, evaluateAt } from '../src/engine/simulation';
import { siteById, makeCustomSite } from '../src/data/landingSites';
import { DAY_MS } from '../src/engine/constants';
import type { HorizonMask } from '../src/terrain/types';

const START = Date.parse('2026-12-18T00:00:00Z');
const cfg = { ...DEFAULT_CONFIG, stepMinutes: 60, durationDays: 4 };

function meSite() {
  const n = 72;
  const mask: HorizonMask = {
    latitude: -89.5, longitude: 45, radius_km: 5, horizon_radius_km: 4.9, edge_inset_m: 55,
    sampling_step_m: 20, grid_size: 257, grid_spacing_m: 39, eye_height_m: 2,
    azimuth_step_deg: 5, azimuths_deg: Array.from({ length: n }, (_, i) => i * 5),
    // 1.71° lies inside this window's Sun-elevation range at -89.5° → a refined
    // transition exists, so the events CSV carries data rows too.
    elevations_deg: new Array(n).fill(1.71), ray_coverage_percent: new Array(n).fill(100),
    max_obstacle_range_km: new Array(n).fill(1), mean_coverage_percent: 100, synthetic: false,
    source: { filename: 'CONSISTENCY_ME.tif', lunar_radius_m: 1737400, elevation_reference_radius_m: 1737400, elevation_reference: 'datum', lunar_reference_frame: 'MOON_ME (JPL DE421)', synthetic: false },
    model: 'test', frame_note: '',
  };
  return makeCustomSite({ name: 'Consistency DEM', latitude: -89.5, longitude: 45, elevationM: 0, preset: 'flat', horizon: mask });
}

describe('one analysis, one story across every output', () => {
  it('verified ME DEM: JSON, CSVs and the a11y footer agree on frame, confidence, status and LOCAL horizon', async () => {
    const site = meSite();
    const sim = simulateMission(site, START, START + 4 * DAY_MS, cfg);
    expect(sim.analysis.status).toBe('VALID');
    const report = JSON.parse(await missionReportJSON(site, cfg, sim, evaluateAt(site, START, cfg)));
    const footer = demFooterStatus(site, sim.analysis, false);
    const warnings = reportWarnings(site, sim);

    // Confidence + status everywhere.
    expect(report.reproducibility.siteProvenance.dataConfidence).toBe('measured');
    expect(report.summary.dataConfidence).toBe('measured');
    expect(report.reproducibility.analysisStatus.status).toBe('VALID');
    const summary = await summaryCSV(sim, report.analysisFingerprint);
    expect(summary).toContain('VALID');
    expect(summary).toContain('measured');

    // Frame verification + constant transform + residual: report and footer agree.
    expect(report.reproducibility.terrain.frameVerified).toBe(true);
    expect(report.reproducibility.terrain.frameTransform).toBe('me');
    expect(footer.text).toMatch(/verified/i);
    expect(footer.text).toMatch(/constant/i);
    expect(report.reproducibility.terrain.disclosure).toMatch(/constant/i);
    expect(warnings.some((w) => /constant rotation/i.test(w))).toBe(true);

    // LOCAL horizon scale in every output.
    expect(report.reproducibility.terrain.horizonScale).toBe('LOCAL HORIZON');
    expect(footer.text).toMatch(/LOCAL horizon/i);
    for (const csv of [await timeseriesCSV(sim, report.analysisFingerprint), summary, await eventsCSV(sim, report.analysisFingerprint), await energyHistoryCSV(sim, report.analysisFingerprint)]) {
      expect(csv.split('\n')[1]).toContain('LOCAL');
    }

    // Interval + effective config + sampling agree.
    expect(report.reproducibility.interval.startUtc).toBe(new Date(sim.summary!.startMs).toISOString());
    expect(report.effectiveConfig).toEqual(sim.config);
    expect(report.reproducibility.sampling.effectiveStepMinutes).toBe(sim.sampling.effectiveStepMinutes);
    expect(summary).toContain(sim.sampling.sampleCount.toString());

    // Energy deficit / battery numbers identical in JSON + summary CSV.
    expect(report.summary.depletionHours).toBe(sim.summary!.depletionHours);
    expect(summary).toContain(sim.summary!.minBatterySocPct.toFixed(1));
  });
  it('illustrative terrain: no output may claim measured confidence', async () => {
    const site = siteById('connecting-ridge')!;
    const sim = simulateMission(site, START, START + 4 * DAY_MS, cfg);
    const report = JSON.parse(await missionReportJSON(site, cfg, sim, evaluateAt(site, START, cfg)));
    expect(report.reproducibility.analysisStatus.status).toBe('ILLUSTRATIVE');
    expect(report.reproducibility.siteProvenance.dataConfidence).not.toBe('measured');
    const footer = demFooterStatus(site, sim.analysis, false);
    expect(footer.text).toMatch(/illustrative/i);
    const csv = await summaryCSV(sim, report.analysisFingerprint);
    expect(csv).toContain('ILLUSTRATIVE');
    expect(csv).toContain('illustrative');
    expect(csv).not.toContain('measured');
  });
});

describe('honest download semantics', () => {
  it('export messages say INITIATED — never claim the user saved the file', () => {
    for (const kind of ['json', 'timeseries', 'horizon', 'summary', 'events', 'energy'] as const) {
      const msg = exportInitiatedMessage(kind);
      expect(msg).toMatch(/initiated/i);
      expect(msg).not.toMatch(/\bsaved\b/i);
      expect(msg).not.toMatch(/download completed/i);
    }
  });
  it('tutorial credit still requires a guard-passing JSON export whose dispatch succeeded (CSV never credits)', () => {
    expect(creditsMissionReport('json', true, true)).toBe(true);
    expect(creditsMissionReport('json', false, true)).toBe(false);
    expect(creditsMissionReport('json', true, false)).toBe(false);
    for (const kind of ['timeseries', 'horizon', 'summary', 'events', 'energy'] as const) {
      expect(creditsMissionReport(kind, true, true)).toBe(false);
    }
  });
});
