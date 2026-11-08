/** v1.11 integrity regressions: no rounded analysis identity. */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { DEFAULT_CONFIG, simulateMission, simulationKey } from '../src/engine/simulation';
import { sanitizeConfig } from '../src/engine/configLimits';
import { siteById } from '../src/data/landingSites';
import { DAY_MS } from '../src/engine/constants';
import { analysisFingerprint } from '../src/utils/analysisId';
import { missionExportGate } from '../src/utils/exportGuard';
import { canonicalJson } from '../src/engine/canonicalJson';
import type { LandingSite, MissionConfig } from '../src/types/mission';

const START = Date.parse('2026-12-18T00:00:00Z');
const END = START + 2 * DAY_MS;
const cfg: MissionConfig = { ...DEFAULT_CONFIG, durationDays: 2, stepMinutes: 240 };
const site = siteById('connecting-ridge')!;
const key = (s = site, start = START, end = END, c = cfg) => simulationKey(s, start, end, c);
const withTerrain = (patch: Partial<LandingSite['terrain']>): LandingSite => ({ ...site, terrain: { ...site.terrain, ...patch } });

describe('exact simulation identity', () => {
  it('distinguishes terrain masks differing by 0.0001 degrees at one bin', () => {
    const elevations = [...site.terrain.elevations];
    elevations[7] += 1e-4;
    expect(key(withTerrain({ elevations }))).not.toBe(key());
  });

  it('distinguishes sub-rounding coordinate, elevation and azimuth changes', () => {
    expect(key({ ...site, latitude: site.latitude + 1e-6 })).not.toBe(key());
    expect(key({ ...site, longitude: site.longitude + 1e-6 })).not.toBe(key());
    expect(key({ ...site, elevationM: site.elevationM + 0.01 })).not.toBe(key());
    expect(key(withTerrain({ azimuthOffsetDeg: 0 }))).not.toBe(key(withTerrain({ azimuthOffsetDeg: 1e-5 })));
  });

  it('retains millisecond endpoints and second-offset windows', () => {
    expect(key(site, START + 1)).not.toBe(key());
    expect(key(site, START, END + 1)).not.toBe(key());
    expect(key(site, START + 1000, END + 1000)).not.toBe(key());
  });

  it('includes every mission configuration field without rounding', () => {
    for (const field of ['durationDays', 'arrayAreaM2', 'cellEfficiency', 'systemDerate', 'fixedPanelAzimuthDeg', 'loadW', 'batteryCapacityKWh', 'initialSocPct', 'commsMarginDeg', 'stepMinutes'] as const) {
      expect(key(site, START, END, { ...cfg, [field]: cfg[field] + 1e-6 }), field).not.toBe(key());
    }
    expect(key(site, START, END, { ...cfg, arrayMode: 'horizontal' })).not.toBe(key());
  });

  it('includes terrain metadata and feature order rather than a partial projection', () => {
    expect(key(withTerrain({ sourceFrame: 'MOON_ME (JPL DE421)' }))).not.toBe(key(withTerrain({ sourceFrame: 'IAU_MOON' })));
    expect(key(withTerrain({ frameNote: 'a' }))).not.toBe(key(withTerrain({ frameNote: 'b' })));
    expect(key(withTerrain({ frameTransform: undefined }))).not.toBe(key(withTerrain({ frameTransform: null })));
    const features = [...site.terrain.features].reverse();
    expect(key(withTerrain({ features }))).not.toBe(key());
  });

  it('is stable under object-property insertion order, but not array reordering', () => {
    const reordered = Object.fromEntries(Object.entries(site).reverse()) as unknown as LandingSite;
    reordered.terrain = Object.fromEntries(Object.entries(site.terrain).reverse()) as unknown as LandingSite['terrain'];
    expect(key(reordered)).toBe(key());
    const elevations = [...site.terrain.elevations];
    [elevations[0], elevations[1]] = [elevations[1], elevations[0]];
    if (site.terrain.elevations[0] !== site.terrain.elevations[1]) {
      expect(key(withTerrain({ elevations }))).not.toBe(key());
    }
  });

  it('rejects non-finite numeric inputs instead of hashing them as null', () => {
    expect(() => key({ ...site, latitude: NaN })).toThrow(/finite/i);
    expect(() => key(site, Infinity)).toThrow(/finite/i);
    expect(() => key(withTerrain({ elevations: [Infinity] }))).toThrow(/finite/i);
  });

  it('feeds the same exact key to the SHA-256 report fingerprint', async () => {
    const fp = await analysisFingerprint(site, START, END, cfg);
    expect(fp).toBe(createHash('sha256').update(key()).digest('hex'));
    const elevations = [...site.terrain.elevations];
    elevations[7] += 1e-4;
    expect(await analysisFingerprint(withTerrain({ elevations }), START, END, cfg)).not.toBe(fp);
    expect(await analysisFingerprint(site, START + 1000, END + 1000, cfg)).not.toBe(fp);
  });

  it('makes the export guard refuse a near-identical terrain substitution', () => {
    const sim = simulateMission(site, START, END, cfg);
    expect(sim.summary).not.toBeNull();
    const elevations = [...site.terrain.elevations];
    elevations[7] += 1e-4;
    const gate = missionExportGate({
      kind: 'json', loading: false, error: null, sim,
      expectedSiteId: site.id, expectedStartMs: START, expectedEndMs: END,
      expectedSite: withTerrain({ elevations }), expectedConfig: sanitizeConfig(cfg),
    });
    expect(gate).toMatchObject({ ok: false, code: 'stale' });
  });
});


describe('canonical serializer boundary', () => {
  it('rejects cycles, sparse arrays and non-JSON values explicitly', () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => canonicalJson(cycle)).toThrow(/cycle/i);
    expect(() => canonicalJson(new Array(2))).toThrow(/sparse/i);
    expect(() => canonicalJson({ fn: () => 1 })).toThrow(/does not accept/i);
    expect(() => canonicalJson({ when: new Date(0) })).toThrow(/plain JSON objects/i);
  });
  it('preserves null, omitted properties, string escaping and full number round-trips', () => {
    expect(canonicalJson({ b: null, a: undefined })).toBe('{"b":null}');
    expect(canonicalJson('a"\n')).toBe(JSON.stringify('a"\n'));
    const x = 1.2345678901234567;
    expect(JSON.parse(canonicalJson({ x })).x).toBe(x);
    expect(canonicalJson(-0)).toBe('0');
  });
});
