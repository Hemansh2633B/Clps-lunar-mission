/**
 * Small constants describing the recorded JPL Horizons reference, kept separate
 * from the (larger) recorded table so exports can cite it without bundling the
 * rows. tests/horizons-verification.test.ts asserts these match the JSON.
 */
export const RECORDED_HORIZONS = {
  recordedUtc: '2026-11-14',
  siteId: 'shackleton-rim',
  ephemeris: 'DE441',
  frame: 'MEAN_ME',
  firstUtc: '2026-12-01T00:00:00.000Z',
  lastUtc: '2026-12-21T12:00:00.000Z',
  samplesPerTarget: 42,
} as const;
