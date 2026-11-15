import { describe, expect, it } from 'vitest';
import recorded from '../src/verification/recordedHorizons.json';
import {
  VERIFY_TOLERANCE, VerificationError, assertComparable, buildVerifyRequest, compareWithHorizons, horizonsSiteFor,
  type HorizonsTarget,
} from '../src/verification/horizons';
import { convertSite } from '../src/engine/lunarFrame';
import { LANDING_SITES } from '../src/data/landingSites';

const shackleton = LANDING_SITES.find((s) => s.id === 'shackleton-rim')!;
const tables = recorded.targets as unknown as Record<'sun' | 'earth', HorizonsTarget>;

describe('IAU 2015 → MEAN_ME site conversion for Horizons', () => {
  it('reproduces the site the recorded Horizons query used', () => {
    expect(recorded.site.chandra_site_id).toBe('shackleton-rim');
    expect(shackleton.latitude).toBe(recorded.site.iau_latitude_deg);
    expect(shackleton.longitude).toBe(recorded.site.iau_east_longitude_deg);
    const h = horizonsSiteFor(shackleton);
    expect(h.latitude_deg).toBeCloseTo(recorded.site.latitude_deg, 6);
    expect(h.east_longitude_deg).toBeCloseTo(recorded.site.east_longitude_deg, 6);
    expect(h.altitude_km).toBeCloseTo(recorded.site.altitude_km, 9);
  });

  it('is the exact inverse of the SPICE-verified ME → IAU conversion', () => {
    for (const s of [{ latitude: -89.9, longitude: 0 }, { latitude: -85.3, longitude: 211.5 }, { latitude: 12, longitude: 300 }, { latitude: 88.7, longitude: 45 }]) {
      const h = horizonsSiteFor({ ...s, elevationM: 0 });
      const back = convertSite(h.latitude_deg, h.east_longitude_deg, 'me');
      expect(back.latitude).toBeCloseTo(s.latitude, 8);
      expect(Math.cos(((back.longitude - s.longitude) * Math.PI) / 180)).toBeCloseTo(1, 12);
      expect(back.azimuthOffsetDeg).toBeCloseTo(-h.azimuthOffsetDeg, 6);
    }
  });
});

describe('CHANDRA ephemeris versus recorded NASA/JPL Horizons (DE441, MEAN_ME, airless)', () => {
  it('uses real recorded service output with the conventions the comparison assumes', () => {
    for (const t of ['sun', 'earth'] as const) {
      expect(tables[t].ephemeris_source).toBe('DE441');
      expect(tables[t].center_frame).toMatch(/MEAN_ME/);
      expect(tables[t].atmospheric_refraction).toMatch(/NO \(AIRLESS\)/);
      expect(tables[t].center_radii_km[0]).toBeCloseTo(1737.4, 6);
      expect(tables[t].rows.length).toBe(42);
    }
  });

  it('agrees on Sun direction over 21 days at Shackleton rim', () => {
    const c = compareWithHorizons(shackleton, 'sun', tables.sun);
    expect(c.rows).toHaveLength(42);
    expect(c.verdict).toBe('agree');
    expect(c.maxAbsElevationDeg).toBeLessThan(0.002);
    expect(c.maxSeparationDeg).toBeLessThan(0.01);
    expect(c.maxSeparationDeg).toBeLessThan(VERIFY_TOLERANCE.separationDeg);
    // Range is informational (it never enters a visibility decision): |Δ| stays below 1,000 km of ~147 million.
    expect(c.maxAbsRangeKm).toBeLessThan(1000);
    expect(c.maxRelativeRange).toBeLessThan(1e-5);
  });

  it('agrees on Earth direction, and quantifies the Earth-range difference of the truncated lunar theory', () => {
    const c = compareWithHorizons(shackleton, 'earth', tables.earth);
    expect(c.verdict).toBe('agree');
    expect(c.maxAbsElevationDeg).toBeLessThan(0.003);
    expect(c.maxSeparationDeg).toBeLessThan(0.004);
    // astronomy-engine's analytic Moon is tens of km from DE441 in range (≈0.012 %); disclosed, not hidden.
    expect(c.maxAbsRangeKm).toBeGreaterThan(20);
    expect(c.maxAbsRangeKm).toBeLessThan(60);
    expect(c.maxRelativeRange).toBeLessThan(2e-4);
  });

  it('is sensitive: ignoring the frame offset or moving the site is detected', () => {
    // Treat Horizons' MEAN_ME azimuths as if they were IAU azimuths (the silent frame mix this workspace must prevent).
    const offset = horizonsSiteFor(shackleton).azimuthOffsetDeg;
    expect(Math.abs(offset)).toBeGreaterThan(0.5);
    const mixed: HorizonsTarget = { ...tables.sun, rows: tables.sun.rows.map((r) => ({ ...r, azimuth_deg: r.azimuth_deg + offset })) };
    const bad = compareWithHorizons(shackleton, 'sun', mixed);
    expect(bad.verdict).toBe('disagree');
    expect(bad.maxSeparationDeg).toBeGreaterThan(0.5);
    // A table for a different site is refused outright rather than compared.
    const elsewhere = { ...shackleton, latitude: -89.0 };
    expect(() => compareWithHorizons(elsewhere, 'sun', tables.sun)).toThrow(VerificationError);
  });

  it('refuses tables that do not answer the question asked', () => {
    const site = horizonsSiteFor(shackleton);
    expect(() => assertComparable(tables.sun, 'earth', site)).toThrow(/body/);
    expect(() => assertComparable({ ...tables.sun, center_frame: 'IAU_MOON' }, 'sun', site)).toThrow(/MEAN_ME/);
    expect(() => assertComparable({ ...tables.sun, atmospheric_refraction: 'YES (EARTH REFRACTION MODEL)' }, 'sun', site)).toThrow(/refraction/);
    expect(() => assertComparable({ ...tables.sun, rows: [] }, 'sun', site)).toThrow(/no ephemeris rows/);
    expect(() => assertComparable({ ...tables.sun, rows: [{ utc: 'nonsense', azimuth_deg: 1, elevation_deg: 1, range_km: 1 }] }, 'sun', site)).toThrow(/malformed/);
    expect(() => assertComparable(tables.sun, 'sun', site)).not.toThrow();
  });
});

describe('verify request builder', () => {
  it('sends a MOON_ME site, whole-minute UTC start and bounded sampling', () => {
    const req = buildVerifyRequest(shackleton, Date.UTC(2026, 11, 1, 0, 0, 37), 720, 42);
    expect(req.site.frame).toBe('MOON_ME');
    expect(req.site.latitude_deg).toBeCloseTo(-89.900807, 6);
    expect(req.site.east_longitude_deg).toBeCloseTo(359.450513, 6);
    expect(req.site.altitude_km).toBe(-1.2);
    expect(req.start_utc).toBe('2026-12-01T00:00:00Z');
    expect(req.targets).toEqual(['sun', 'earth']);
  });

  it('rejects unusable input before any network call', () => {
    expect(() => buildVerifyRequest(shackleton, NaN, 60, 10)).toThrow(VerificationError);
    expect(() => buildVerifyRequest(shackleton, 0, 0, 10)).toThrow(/Step/);
    expect(() => buildVerifyRequest(shackleton, 0, 60, 401)).toThrow(/Samples/);
    expect(() => buildVerifyRequest(shackleton, 0, 60, 1)).toThrow(/Samples/);
    expect(() => buildVerifyRequest({ latitude: 95, longitude: 0, elevationM: 0 }, 0, 60, 10)).toThrow(/Site/);
  });
});
