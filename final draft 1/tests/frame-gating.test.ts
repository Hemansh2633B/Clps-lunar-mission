/**
 * Frame compatibility gating at the terrain -> mission boundary: recognized frames
 * are rotated into the IAU 2015 ephemeris frame and disclosed; unknown frames are
 * marked FRAME UNVERIFIED and blocked from quantitative mission visibility (but
 * remain viewable). Synthetic demos stay labeled; incomplete/NoData masks block.
 */
import { describe, expect, it } from 'vitest';
import { terrainProfileFromHorizon, horizonImportBlocked } from '../src/terrain/missionProfile';
import { rotateMaskAzimuths, convertSite, classifyFrame } from '../src/engine/lunarFrame';
import { makeCustomSite } from '../src/data/landingSites';
import type { HorizonMask } from '../src/terrain/types';

function mask(over: Partial<HorizonMask> = {}, frame = 'MOON_ME (JPL DE421)', synthetic = false): HorizonMask {
  const step = 1;
  const n = 360 / step;
  const elevations = new Array(n).fill(0);
  return {
    latitude: -45, longitude: 0, radius_km: 5, horizon_radius_km: 4.9, edge_inset_m: 20,
    sampling_step_m: 40, grid_size: 257, grid_spacing_m: 40, eye_height_m: 2,
    azimuth_step_deg: step,
    azimuths_deg: Array.from({ length: n }, (_, i) => i * step),
    elevations_deg: elevations,
    ray_coverage_percent: new Array(n).fill(100),
    max_obstacle_range_km: new Array(n).fill(1),
    mean_coverage_percent: 100,
    synthetic,
    source: {
      filename: synthetic ? 'synthetic.tif' : 'LDEM_80S_20MPP_ADJ.TIF',
      lunar_radius_m: 1737400, elevation_reference_radius_m: 1737400,
      elevation_reference: '1737.4 km sphere', lunar_reference_frame: frame, synthetic,
    },
    model: 'ray-march', frame_note: '',
    ...over,
  };
}

describe('frame classification + rotation', () => {
  it('rotates an azimuth mask so a source-frame feature lands at source+offset', () => {
    const elev = new Array(360).fill(0);
    for (let a = 88; a <= 92; a++) elev[a] = 12; // flat-top feature centered due east
    const offset = 7.3;
    const out = rotateMaskAzimuths(elev, 1, offset);
    // Feature center should now sit near azimuth 90 + offset; flat top preserves height.
    let peakAz = 0, peakVal = -1;
    out.forEach((v, i) => { if (v > peakVal) { peakVal = v; peakAz = i; } });
    expect(Math.abs(peakAz - (90 + offset))).toBeLessThanOrEqual(1.5);
    expect(peakVal).toBeGreaterThan(11.5);
    // Zero offset is a no-op.
    expect(rotateMaskAzimuths(elev, 1, 0)).toEqual(elev);
  });

  it('ME mask is verified, rotated, and discloses a residual', () => {
    const m = mask({}, 'MOON_ME (JPL DE421)');
    const p = terrainProfileFromHorizon(m);
    expect(p.frameVerified).toBe(true);
    expect(p.frameTransform).toBe('me');
    expect(p.frameResidualDeg).toBeGreaterThan(0);
    expect(p.frameResidualDeg).toBeLessThan(0.005);
    const conv = convertSite(m.latitude, m.longitude, 'me');
    expect(p.azimuthOffsetDeg).toBeCloseTo(conv.azimuthOffsetDeg, 6);
    expect(horizonImportBlocked(m)).toBeNull();
  });

  it('IAU mask is verified with no rotation', () => {
    const p = terrainProfileFromHorizon(mask({}, 'IAU_MOON'));
    expect(p.frameVerified).toBe(true);
    expect(p.frameTransform).toBe('iau');
    expect(p.azimuthOffsetDeg).toBe(0);
  });

  it('unknown frame is FRAME UNVERIFIED and blocked from mission visibility', () => {
    const m = mask({}, 'SOME_UNKNOWN_FRAME');
    const p = terrainProfileFromHorizon(m);
    expect(p.frameVerified).toBe(false);
    expect(p.frameTransform).toBeNull();
    const block = horizonImportBlocked(m);
    expect(block).not.toBeNull();
    expect(block).toContain('FRAME UNVERIFIED');
  });

  it('synthetic demo is allowed but never frame-verified as real data', () => {
    const m = mask({}, 'SYNTHETIC', true);
    expect(horizonImportBlocked(m)).toBeNull();
    const p = terrainProfileFromHorizon(m);
    expect(p.synthetic).toBe(true);
    expect(p.frameNote).toContain('Synthetic');
  });

  it('incomplete coverage and NoData rays block import (never invent elevations)', () => {
    expect(horizonImportBlocked(mask({ mean_coverage_percent: 92 }))).toContain('incomplete');
    const nodata = mask();
    nodata.elevations_deg[10] = -90;
    expect(horizonImportBlocked(nodata)).toContain('no valid terrain');
  });
});

describe('custom site coordinate provenance', () => {
  it('converts a real ME site into the IAU frame and records the shift', () => {
    const m = mask({}, 'MOON_ME (JPL DE421)');
    const site = makeCustomSite({ name: 'Test', latitude: -45, longitude: 30, elevationM: 0, preset: 'flat', horizon: m });
    const conv = convertSite(-45, 30, 'me');
    expect(site.latitude).toBeCloseTo(conv.latitude, 6);
    expect(site.coordinateProvenance).toContain('Converted from');
    expect(site.coordinateProvenance).toContain('IAU 2015');
    expect(site.dataConfidence).toBe('measured');
    expect(site.terrain.frameVerified).toBe(true);
  });

  it('leaves an unknown-frame site uncorrected and labeled unverified', () => {
    const m = mask({}, 'WEIRD_FRAME');
    const site = makeCustomSite({ name: 'Test', latitude: -45, longitude: 30, elevationM: 0, preset: 'flat', horizon: m });
    expect(site.latitude).toBe(-45); // not corrected
    expect(site.coordinateProvenance).toContain('unverified');
    expect(site.terrain.frameVerified).toBe(false);
    expect(classifyFrame('WEIRD_FRAME').recognized).toBe(false);
  });

  it('an illustrative preset site is labeled illustrative, not measured', () => {
    const site = makeCustomSite({ name: 'Preset', latitude: -85, longitude: 0, elevationM: 0, preset: 'ridge' });
    expect(site.dataConfidence).toBe('illustrative');
    expect(site.terrain.kind).not.toBe('dem');
  });
});
