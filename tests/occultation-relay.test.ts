import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, evaluateAt, simulateMission } from '../src/engine/simulation';
import { computeEphemeris } from '../src/engine/ephemeris';
import { bodyOccultation, earthAngularRadiusDeg, lunarLimb, raySphereOcclusion, sunAngularRadiusDeg } from '../src/engine/occultation';
import { collinearL2Gamma, evaluateRelay, relayPosition, RELAY_DISCLAIMER } from '../src/engine/relay';
import { v3 } from '../src/engine/vectors';
import { siteById } from '../src/data/landingSites';
import { DAY_MS, MOON_RADIUS_KM } from '../src/engine/constants';

describe('spherical lunar-limb occultation', () => {
  it('uses the flat tangent at zero altitude and curvature dip above it', () => {
    expect(lunarLimb(MOON_RADIUS_KM).limbElevationDeg).toBeCloseTo(0, 10);
    const elevated = lunarLimb(MOON_RADIUS_KM + 1);
    expect(elevated.dipDeg).toBeGreaterThan(1.8);
    expect(elevated.dipDeg).toBeLessThan(2.0);
    expect(elevated.limbElevationDeg).toBeCloseTo(-elevated.dipDeg, 12);
    expect(elevated.datumClamped).toBe(false);
  });

  it('keeps below-datum sites finite and explicitly reports the datum clamp', () => {
    const limb = lunarLimb(MOON_RADIUS_KM - 5.9);
    expect(limb.datumClamped).toBe(true);
    expect(Number.isFinite(limb.limbElevationDeg)).toBe(true);
    expect(limb.dipDeg).toBe(0);
  });

  it('classifies point and finite-disk occultation at the lunar limb', () => {
    const limb = lunarLimb(MOON_RADIUS_KM);
    expect(bodyOccultation(limb, 10, 0).state).toBe('clear');
    expect(bodyOccultation(limb, -10, 0).state).toBe('occulted');
    expect(bodyOccultation(limb, 0, 1).state).toBe('partial');
    expect(bodyOccultation(limb, 0, 1).occultedFraction).toBeGreaterThan(0.45);
    expect(bodyOccultation(limb, 0, 1).occultedFraction).toBeLessThan(0.55);
    expect(bodyOccultation(limb, 2, 1).occultedFraction).toBe(0);
    expect(bodyOccultation(limb, -2, 1).occultedFraction).toBe(1);
    expect(bodyOccultation(limb, 0.5, 1).occultedFraction).toBeLessThan(bodyOccultation(limb, -0.5, 1).occultedFraction);
    expect(sunAngularRadiusDeg(149_597_870)).toBeGreaterThan(0.25);
    expect(sunAngularRadiusDeg(149_597_870)).toBeLessThan(0.28);
    expect(earthAngularRadiusDeg(384_400)).toBeGreaterThan(0.9);
    expect(earthAngularRadiusDeg(384_400)).toBeLessThan(1.0);
  });

  it('distinguishes an unobstructed outward segment from a chord through the Moon', () => {
    const r = MOON_RADIUS_KM + 10;
    const site = v3(r, 0, 0);
    expect(raySphereOcclusion(site, v3(r + 100, 0, 0)).occluded).toBe(false);
    const crossing = raySphereOcclusion(site, v3(-r, 0, 0));
    expect(crossing.occluded).toBe(true);
    expect(crossing.clearanceKm).toBeLessThan(0);
  });

  it('places far-side Earth behind the lunar body, independently of terrain', () => {
    const site = siteById('change-4')!;
    const sample = evaluateAt(site, Date.parse('2026-12-18T00:00:00Z'), DEFAULT_CONFIG);
    expect(sample.earth.elevationDeg).toBeLessThan(-10);
    expect(sample.earthVisibility.bodyOccultation).toBe('occulted');
    expect(sample.earthVisibility.visible).toBe(false);
    expect(sample.earthVisibility.obstructionSource).toBe('lunar-limb');
    expect(sample.earthVisibility.geometricVisible).toBe(false);
  });

  it('keeps relay body and local-terrain legs separate and never claims RF', () => {
    const site = siteById('change-4')!;
    const sample = evaluateAt(site, Date.parse('2026-12-18T00:00:00Z'), {
      ...DEFAULT_CONFIG,
      relay: { id: 'test-relay', name: 'Test relay', model: 'circular-lunar', altitudeKm: 100, inclinationDeg: 90, raanDeg: 0, phaseDeg: 0 },
    });
    expect(sample.earthVisibility.visible).toBe(false);
    expect(sample.relay).toBeTruthy();
    expect(typeof sample.relay!.siteBodyClear).toBe('boolean');
    expect(typeof sample.relay!.siteTerrainClear).toBe('boolean');
    expect(typeof sample.relay!.earthClear).toBe('boolean');
    expect(sample.relay!.rangeKm).toBeGreaterThan(0);
    expect(RELAY_DISCLAIMER).toMatch(/NOT an RF link/i);
  });

  it('produces UTC illumination windows and keeps relay geometry separate from direct Earth LOS', () => {
    const site = siteById('change-4')!;
    const start = Date.parse('2026-12-18T00:00:00Z');
    const result = simulateMission(site, start, start + 2 * DAY_MS, {
      ...DEFAULT_CONFIG,
      durationDays: 2,
      stepMinutes: 240,
      relay: { id: 'relay-test', name: 'Test relay proxy', model: 'circular-lunar', altitudeKm: 100, inclinationDeg: 90, raanDeg: 0, phaseDeg: 0 },
    });
    expect(result.summary).not.toBeNull();
    expect(result.summary!.dtePct).toBe(0);
    expect(result.summary!.earthNeverVisible).toBe(true);
    expect(result.summary!.relay).not.toBeNull();
    expect(result.summary!.relay!.note).toMatch(/NOT an RF link/i);
    expect(result.summary!.sunlitHours! + result.summary!.darkHours!).toBeCloseTo(result.summary!.durationHours, 4);
    expect(result.summary!.windows!.sun.every((w) => w.startMs < w.endMs && w.startMs >= start)).toBe(true);
    expect(result.summary!.windows!.earth).toEqual([]);
  });

  it('solves the circular restricted three-body L2 distance instead of assuming a coordinate', () => {
    expect(collinearL2Gamma()).toBeGreaterThan(0.16);
    expect(collinearL2Gamma()).toBeLessThan(0.18);
  });

  it('propagates a relay state deterministically and preserves the configured model', () => {
    const site = siteById('apollo-11')!;
    const time = Date.parse('2026-12-18T00:00:00Z');
    const eph = evaluateAt(site, time, DEFAULT_CONFIG);
    // `evaluateAt` exposes the same sampled state through the relay when enabled.
    const relay = { id: 'l2', name: 'L2 proxy', model: 'earth-moon-l2-halo' as const, haloAmplitudeKm: 12_000, haloPeriodDays: 14, epochMs: time };
    const geom = computeEphemeris(site, time).geometry;
    const a = relayPosition(relay, geom, time);
    const b = relayPosition(relay, geom, time);
    expect(a).toEqual(b);
    expect(a.altitudeKm).toBeGreaterThan(40_000);
    expect(eph.earth.distanceKm).toBeGreaterThan(300_000);
  });
});

