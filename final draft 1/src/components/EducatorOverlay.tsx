import { BookOpen, ChevronLeft, ChevronRight, Play, X, Lightbulb } from 'lucide-react';
import type { GuidedScenario } from '../types/mission';
import { GUIDED_SCENARIOS, GLOSSARY } from '../data/guidedScenarios';

interface Props {
  open: boolean;
  onClose: () => void;
  active: GuidedScenario | null;
  step: number;
  onStart: (s: GuidedScenario) => void;
  onStep: (delta: number) => void;
  onApply: (s: GuidedScenario) => void;
}

export function EducatorOverlay({ open, onClose, active, step, onStart, onStep, onApply }: Props) {
  if (!open) return null;
  return (
    <div className="drawer fade-in">
      <div className="modal-header">
        <span className="panel-title"><BookOpen size={13} /> Field guide · educator mode</span>
        <button className="btn sm ghost icon" onClick={onClose}><X size={13} /></button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {active ? (
          <div className="panel" style={{ padding: 12 }}>
            <div style={{ fontSize: 10, color: 'var(--solar)', letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600 }}>{active.kicker}</div>
            <div style={{ fontSize: 14, fontWeight: 600, margin: '4px 0 8px' }}>{active.title}</div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
              {active.steps.map((_, i) => <span key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? 'var(--nominal)' : '#232c38' }} />)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              <Lightbulb size={13} color="var(--solar)" /> Step {step + 1}: {active.steps[step].title}
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 12px' }}>{active.steps[step].body}</p>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn sm" disabled={step === 0} onClick={() => onStep(-1)}><ChevronLeft size={12} /> Back</button>
              <button className="btn sm primary" onClick={() => onApply(active)}><Play size={12} /> Apply scenario</button>
              <button className="btn sm" disabled={step >= active.steps.length - 1} onClick={() => onStep(1)}>Next <ChevronRight size={12} /></button>
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
            Guided stories translate the telemetry into plain English. Pick a scenario to load the site, date and array configuration, then walk through the annotations.
          </p>
        )}

        <div>
          <div className="panel-title" style={{ marginBottom: 8 }}>Guided scenarios</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {GUIDED_SCENARIOS.map((s) => (
              <button key={s.id} className="panel" style={{ textAlign: 'left', padding: 10, borderColor: active?.id === s.id ? '#1d5c41' : 'var(--border)', background: active?.id === s.id ? '#082018' : 'var(--panel-2)' }} onClick={() => onStart(s)}>
                <div style={{ fontSize: 9, color: 'var(--solar)', letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600 }}>{s.kicker}</div>
                <div style={{ fontSize: 12, fontWeight: 600, margin: '3px 0' }}>{s.title}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>{s.description}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="panel-title" style={{ marginBottom: 8 }}>Glossary</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {GLOSSARY.map((g) => (
              <div key={g.term} style={{ fontSize: 11, lineHeight: 1.5, padding: '6px 0', borderBottom: '1px solid #161c26' }}>
                <span className="mono" style={{ color: 'var(--earth)', fontWeight: 600 }}>{g.term}</span>
                <span style={{ color: 'var(--muted)' }}> — {g.definition}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
