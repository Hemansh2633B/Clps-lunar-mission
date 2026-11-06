import { useEffect, useRef } from 'react';
import { FlaskConical, Mountain, X, MapPin, CalendarClock, SlidersHorizontal, Activity, Columns2, Download, ShieldAlert } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onDemo: () => void;
  onRealDem: () => void;
}

const STEPS = [
  { icon: MapPin, title: '1 · Select a region', body: 'Pick a landing region. Each shows its position, program, data confidence and terrain source.' },
  { icon: CalendarClock, title: '2 · Set a UTC date', body: 'Set a UTC start, duration and launch delay. All times are UTC — never your local timezone.' },
  { icon: SlidersHorizontal, title: '3 · Choose a preset', body: 'Start from an illustrative mission profile (or tune your own). Presets are teaching assumptions, not NASA specs.' },
  { icon: Activity, title: '4 · Read the results', body: 'Sunlight, Earth line-of-sight, power and battery — explained in plain language, with the numbers alongside.' },
  { icon: Columns2, title: '5 · Compare scenarios', body: 'Pin scenarios to compare sites, dates and presets. Incompatible data is flagged, never ranked together.' },
  { icon: Download, title: '6 · Export a report', body: 'Download a reproducible report with full provenance, sampling disclosure and analysis status.' },
];

/**
 * Short, dismissible first-run onboarding. Offers an explicit choice between a labeled
 * demo and configuring real DEM data — never silently substitutes synthetic for real.
 * Reopenable from Help. Not a mandatory tutorial: one screen, skippable.
 */
export function Onboarding({ open, onClose, onDemo, onRealDem }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const focusable = Array.from(ref.current.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')).filter((el) => !el.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); previous?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="onboarding-title" className="modal fade-in wide" style={{ outline: 'none', maxWidth: 720 }}>
        <div className="modal-header">
          <span id="onboarding-title" style={{ fontSize: 14, fontWeight: 600 }}>Welcome to CHANDRA // OPS</span>
          <button className="btn sm ghost icon" onClick={onClose} aria-label="Close welcome"><X size={14} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--ink-soft)' }}>
            CHANDRA is a lunar south-pole mission-planning desk. It computes <strong>when the Sun and Earth are visible</strong> from a
            landing site, <strong>how much solar power</strong> an array makes, and <strong>whether the battery holds up</strong> — using a real
            ephemeris and the terrain horizon. It is a planning and education tool, not a flight-certified analysis: every result is labeled
            with how trustworthy its underlying data is.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <button onClick={onDemo} className="onboard-choice" style={{ textAlign: 'left', border: '1px solid var(--solar)', background: '#fdf0d5', padding: 14, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, fontSize: 13, color: '#8a5a16' }}><FlaskConical size={16} /> Explore demo mode</span>
              <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>Jump straight into a working demonstration using <strong>explicitly labeled illustrative terrain</strong>. Best for students and a first look. Nothing here is measured flight data.</span>
            </button>
            <button onClick={onRealDem} className="onboard-choice" style={{ textAlign: 'left', border: '1px solid var(--earth)', background: '#e3f2f6', padding: 14, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, fontSize: 13, color: '#0e7490' }}><Mountain size={16} /> Analyze real DEM data</span>
              <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>Open Terrain Lab to configure a compatible lunar elevation dataset (projected GeoTIFF in MOON_ME / MOON_PA (DE421) or IAU 2015). If no real DEM is available, CHANDRA tells you — it never substitutes synthetic data silently.</span>
            </button>
          </div>

          <div>
            <div className="panel-title" style={{ marginBottom: 8 }}>How the workflow runs</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {STEPS.map((s) => (
                <div key={s.title} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', border: '1px solid var(--border)', background: '#fffdf7', padding: 9 }}>
                  <s.icon size={15} style={{ color: 'var(--navy)', flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 600 }}>{s.title}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.45, marginTop: 2 }}>{s.body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, border: '1px dashed var(--border)', padding: 9, background: '#fffdf7' }}>
            <ShieldAlert size={14} style={{ color: 'var(--solar)', flexShrink: 0, marginTop: 1 }} />
            <span><strong>Reading terrain warnings:</strong> a green <em>frame-verified</em> stamp means real DEM data aligned to the ephemeris frame; amber means illustrative or incomplete; red means the reference frame is unverified and quantitative results are blocked. The stamp always tells you what you can trust.</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>You can reopen this welcome anytime from <strong>Help</strong>.</span>
            <button className="btn" onClick={onClose}>Skip for now</button>
          </div>
        </div>
      </div>
    </div>
  );
}
