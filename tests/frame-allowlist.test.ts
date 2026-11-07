/**
 * Strict supported-frame allowlist + transformation-epoch validation.
 * A frame must match an explicit validated realization exactly — never a substring.
 * Unknown realizations and substring traps are rejected; the constant correction is
 * only quantitative inside its SPICE-validated interval (2020–2035).
 */
import { describe, expect, it } from 'vitest';
import {
  classifyFrame, frameEpochInRange, frameIntervalValidated,
  FRAME_VALIDATED_START_MS, FRAME_VALIDATED_END_MS,
} from '../src/engine/lunarFrame';

describe('explicit frame allowlist', () => {
  it.each([
    ['MOON_ME', 'me'],
    ['MOON_ME_DE421', 'me'],
    ['MOON_ME (JPL DE421)', 'me'],
    ['MOON_ME (DE421) — third-party 512px verification downsample; gap-filled; NOT flight data', 'me'],
    ['MOON_PA', 'pa'],
    ['MOON_PA (JPL DE421)', 'pa'],
    ['IAU_MOON', 'iau'],
    ['IAU 2015 Moon', 'iau'],
  ])('recognizes validated realization %s', (frame, transform) => {
    const c = classifyFrame(frame);
    expect(c.recognized).toBe(true);
    expect(c.transform).toBe(transform);
    expect(c.identifier).toBeTruthy();
  });

  it.each([
    'MOON_ME_DE440',          // different ephemeris realization — not validated
    'MOON_PA_DE440',
    'NOT_MOON_ME',            // substring trap
    'WEIRD_IAU_FRAME',        // substring trap
    'MOONMEME',               // not an exact identifier
    'SOME_UNKNOWN_FRAME',
    'MysteryFrame',
    '',
    undefined,
  ])('rejects unfamiliar frame %s', (frame) => {
    const c = classifyFrame(frame);
    expect(c.recognized).toBe(false);
    expect(c.transform).toBeNull();
    expect(c.note.toLowerCase()).toContain('allowlist');
  });

  it('records the validated realization for exports', () => {
    expect(classifyFrame('MOON_ME (JPL DE421)').realization).toBe('DE421');
    expect(classifyFrame('IAU_MOON').realization).toBe('IAU 2015');
    expect(classifyFrame('MOON_ME_DE440').realization).toBeNull();
  });
});

describe('frame-correction epoch validation', () => {
  it('accepts dates inside the validated 2020–2035 interval', () => {
    expect(frameEpochInRange(Date.parse('2027-03-01T00:00:00Z'))).toBe(true);
    expect(frameIntervalValidated(Date.parse('2026-12-18T00:00:00Z'), Date.parse('2027-01-17T00:00:00Z'))).toBe(true);
  });

  it('rejects dates outside the validated interval (never extrapolate silently)', () => {
    expect(frameEpochInRange(Date.parse('2019-12-31T00:00:00Z'))).toBe(false);
    expect(frameEpochInRange(Date.parse('2036-01-02T00:00:00Z'))).toBe(false);
    expect(frameEpochInRange(NaN)).toBe(false);
    // An interval that straddles the boundary is not fully validated.
    expect(frameIntervalValidated(FRAME_VALIDATED_END_MS - 1000, FRAME_VALIDATED_END_MS + 1000)).toBe(false);
    expect(frameIntervalValidated(FRAME_VALIDATED_START_MS - 1000, FRAME_VALIDATED_START_MS + 1000)).toBe(false);
  });
});
