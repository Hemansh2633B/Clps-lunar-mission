import { describe, expect, it } from 'vitest';
import { computeEphemeris } from '../src/engine/ephemeris';
import { buildTerrainProfile, visibilityFor, refineCrossing } from '../src/engine/horizonPhysics';
import { computePower, simulateBattery } from '../src/engine/powerComms';
import { DEFAULT_CONFIG, evaluateAt, simulateMission } from '../src/engine/simulation';
import { LANDING_SITES, siteById } from '../src/data/landingSites';
import { DAY_MS, HOUR_MS } from '../src/engine/constants';
import { csvEscape } from '../src/utils/export';

const START = Date.parse('2026-12-18T00:00:00Z');
const cfg = { ...DEFAULT_CONFIG, stepMinutes: 60 };

describe('ephemeris sanity', () => {
  it('Apollo 11 sees a high Sun and high Earth', () => {
    const site = siteById('apollo-11')!;
    let peakSun = -90;
    let minEarth = 90;
    for (let d = 0; d < 30; d += 0.5) {
      const e = computeEphemeris(site, START + d * DAY_MS);
      peakSun = Math.max(peakSun, e.sun.elevationDeg);
      minEarth = Math.min(minEarth, e.earth.elevationDeg);
    }
    expect(peakSun).toBeGreaterThan(75);
    expect(minEarth).toBeGreaterThan(45);
  });

  it('Shackleton Rim has grazing Sun and low Earth', () => {
    const site = siteById('shackleton-rim')!;
    let peakSun = -90;
    let peakEarth = -90;
    for (let d = 0; d < 30; d += 0.5) {
      const e = computeEphemeris(site, START + d * DAY_MS);
      peakSun = Math.max(peakSun, e.sun.elevationDeg);
      peakEarth = Math.max(peakEarth, e.earth.elevationDeg);
    }
    expect(peakSun).toBeLessThan(4);
    expect(peakSun).toBeGreaterThan(0.5);
    expect(peakEarth).toBeLessThan(12);
  });

  it("Chang'e 4 never sees Earth", () => {
    const site = siteById('change-4')!;
    for (let d = 0; d < 30; d += 1) {
      const e = computeEphemeris(site, START + d * DAY_MS);
      expect(e.earth.elevationDeg).toBeLessThan(-30);
    }
  });

  it('libration sweeps several degrees over a draconic cycle', () => {
    const site = siteById('shackleton-rim')!;
    let minLat = 90, maxLat = -90, minLon = 90, maxLon = -90;
    for (let d = 0; d < 60; d += 0.25) {
      const e = computeEphemeris(site, START + d * DAY_MS);
      minLat = Math.min(minLat, e.libration.subEarthLatitudeDeg);
      maxLat = Math.max(maxLat, e.libration.subEarthLatitudeDeg);
      minLon = Math.min(minLon, e.libration.subEarthLongitudeDeg);
      maxLon = Math.max(maxLon, e.libration.subEarthLongitudeDeg);
    }
    expect(maxLat - minLat).toBeGreaterThan(9);
    expect(maxLon - minLon).toBeGreaterThan(11);
  });
});

describe('horizon physics', () => {
  it('terrain blocks an object that is geometrically above 0°', () => {
    const profile = buildTerrainProfile('test', [{ name: 'ridge', azimuthDeg: 180, elevationDeg: 5, widthDeg: 40, kind: 'massif' }]);
    const blocked = visibilityFor('sun', 2, 180, profile);
    expect(blocked.geometricVisible).toBe(true);
    expect(blocked.visible).toBe(false);
    expect(blocked.reason).toBe('terrain');
    const clear = visibilityFor('sun', 6, 180, profile);
    expect(clear.visible).toBe(true);
  });

  it('refines a crossing to sub-minute precision', () => {
    const site = siteById('apollo-11')!;
    const a = evaluateAt(site, START, cfg);
    let cross: number | null = null;
    for (let h = 1; h < 400; h++) {
      const b = evaluateAt(site, START + h * HOUR_MS, cfg);
      if (a.sunVisibility.visible !== b.sunVisibility.visible) {
        cross = refineCrossing(site, cfg, START + (h - 1) * HOUR_MS, START + h * HOUR_MS, 'sun', b.sunVisibility.visible);
        break;
      }
    }
    expect(cross).not.toBeNull();
    const at = evaluateAt(site, cross!, cfg);
    expect(Math.abs(at.sunVisibility.clearanceDeg)).toBeLessThan(0.01);
  });
});

describe('power and survival', () => {
  it('vertical mast outperforms horizontal deck at grazing Sun', () => {
    const vis = visibilityFor('sun', 1.5, 90, buildTerrainProfile('flat', [], -0.08, 0, 'flat'));
    const p = computePower(1.5, 90, 149_597_870, vis, DEFAULT_CONFIG);
    expect(p.verticalTrackingW).toBeGreaterThan(p.horizontalW * 10);
    expect(p.horizontalW).toBeGreaterThan(0);
  });

  it('battery depletes when load exceeds generation', () => {
    const site = siteById('shackleton-rim')!;
    const config = { ...DEFAULT_CONFIG, arrayMode: 'horizontal' as const, arrayAreaM2: 2, loadW: 400, batteryCapacityKWh: 5, stepMinutes: 60 };
    const sim = simulateMission(site, START, START + 5 * DAY_MS, config);
    expect(sim.summary.depletionHours).toBeGreaterThan(0);
    expect(sim.summary.verdict).toBe('SURVIVAL RISK');
  });
});

describe('mission simulation', () => {
  it('Apollo 11 shows the classic ~14 day day/night cycle', () => {
    const site = siteById('apollo-11')!;
    const sim = simulateMission(site, START, START + 30 * DAY_MS, cfg);
    expect(sim.summary.illuminationPct).toBeGreaterThan(40);
    expect(sim.summary.illuminationPct).toBeLessThan(60);
    expect(sim.summary.longestEclipseHours).toBeGreaterThan(300);
    expect(sim.summary.longestEclipseHours).toBeLessThan(400);
    expect(sim.summary.dtePct).toBe(100);
    expect(sim.summary.earthNeverVisible).toBe(false);
  });

  it("Chang'e 4 reports 0% DTE and relay required", () => {
    const site = siteById('change-4')!;
    const sim = simulateMission(site, START, START + 10 * DAY_MS, cfg);
    expect(sim.summary.dtePct).toBe(0);
    expect(sim.summary.earthNeverVisible).toBe(true);
    expect(sim.summary.verdict).toBe('RELAY REQUIRED');
  });

  it('catalog contains all required sites', () => {
    const ids = ['shackleton-rim', 'connecting-ridge', 'malapert-massif', 'leibnitz-beta', 'haworth-rim', 'nobile-rim-1', 'de-gerlache-rim-2', 'apollo-11', 'apollo-17', 'change-4'];
    for (const id of ids) expect(siteById(id)).toBeDefined();
    expect(LANDING_SITES.length).toBeGreaterThanOrEqual(10);
  });
});

describe('export', () => {
  it('escapes CSV fields', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('plain')).toBe('plain');
  });
});
