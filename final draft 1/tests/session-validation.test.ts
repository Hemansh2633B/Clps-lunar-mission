/**
 * v1.10 persisted-session validation: MISSION_LIMITS is the single source of
 * truth, custom sites are deep-validated (including frame-metadata consistency),
 * duplicate/dangling references are rejected, and v1 sessions migrate explicitly.
 * Written BEFORE the v1.10 implementation (tests-first).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/engine/simulation';
import { MISSION_LIMITS, type NumericConfigKey } from '../src/engine/configLimits';
import { makeCustomSite } from '../src/data/landingSites';
import {
  parseSession, SESSION_VERSION, type TrainingSession, type WorkspaceSnapshot,
} from '../src/tutorial/session';
import type { HorizonMask } from '../src/terrain/types';
import type { MissionConfig } from '../src/types/mission';

function ws(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    selectedId: 'shackleton-rim', baselineMs: Date.parse('2026-12-18T00:00:00Z'), slipDays: 3,
    config: { ...DEFAULT_CONFIG }, viewDays: 30, timeMs: Date.parse('2026-12-20T08:00:00Z'),
    mode: 'planner', compareMode: false, terrainView: false, spaceView: false,
    scenarios: [], playing: false, speed: 3600, customSites: [], ...over,
  };
}
const session = (): TrainingSession => ({ v: SESSION_VERSION, user: ws(), training: ws() });
const parse = (s: unknown) => parseSession(JSON.stringify(s));

function withConfig(patch: Record<string, unknown>) {
  const s = session();
  s.user.config = { ...s.user.config, ...patch } as MissionConfig;
  return s;
}

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

describe('persisted config matches MISSION_LIMITS exactly', () => {
  for (const key of Object.keys(MISSION_LIMITS) as NumericConfigKey[]) {
    const lim = MISSION_LIMITS[key];
    it(`${key}: accepts min ${lim.min} and max ${lim.max}, rejects beyond both`, () => {
      expect(parse(withConfig({ [key]: lim.min }))).not.toBeNull();
      expect(parse(withConfig({ [key]: lim.max }))).not.toBeNull();
      expect(parse(withConfig({ [key]: lim.min - Math.max(lim.step, 0.001) }))).toBeNull();
      expect(parse(withConfig({ [key]: lim.max + Math.max(lim.step, 0.001) }))).toBeNull();
    });
  }
  it('the old v1.9 escape hatches (366 days / 1440 min) are now rejected', () => {
    expect(parse(withConfig({ durationDays: 366 }))).toBeNull();
    expect(parse(withConfig({ stepMinutes: 1440 }))).toBeNull();
    expect(parse(withConfig({ durationDays: 90, stepMinutes: 240 }))).not.toBeNull();
  });
  it('non-finite and non-numeric values are rejected', () => {
    for (const v of [NaN, Infinity, -Infinity, '180', null, undefined, true]) {
      expect(parse(withConfig({ loadW: v }))).toBeNull();
    }
  });
  it('invalid array modes are rejected', () => {
    expect(parse(withConfig({ arrayMode: 'diagonal' }))).toBeNull();
    expect(parse(withConfig({ arrayMode: 3 }))).toBeNull();
    for (const m of ['horizontal', 'vertical-tracking', 'vertical-fixed']) {
      expect(parse(withConfig({ arrayMode: m }))).not.toBeNull();
    }
  });
});

describe('deep custom-site validation', () => {
  it('a valid app-authored custom site (illustrative + DEM) round-trips', () => {
    const ill = makeCustomSite({ name: 'Mine', latitude: -89, longitude: 30, elevationM: 5, preset: 'ridge' });
    const dem = makeCustomSite({ name: 'DEM', latitude: -89.5, longitude: 45, elevationM: 0, preset: 'flat', horizon: meMask() });
    const s = session();
    s.user.customSites = [ill, dem];
    s.user.selectedId = dem.id;
    const back = parse(s);
    expect(back).not.toBeNull();
    expect(back!.user.customSites).toHaveLength(2);
  });
  it('rejects malformed terrain: missing label, bad kind, bad resolution, wrong array length, non-finite/out-of-range elevations', () => {
    const base = makeCustomSite({ name: 'X', latitude: -89, longitude: 30, elevationM: 0, preset: 'flat' });
    const mutations: ((t: Record<string, unknown>) => void)[] = [
      (t) => { delete t.label; },
      (t) => { t.kind = 'hologram'; },
      (t) => { t.resolutionDeg = 0; },
      (t) => { t.resolutionDeg = 7; }, // 360 not divisible
      (t) => { t.elevations = (t.elevations as number[]).slice(0, 10); }, // length ≠ 360/res (+1)
      (t) => { (t.elevations as number[])[3] = NaN; },
      (t) => { (t.elevations as number[])[3] = 95; },
      (t) => { t.elevations = new Array(5000).fill(0); t.resolutionDeg = 0.1; }, // oversized
      (t) => { t.eyeHeightM = -1; },
      (t) => { t.uncertaintyDeg = 200; },
      (t) => { t.coveragePercent = 140; },
      (t) => { t.analysisScale = 'regional'; }, // unsupported capability never accepted from storage
      (t) => { t.features = [{ name: 'x', azimuthDeg: 0, elevationDeg: 0, widthDeg: 0, kind: 'spire' }]; },
      (t) => { t.features = new Array(100).fill({ name: 'x', azimuthDeg: 0, elevationDeg: 0, widthDeg: 10, kind: 'rim' }); },
    ];
    for (const mutate of mutations) {
      const site = JSON.parse(JSON.stringify(base)) as { terrain: Record<string, unknown> };
      mutate(site.terrain);
      const s = session();
      s.user.customSites = [site as never];
      expect(parse(s)).toBeNull();
    }
  });
  it('a persisted frameVerified flag is NEVER trusted over inconsistent frame metadata', () => {
    const dem = makeCustomSite({ name: 'DEM', latitude: -89.5, longitude: 45, elevationM: 0, preset: 'flat', horizon: meMask() });
    expect(dem.terrain.frameVerified).toBe(true);
    // 1) verified flag + unrecognized source frame → reject
    const badFrame = JSON.parse(JSON.stringify(dem));
    badFrame.terrain.sourceFrame = 'TOTALLY_UNKNOWN';
    let s = session(); s.user.customSites = [badFrame];
    expect(parse(s)).toBeNull();
    // 2) verified flag + transform that contradicts the source frame → reject
    const badTransform = JSON.parse(JSON.stringify(dem));
    badTransform.terrain.frameTransform = 'pa';
    s = session(); s.user.customSites = [badTransform];
    expect(parse(s)).toBeNull();
    // 3) unsupported transform enum → reject
    const badEnum = JSON.parse(JSON.stringify(dem));
    badEnum.terrain.frameTransform = 'de440';
    s = session(); s.user.customSites = [badEnum];
    expect(parse(s)).toBeNull();
    // 4) verified flag without residual for me/pa → reject
    const noResidual = JSON.parse(JSON.stringify(dem));
    delete noResidual.terrain.frameResidualDeg;
    s = session(); s.user.customSites = [noResidual];
    expect(parse(s)).toBeNull();
    // 5) conservative downgrade (verified=false) is fine — the engine blocks it anyway
    const downgrade = JSON.parse(JSON.stringify(dem));
    downgrade.terrain.frameVerified = false;
    s = session(); s.user.customSites = [downgrade];
    expect(parse(s)).not.toBeNull();
  });
  it('synthetic/real metadata must be consistent (synthetic terrain never claims measured confidence)', () => {
    const dem = makeCustomSite({ name: 'DEM', latitude: -89.5, longitude: 45, elevationM: 0, preset: 'flat', horizon: meMask() });
    const lying = JSON.parse(JSON.stringify(dem));
    lying.terrain.synthetic = true; // now synthetic but dataConfidence still 'measured'
    const s = session(); s.user.customSites = [lying];
    expect(parse(s)).toBeNull();
    const honest = JSON.parse(JSON.stringify(lying));
    honest.dataConfidence = 'synthetic';
    honest.terrain.frameTransform = null;
    const s2 = session(); s2.user.customSites = [honest];
    expect(parse(s2)).not.toBeNull();
  });
  it('rejects invalid optional metadata types and coordinate enums', () => {
    const base = makeCustomSite({ name: 'X', latitude: -89, longitude: 30, elevationM: 0, preset: 'flat' });
    for (const patch of [{ coordinateType: 'gps' }, { coordinateUncertaintyDeg: -1 }, { sourceUrl: 42 }, { dataConfidence: 'trust-me' }, { program: [] }]) {
      const site = { ...JSON.parse(JSON.stringify(base)), ...patch };
      const s = session(); s.user.customSites = [site];
      expect(parse(s)).toBeNull();
    }
  });
  it('rejects duplicate custom-site IDs, catalog collisions and duplicate scenario IDs', () => {
    const a = makeCustomSite({ name: 'A', latitude: -89, longitude: 30, elevationM: 0, preset: 'flat' });
    const dup = { ...JSON.parse(JSON.stringify(a)) };
    let s = session(); s.user.customSites = [a, dup];
    expect(parse(s)).toBeNull();
    const collision = { ...JSON.parse(JSON.stringify(a)), id: 'shackleton-rim' };
    s = session(); s.user.customSites = [collision];
    expect(parse(s)).toBeNull();
    s = session();
    s.user.scenarios = [
      { id: 'same', siteId: 'connecting-ridge', startMs: 0, config: { ...DEFAULT_CONFIG } },
      { id: 'same', siteId: 'connecting-ridge', startMs: 1000, config: { ...DEFAULT_CONFIG } },
    ];
    expect(parse(s)).toBeNull();
  });
});

describe('versioned migration + recovery', () => {
  it('a VALID legacy v1 session migrates to the current version with data intact', () => {
    const legacy = { ...session(), v: 1 };
    const back = parseSession(JSON.stringify(legacy));
    expect(back).not.toBeNull();
    expect(back!.v).toBe(SESSION_VERSION);
    expect(back!.user).toEqual(legacy.user);
    expect(back!.training).toEqual(legacy.training);
  });
  it('a legacy v1 session with out-of-range config is NOT silently clamped — it routes to recovery (null)', () => {
    const legacy = { ...session(), v: 1 };
    (legacy.user.config as MissionConfig).durationDays = 200;
    expect(parseSession(JSON.stringify(legacy))).toBeNull();
  });
  it('unsupported schema versions and malformed payloads parse to null (never throw, never partial)', () => {
    expect(parseSession(JSON.stringify({ ...session(), v: SESSION_VERSION + 1 }))).toBeNull();
    expect(parseSession(JSON.stringify({ ...session(), v: '2' }))).toBeNull();
    expect(parseSession('{broken')).toBeNull();
    expect(parseSession(null)).toBeNull();
  });
});
