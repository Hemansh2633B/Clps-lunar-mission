import { useId, useState } from 'react';
import { Info } from 'lucide-react';
import { GLOSSARY_BY_ID } from '../data/glossary';

interface Props {
  /** Glossary entry id, or supply `text` for a custom one-off explanation. */
  id?: string;
  text?: string;
  label?: string;
}

/**
 * Accessible contextual help: a small info affordance that reveals a plain-language
 * explanation (plus the technical definition for glossary terms) on hover, keyboard
 * focus, or click/tap. The trigger is a real button with an accessible name, and the
 * popup is a role=tooltip referenced by aria-describedby.
 */
export function InfoTip({ id, text, label }: Props) {
  const entry = id ? GLOSSARY_BY_ID[id] : undefined;
  const tipId = useId();
  const [show, setShow] = useState(false);
  const plain = text ?? entry?.plain ?? '';
  const name = label ?? entry?.term ?? 'More information';
  if (!plain) return null;
  return (
    <span style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}>
      <button
        type="button"
        aria-label={`About ${name}`}
        aria-describedby={show ? tipId : undefined}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        onClick={() => setShow((s) => !s)}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', padding: 1, cursor: 'help', color: 'var(--dim)', lineHeight: 0 }}
      >
        <Info size={11} />
      </button>
      {show && (
        <span role="tooltip" id={tipId} style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', width: 230, maxWidth: '70vw', background: 'var(--paper-2)', border: '1px solid var(--ink)', boxShadow: '4px 4px 0 rgba(28,36,48,.18)', padding: '8px 10px', zIndex: 60, fontSize: 10.5, lineHeight: 1.5, color: 'var(--ink-soft)', textAlign: 'left', pointerEvents: 'none' }}>
          <strong style={{ display: 'block', fontSize: 10.5, color: 'var(--ink)', marginBottom: 3 }}>{name}{entry?.unit ? ` (${entry.unit})` : ''}</strong>
          {plain}
          {entry?.technical && <span style={{ display: 'block', marginTop: 5, paddingTop: 5, borderTop: '1px dashed var(--border)', fontSize: 9.5, color: 'var(--dim)' }}>{entry.technical}</span>}
        </span>
      )}
    </span>
  );
}
