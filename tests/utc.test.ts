import { describe, it, expect, afterEach } from 'vitest';
import { parseUtcDateTime, utcDatePart, utcTimePart, formatUtcStamp } from '../src/utils/utc';

describe('UTC date/time parsing is timezone-independent', () => {
  const originalTZ = process.env.TZ;
  afterEach(() => { process.env.TZ = originalTZ; });

  it('parses a UTC date+time to the correct absolute instant', () => {
    expect(parseUtcDateTime('2027-03-01', '00:00')).toBe(Date.parse('2027-03-01T00:00:00Z'));
    expect(parseUtcDateTime('2026-12-18', '08:30')).toBe(Date.parse('2026-12-18T08:30:00Z'));
  });

  it('returns the same instant regardless of the process local timezone', () => {
    const expected = Date.parse('2027-03-01T00:00:00Z');
    for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo', 'Asia/Kolkata', 'Pacific/Auckland', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      expect(parseUtcDateTime('2027-03-01', '00:00'), `tz=${tz}`).toBe(expected);
      expect(utcDatePart(expected), `tz=${tz}`).toBe('2027-03-01');
      expect(utcTimePart(expected), `tz=${tz}`).toBe('00:00');
    }
  });

  it('round-trips date+time parts across timezones', () => {
    const ms = Date.parse('2026-09-01T13:45:00Z');
    for (const tz of ['UTC', 'Asia/Kolkata', 'America/New_York']) {
      process.env.TZ = tz;
      expect(parseUtcDateTime(utcDatePart(ms), utcTimePart(ms)), `tz=${tz}`).toBe(ms);
    }
  });

  it('rejects malformed, out-of-range and rolled-over input', () => {
    expect(parseUtcDateTime('2027-02-30', '00:00')).toBeNull(); // rolled-over calendar date
    expect(parseUtcDateTime('2027-13-01', '00:00')).toBeNull(); // invalid month
    expect(parseUtcDateTime('2027-03-01', '24:00')).toBeNull(); // hour out of range
    expect(parseUtcDateTime('2027-03-01', '12:60')).toBeNull(); // minute out of range
    expect(parseUtcDateTime('not-a-date', '00:00')).toBeNull();
    expect(parseUtcDateTime('2027-03-01', 'noon')).toBeNull();
    expect(parseUtcDateTime('', '')).toBeNull();
  });

  it('formats an explicit UTC stamp', () => {
    expect(formatUtcStamp(Date.parse('2027-03-01T00:00:00Z'))).toBe('2027-03-01 00:00 UTC');
  });
});
