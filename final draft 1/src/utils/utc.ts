// Explicit UTC date/time helpers.
//
// The mission planner stores epoch milliseconds (an absolute instant, UTC). These
// helpers convert between epoch ms and SEPARATE UTC calendar-date / clock-time strings
// with no local-timezone interpretation, so the same entered date+time means the same
// instant in every browser timezone. This replaces a `datetime-local` control, whose
// picker silently operates in the viewer's local zone and invites ambiguity.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** UTC calendar date (YYYY-MM-DD) for an instant. */
export function utcDatePart(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** UTC clock time (HH:MM) for an instant. */
export function utcTimePart(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16);
}

/**
 * Parse a UTC calendar date + clock time into epoch ms, or null if invalid.
 * Always interpreted as UTC (explicit `Z`), never local time. Rejects malformed
 * strings, out-of-range hours/minutes, and rolled-over calendar dates (e.g. Feb 30).
 */
export function parseUtcDateTime(date: string, time: string): number | null {
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) return null;
  const [h, m] = time.split(':').map(Number);
  if (h > 23 || m > 59) return null;
  const ms = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(ms)) return null;
  // Guard against calendar rollover (some engines normalize 2027-02-30 → Mar 02).
  if (new Date(ms).toISOString().slice(0, 10) !== date) return null;
  return ms;
}

/** Human-readable UTC stamp for labels, e.g. "2027-03-01 00:00 UTC". */
export function formatUtcStamp(ms: number): string {
  return `${utcDatePart(ms)} ${utcTimePart(ms)} UTC`;
}
