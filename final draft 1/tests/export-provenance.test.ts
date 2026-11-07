/**
 * v1.10 export provenance: application/schema metadata, analysis fingerprint,
 * effective (sanitized) configuration, status-aware DEM wording, CSV provenance
 * columns, refined-event export, and energy-history reconciliation.
 *
 * Written BEFORE the v1.10 implementation (tests-first).
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  missionReportJSON, timeseriesCSV, summaryCSV, eventsCSV, energyHistoryCSV,
  REPORT_SCHEMA_VERSION, csvProvenanceColumns, reportWarnings,
} from '../src/utils/export';
import { analysisFingerprint, shortFingerprint } from '../src/utils/analysisId';
import { APP_VERSION } from '../src/version';
import { simulateMission, DEFAULT_CONFIG, evaluateAt, simulationKey } from '../src/engine/simulation';
import { sanitizeConfig } from '../src/engine/configLimits';
import { siteById, makeCustomSite } from '../src/data/landingSites';
import { DAY_MS } from '../src/engine/constants';
import type { HorizonMask } from '../src/terrain/types';
import type { LandingSite } from '../src/types/mission';

const START = Date.parse('2026-12-18T00:00:00Z');
const cfg = { ...DEFAULT_CONFIG, stepMinutes: 60, durationDays: 5 };

function meMask(): HorizonMask {
  const n = 72;
  return {
    latitude: -89.5, longitude: 45, radius_km: 5, horizon_radius_km: 4.9, edge_inset_m: 55,
    sampling_step_m: 20, grid_size: 257, grid_spacing_m: 39, eye_height_m: 2,
    azimuth_step_deg: 5, azimuths_deg: Array.from({ length: n }, (_, i) => i * 5),
    elevations_deg: new Array(n).fill(1), ray_coverage_percent: new Array(n).fill(100),
    max_obstacle_range_km: new Array(n).fill(1), mean_coverage_percent: 100, synthetic: false,
    source: { filename: 'TEST_ME.tif', lunar_radius_m: 1737400, elevation_reference_radius_m: 1737400, elevation_reference: 'datum', lunar_reference_frame: 'MOON_ME (JPL DE421)', synthetic: false },
    model: 'test', frame_note: '',
  };
}
function meSite(): LandingSite {
  return makeCustomSite({ name: 'ME DEM', latitude: -89.5, longitude: 45, elevationM: 0, preset: 'flat', horizon: meMask() });
}

describe('analysis fingerprint', () => {
  it('is the SHA-256 of the SAME simulationKey the hook/cache uses (one source of truth)', async () => {
    const site = siteById('connecting-ridge')!;
    const fp = await analysisFingerprint(site, START, START + 5 * DAY_MS, cfg);
    const expected = createHash('sha256').update(simulationKey(site, START, START + 5 * DAY_MS, cfg)).digest('hex');
    expect(fp).toBe(expected);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(shortFingerprint(fp)).toBe(fp.slice(0, 16));
  });
  it('changes when any identity input changes (config, window, terrain)', async () => {
    const site = siteById('connecting-ridge')!;
    const a = await analysisFingerprint(site, START, START + 5 * DAY_MS, cfg);
    const b = await analysisFingerprint(site, START, START + 5 * DAY_MS, { ...cfg, loadW: cfg.loadW + 10 });
    const c = await analysisFingerprint(site, START + DAY_MS, START + 6 * DAY_MS, cfg);
    const altered: LandingSite = { ...site, terrain: { ...site.terrain, elevations: site.terrain.elevations.map((v, i) => (i === 0 ? v + 1 : v)) } };
    const d = await analysisFingerprint(altered, START, START + 5 * DAY_MS, cfg);
    expect(new Set([a, b, c, d]).size).toBe(4);
  });
});

describe('JSON report application/schema metadata', () => {
  it('carries app version, INDEPENDENT report schema version, UTC generation time and fingerprint', async () => {
    const site = siteById('apollo-11')!;
    const sim = simulateMission(site, START, START + 5 * DAY_MS, cfg);
    const r = JSON.parse(await missionReportJSON(site, cfg, sim, evaluateAt(site, START, cfg)));
    expect(r.applicationVersion).toBe(APP_VERSION);
    expect(r.reportSchemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(r.reportSchemaVersion).not.toBe(r.applicationVersion);
    expect(r.timeReference).toBe('UTC');
    expect(Date.parse(r.generatedAt)).toBeGreaterThan(0);
    expect(r.analysisFingerprint).toBe(await analysisFingerprint(site, START, START + 5 * DAY_MS, cfg));
    expect(r.schemaVersionPolicy).toMatch(/independent/i);
  });
  it('records the EFFECTIVE sanitized config, never silently-clamped requested values', async () => {
    const site = siteById('connecting-ridge')!;
    const outOfRange = { ...cfg, loadW: 999999, durationDays: 5 };
    const sim = simulateMission(site, START, START + 5 * DAY_MS, outOfRange);
    expect(sim.config.loadW).toBe(10000); // engine clamped
    const r = JSON.parse(await missionReportJSON(site, outOfRange, sim, evaluateAt(site, START, cfg)));
    expect(r.effectiveConfig.loadW).toBe(10000);
    expect(r.config.loadW).toBe(10000); // top-level config describes what was CALCULATED
    expect(r.requestedConfig.loadW).toBe(999999);
    expect(r.configWasClamped).toBe(true);
    expect(r.clampedFields).toContain('loadW');
    expect(r.reproducibility.powerAssumptions.loadW).toBe(10000);
    expect(r.reproducibility.effectiveConfig.loadW).toBe(10000);
  });
  it('provenance identifies the site, coordinates, frame transform and validated epoch range', async () => {
    const site = meSite();
    const sim = simulateMission(site, START, START + 5 * DAY_MS, cfg);
    const r = JSON.parse(await missionReportJSON(site, cfg, sim, evaluateAt(site, START, cfg)));
    const p = r.reproducibility.siteProvenance;
    expect(p.siteId).toBe(site.id);
    expect(p.siteName).toBe(site.name);
    expect(p.latitude).toBeCloseTo(site.latitude, 6);
    expect(p.longitude).toBeCloseTo(site.longitude, 6);
    const t = r.reproducibility.terrain;
    expect(t.frameVerified).toBe(true);
    expect(t.frameTransform).toBe('me');
    expect(t.validatedEpochRange).toContain('2020');
    expect(t.validatedEpochRange).toContain('2035');
    expect(t.appliedTransformation).toMatch(/constant/i);
    expect(t.frameResidualDeg).toBeGreaterThan(0);
  });
});

describe('status-aware DEM disclosure (no generic verify-frame wording)', () => {
  it('verified ME DEM: names the frame + constant transform + residual + planning grade, NOT generic "verify frame alignment"', async () => {
    const site = meSite();
    const sim = simulateMission(site, START, START + 5 * DAY_MS, cfg);
    const r = JSON.parse(await missionReportJSON(site, cfg, sim, evaluateAt(site, START, cfg)));
    const disclosure: string = r.reproducibility.terrain.disclosure;
    expect(disclosure).toMatch(/MOON_ME/);
    expect(disclosure).toMatch(/constant/i);
    expect(disclosure).toMatch(/residual/i);
    expect(disclosure).toMatch(/planning-grade/i);
    expect(disclosure).not.toMatch(/Verify frame alignment/i);
    expect(r.disclaimer).not.toMatch(/Verify frame alignment/i);
  });
  it('IAU DEM: already in the ephemeris frame, no rotation', async () => {
    const mask = meMask();
    mask.source.lunar_reference_frame = 'IAU_MOON';
    const site = makeCustomSite({ name: 'IAU DEM', latitude: -89.5, longitude: 45, elevationM: 0, preset: 'flat', horizon: mask });
    const sim = simulateMission(site, START, START + 5 * DAY_MS, cfg);
    const r = JSON.parse(await missionReportJSON(site, cfg, sim, evaluateAt(site, START, cfg)));
    expect(r.reproducibility.terrain.disclosure).toMatch(/already/i);
    expect(r.reproducibility.terrain.disclosure).toMatch(/no rotation/i);
  });
  it('unverified frame: explains the block; out-of-range epoch: names the validated restriction', async () => {
    const mask = meMask();
    mask.source.lunar_reference_frame = 'MYSTERY_FRAME';
    const site = makeCustomSite({ name: 'Unknown', latitude: -89.5, longitude: 45, elevationM: 0, preset: 'flat', horizon: mask });
    const sim = simulateMission(site, START, START + 5 * DAY_MS, cfg);
    const r = JSON.parse(await missionReportJSON(site, cfg, sim, evaluateAt(site, START, cfg)));
    expect(r.reproducibility.terrain.disclosure).toMatch(/blocked/i);
    expect(r.reproducibility.analysisStatus.status).toBe('FRAME_UNVERIFIED');

    const ok = meSite();
    const far = Date.parse('2040-06-01T00:00:00Z');
    const simFar = simulateMission(ok, far, far + 5 * DAY_MS, cfg);
    const rf = JSON.parse(await missionReportJSON(ok, cfg, simFar, evaluateAt(ok, far, cfg)));
    expect(rf.reproducibility.terrain.disclosure).toMatch(/2020/);
    expect(rf.reproducibility.terrain.disclosure).toMatch(/2035/);
    expect(rf.reproducibility.analysisStatus.status).toBe('FRAME_MODEL_OUTSIDE_VALIDATED_RANGE');
  });
  it('synthetic and illustrative terrain are explicitly labeled demonstration data', async () => {
    const mask = meMask();
    mask.synthetic = true;
    mask.source.synthetic = true;
    const syn = makeCustomSite({ name: 'Synthetic', latitude: -89.5, longitude: 45, elevationM: 0, preset: 'flat', horizon: mask });
    const simS = simulateMission(syn, START, START + 5 * DAY_MS, cfg);
    const rs = JSON.parse(await missionReportJSON(syn, cfg, simS, evaluateAt(syn, START, cfg)));
    expect(rs.reproducibility.terrain.disclosure).toMatch(/demonstration|demo/i);
    expect(rs.reproducibility.terrain.disclosure).toMatch(/NOT real lunar data/i);

    const ill = siteById('connecting-ridge')!;
    const simI = simulateMission(ill, START, START + 5 * DAY_MS, cfg);
    const ri = JSON.parse(await missionReportJSON(ill, cfg, simI, evaluateAt(ill, START, cfg)));
    expect(ri.reproducibility.terrain.disclosure).toMatch(/illustrative/i);
    expect(ri.reproducibility.terrain.disclosure).toMatch(/not a measured/i);
  });
});

describe('CSV provenance columns', () => {
  it('every mission CSV row carries fingerprint, versions, site, status, confidence, frame, horizon scale, disclosures', async () => {
    // de-gerlache-rim-2 has a refined Sun transition in this window (events CSV non-empty).
    const site = siteById('de-gerlache-rim-2')!;
    const sim = simulateMission(site, START, START + 5 * DAY_MS, cfg);
    const fp = await analysisFingerprint(site, START, START + 5 * DAY_MS, cfg);
    for (const csv of [await timeseriesCSV(sim, fp), await summaryCSV(sim, fp), await eventsCSV(sim, fp), await energyHistoryCSV(sim, fp)]) {
      const header = csv.split('\n')[0].split(',');
      for (const col of Object.keys(csvProvenanceColumns())) {
        expect(header).toContain(col);
      }
      const firstRow = csv.split('\n')[1];
      expect(firstRow).toContain(shortFingerprint(fp));
      expect(firstRow).toContain(APP_VERSION);
      expect(firstRow).toContain(site.id);
      expect(firstRow).toContain('ILLUSTRATIVE');
      expect(firstRow).toContain('LOCAL');
    }
  });
  it('CSV stays standards-compatible: one header row, uniform column count, no metadata comment rows', async () => {
    const site = siteById('de-gerlache-rim-2')!;
    const sim = simulateMission(site, START, START + 5 * DAY_MS, cfg);
    const fp = await analysisFingerprint(site, START, START + 5 * DAY_MS, cfg);
    const csv = await eventsCSV(sim, fp);
    const lines = csv.split('\n');
    const width = lines[0].split(',').length;
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.startsWith('#')).toBe(false);
      // naive split is safe here: provenance values contain no commas; quoted fields may.
      const cols = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.filter((s) => s !== '').length;
      expect(cols).toBe(width);
    }
  });
});

describe('refined events export', () => {
  it('preserves sub-sample event timestamps at full millisecond precision with pre/post state', async () => {
    const site = siteById('de-gerlache-rim-2')!;
    const sim = simulateMission(site, START, START + 5 * DAY_MS, cfg);
    expect(sim.events.length).toBeGreaterThan(0);
    const fp = await analysisFingerprint(site, START, START + 5 * DAY_MS, cfg);
    const csv = await eventsCSV(sim, fp);
    const lines = csv.split('\n');
    const header = lines[0].split(',');
    const iMs = header.indexOf('event_time_ms');
    const iUtc = header.indexOf('event_utc');
    const iBody = header.indexOf('body');
    const iBefore = header.indexOf('visible_before');
    const iAfter = header.indexOf('visible_after');
    expect(iMs).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const ev = sim.events[i - 1];
      expect(Number(cols[iMs])).toBe(ev.timeMs); // exact, never rounded to the sample grid
      expect(cols[iUtc]).toBe(new Date(ev.timeMs).toISOString());
      expect(cols[iBody]).toBe(ev.body);
      expect(cols[iAfter]).toBe(ev.visible ? '1' : '0');
      expect(['0', '1']).toContain(cols[iBefore]);
      expect(cols[iBefore]).not.toBe(cols[iAfter]);
    }
    // At least one event is OFF the coarse sample grid (refinement actually preserved).
    const grid = new Set(sim.samples.map((s) => Math.round(s.timeMs)));
    expect(sim.events.some((e) => !grid.has(Math.round(e.timeMs)))).toBe(true);
  });
});

describe('energy history reconciliation', () => {
  it('history is the integrator trajectory itself: final/min SOC, generated energy and deficit hours reconcile with the summary', async () => {
    const site = siteById('de-gerlache-rim-2')!; // has a refined Sun transition in-window
    // Small battery + heavy load forces depletion so deficit reconciliation is exercised.
    const heavy = { ...cfg, loadW: 600, batteryCapacityKWh: 2, initialSocPct: 40 };
    const sim = simulateMission(site, START, START + 5 * DAY_MS, heavy);
    const h = sim.energyHistory!;
    const s = sim.summary!;
    expect(h.length).toBeGreaterThan(2);
    expect(h[0].timeMs).toBe(START);
    expect(h[0].state).toBe('initial');
    expect(h[0].socPct).toBeCloseTo(40, 6);
    const last = h[h.length - 1];
    expect(last.timeMs).toBe(START + 5 * DAY_MS);
    expect(last.socPct).toBeCloseTo(s.finalBatterySocPct, 6);
    expect(Math.min(...h.map((r) => r.socPct))).toBeCloseTo(s.minBatterySocPct, 6);
    expect(last.cumulativeGeneratedKWh).toBeCloseTo(s.selectedEnergyKWh, 8);
    expect(last.cumulativeConsumedKWh).toBeCloseTo((heavy.loadW * s.durationHours) / 1000, 8);
    expect(h.reduce((a, r) => a + r.deficitHours, 0)).toBeCloseTo(s.depletionHours, 8);
    // Monotonic time, exact interval chaining, no invented interpolation.
    for (let i = 1; i < h.length; i++) {
      expect(h[i].timeMs).toBeGreaterThan(h[i - 1].timeMs);
      expect(h[i].intervalStartMs).toBe(h[i - 1].timeMs);
      expect(h[i].cumulativeGeneratedKWh).toBeGreaterThanOrEqual(h[i - 1].cumulativeGeneratedKWh);
    }
    // Sun-event boundaries are flagged at the refined timestamps.
    const sunEvents = sim.events.filter((e) => e.body === 'sun');
    for (const e of sunEvents) {
      expect(h.some((r) => Math.abs(r.timeMs - e.timeMs) < 1 && r.boundary === 'sun-event')).toBe(true);
    }
  });
  it('charge/discharge/saturation states use the SAME efficiency + SOC rules as the engine', async () => {
    const site = siteById('de-gerlache-rim-2')!;
    const sim = simulateMission(site, START, START + 5 * DAY_MS, { ...cfg, batteryCapacityKWh: 10, initialSocPct: 50, loadW: 300 });
    const h = sim.energyHistory!;
    expect(h.some((r) => r.state === 'full')).toBe(true); // saturation at capacity
    expect(h.some((r) => r.state === 'charging' || r.state === 'discharging')).toBe(true);
    for (const r of h) {
      expect(r.socPct).toBeGreaterThanOrEqual(0);
      expect(r.socPct).toBeLessThanOrEqual(100);
    }
  });
  it('blocked analyses expose NO energy history and NO quantitative CSV numbers', async () => {
    const mask = meMask();
    mask.source.lunar_reference_frame = 'MYSTERY_FRAME';
    const site = makeCustomSite({ name: 'Blocked', latitude: -89.5, longitude: 45, elevationM: 0, preset: 'flat', horizon: mask });
    const sim = simulateMission(site, START, START + 5 * DAY_MS, cfg);
    expect(sim.energyHistory ?? null).toBeNull();
    const fp = await analysisFingerprint(site, START, START + 5 * DAY_MS, cfg);
    const csv = await summaryCSV(sim, fp);
    expect(csv).toContain('FRAME_UNVERIFIED');
    expect(csv).not.toContain('illumination_pct');
    expect(reportWarnings(site, sim).some((w) => w.includes('ANALYSIS BLOCKED'))).toBe(true);
  });
});

describe('report traceability', () => {
  it('a report traces back to its exact site, config and analysis window via the fingerprint', async () => {
    const site = meSite();
    const sim = simulateMission(site, START, START + 5 * DAY_MS, cfg);
    const r = JSON.parse(await missionReportJSON(site, cfg, sim, evaluateAt(site, START, cfg)));
    const recomputed = await analysisFingerprint(
      { ...site }, r.reproducibility.interval.startUtc ? Date.parse(r.reproducibility.interval.startUtc) : 0,
      Date.parse(r.reproducibility.interval.endUtc), r.effectiveConfig,
    );
    expect(recomputed).toBe(r.analysisFingerprint);
    expect(r.site.id).toBe(site.id);
    expect(r.reproducibility.sampling.requestedStepMinutes).toBe(60);
  });
  it('sanitizeConfig identity: fingerprint of requested == fingerprint of effective when nothing was clamped', async () => {
    const site = siteById('apollo-11')!;
    const eff = sanitizeConfig(cfg);
    expect(await analysisFingerprint(site, START, START + 5 * DAY_MS, eff))
      .toBe(await analysisFingerprint(site, START, START + 5 * DAY_MS, cfg));
  });
});
