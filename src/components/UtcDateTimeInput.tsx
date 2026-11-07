import { useEffect, useId, useState } from 'react';
import { parseUtcDateTime, utcDatePart, utcTimePart } from '../utils/utc';

interface Props {
  valueMs: number;
  onChange: (ms: number) => void;
  /** Optional id for the date field (e.g. a workflow focus target). */
  id?: string;
  /** Accessible-name prefix, e.g. "Mission start" or "Scenario start". */
  ariaPrefix?: string;
}

/**
 * Mission start expressed as explicit UTC calendar date + clock time. Uses separate
 * `date` and `time` fields (no timezone-converting `datetime-local` picker) and parses
 * them as UTC, so the entered wall-clock value is the same instant in every timezone.
 * Invalid or cleared input reverts to the last valid value on blur and explains why.
 */
export function UtcDateTimeInput({ valueMs, onChange, id, ariaPrefix = 'Mission start' }: Props) {
  const autoId = useId();
  const dateId = id ?? `utc-date-${autoId}`;
  const timeId = `utc-time-${autoId}`;
  const errId = `utc-err-${autoId}`;
  const [dateDraft, setDateDraft] = useState(() => utcDatePart(valueMs));
  const [timeDraft, setTimeDraft] = useState(() => utcTimePart(valueMs));
  const [error, setError] = useState<string | null>(null);

  // Keep drafts in sync when the instant changes elsewhere (scenario load, slip reset…).
  useEffect(() => {
    setDateDraft(utcDatePart(valueMs));
    setTimeDraft(utcTimePart(valueMs));
    setError(null);
  }, [valueMs]);

  const commit = (d: string, t: string) => {
    if (!d || !t) return; // wait until both parts are present
    const ms = parseUtcDateTime(d, t);
    if (ms == null) {
      setError('Enter a valid UTC date (YYYY-MM-DD) and time (HH:MM, 24-hour).');
      return;
    }
    setError(null);
    if (ms !== valueMs) onChange(ms);
  };

  const revert = () => {
    setDateDraft(utcDatePart(valueMs));
    setTimeDraft(utcTimePart(valueMs));
    setError(null);
  };

  const fieldStyle: React.CSSProperties = { height: 22, fontSize: 11 };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <label htmlFor={dateId} className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>Start (UTC)</label>
      <input
        id={dateId} type="date" className="input" style={{ ...fieldStyle, width: 130 }}
        value={dateDraft} aria-label={`${ariaPrefix} date (UTC)`} aria-describedby={error ? errId : undefined}
        aria-invalid={error ? true : undefined}
        onChange={(e) => { const v = e.target.value; setDateDraft(v); commit(v, timeDraft); }}
        onBlur={() => { if (!dateDraft || error) revert(); }}
      />
      <input
        id={timeId} type="time" className="input" style={{ ...fieldStyle, width: 92 }} step={60}
        value={timeDraft} aria-label={`${ariaPrefix} time (UTC)`} aria-describedby={error ? errId : undefined}
        aria-invalid={error ? true : undefined}
        onChange={(e) => { const v = e.target.value; setTimeDraft(v); commit(dateDraft, v); }}
        onBlur={() => { if (!timeDraft || error) revert(); }}
      />
      <span className="mono" style={{ fontSize: 9, letterSpacing: '.1em', color: 'var(--brass)' }} title="Coordinated Universal Time — not your local timezone">UTC</span>
      {error && <span id={errId} role="alert" style={{ fontSize: 10, color: 'var(--blocked)', flexBasis: '100%' }}>{error}</span>}
    </span>
  );
}
