import { useEffect, useId, useState } from 'react';
import { MISSION_LIMITS, type NumericConfigKey } from '../engine/configLimits';

interface Props {
  field: NumericConfigKey;
  value: number;
  onChange: (value: number) => void;
}

/**
 * A numeric mission-parameter input with a valid min/max/step, unit, default and an
 * actionable validation message. Invalid or cleared input is NEVER propagated to the
 * calculation: onChange fires only for finite, in-range values; on blur an invalid
 * entry reverts to the last valid value. The engine also sanitizes defensively.
 */
export function NumberField({ field, value, onChange }: Props) {
  const lim = MISSION_LIMITS[field];
  const id = useId();
  const helpId = `${id}-help`;
  const errId = `${id}-err`;
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);

  const parsed = Number(text);
  const isEmpty = text.trim() === '';
  const invalid = isEmpty || !Number.isFinite(parsed) || parsed < lim.min || parsed > lim.max;
  const message = isEmpty
    ? `${lim.label} is required (${lim.min}–${lim.max} ${lim.unit}).`
    : !Number.isFinite(parsed)
      ? `${lim.label} must be a number.`
      : `${lim.label} must be between ${lim.min} and ${lim.max} ${lim.unit}.`;

  return (
    <div className="field">
      <label htmlFor={id} title={lim.help}>{lim.label} <span style={{ color: 'var(--dim)', fontWeight: 400 }}>({lim.unit})</span></label>
      <input
        id={id} className="input mono" type="number" inputMode="decimal"
        min={lim.min} max={lim.max} step={lim.step}
        value={text}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${errId} ${helpId}` : helpId}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          const n = Number(raw);
          if (raw.trim() !== '' && Number.isFinite(n) && n >= lim.min && n <= lim.max) onChange(n);
        }}
        onBlur={() => { if (invalid) setText(String(value)); }}
      />
      <span id={helpId} style={{ fontSize: 9, color: 'var(--dim)', lineHeight: 1.35, marginTop: 2 }}>{lim.help}</span>
      {invalid && <span id={errId} role="alert" style={{ fontSize: 9.5, color: 'var(--blocked)', lineHeight: 1.35, marginTop: 2 }}>{message}</span>}
    </div>
  );
}
