import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, X, MapPin, CalendarClock, SlidersHorizontal, Activity, Columns2, Download } from 'lucide-react';
import { WORKFLOW_STEPS, clampWorkflowStep, isFirstWorkflowStep, isLastWorkflowStep, type WorkflowStepId } from '../utils/workflow';

interface Props {
  onClose: () => void;
  onAction: (id: WorkflowStepId) => void;
  context: {
    siteName: string;
    startUtc: string;
    presetName: string;
    verdict: string | null;
    scenarioCount: number;
    simReady: boolean;
    exportBlocked: boolean;
  };
}

const ICONS = [MapPin, CalendarClock, SlidersHorizontal, Activity, Columns2, Download];

/**
 * A guided six-step path through the mission workspace: region → UTC date → preset →
 * plain-language results → comparison → report. Each step performs the real app action
 * and advances; the user can move back/forward freely or dismiss it. It guides the actual
 * product rather than replacing it, and never hides the underlying controls.
 */
export function WorkflowGuide({ onClose, onAction, context }: Props) {
  const [step, setStep] = useState(0);
  const [doneIds, setDoneIds] = useState<WorkflowStepId[]>([]);
  const current = WORKFLOW_STEPS[step];
  const Icon = ICONS[step];
  const finished = doneIds.length === WORKFLOW_STEPS.length;

  const contextLine = (): string => {
    switch (current.id) {
      case 'region': return `Current region: ${context.siteName}`;
      case 'date': return `Mission start: ${context.startUtc}`;
      case 'preset': return `Active preset: ${context.presetName}`;
      case 'results': return context.simReady ? `Current verdict: ${context.verdict ?? '—'}` : 'Computing the mission window…';
      case 'compare': return `${context.scenarioCount} scenario${context.scenarioCount === 1 ? '' : 's'} pinned`;
      case 'report': return context.exportBlocked ? 'Export is blocked until the flagged analysis issue is resolved.' : 'A reproducible JSON report is ready to download.';
    }
  };

  const doAction = () => {
    onAction(current.id);
    setDoneIds((d) => (d.includes(current.id) ? d : [...d, current.id]));
    if (!isLastWorkflowStep(step)) setStep((s) => clampWorkflowStep(s + 1));
  };

  return (
    <section className="panel fade-in" aria-label="Guided mission workflow" style={{ flexShrink: 0, borderLeft: '3px solid var(--navy)' }}>
      <div className="panel-header">
        <span className="panel-title"><Icon size={13} /> Guided workflow · step {step + 1} of {WORKFLOW_STEPS.length}</span>
        <button className="btn sm ghost icon" onClick={onClose} aria-label="Close guided workflow"><X size={13} /></button>
      </div>
      <div style={{ padding: '10px 14px 12px' }}>
        {/* Stepper */}
        <ol style={{ display: 'flex', gap: 4, listStyle: 'none', margin: '0 0 12px', padding: 0, flexWrap: 'wrap' }}>
          {WORKFLOW_STEPS.map((s, i) => {
            const done = doneIds.includes(s.id);
            const active = i === step;
            return (
              <li key={s.id} style={{ flex: 1, minWidth: 90 }}>
                <button
                  onClick={() => setStep(i)} aria-current={active ? 'step' : undefined}
                  aria-label={`Step ${i + 1}: ${s.title}${done ? ' (done)' : ''}`}
                  style={{
                    width: '100%', textAlign: 'left', cursor: 'pointer', padding: '6px 8px',
                    border: `1px solid ${active ? 'var(--navy)' : 'var(--border)'}`,
                    background: active ? '#eef2f7' : done ? '#e7f5ee' : '#fffdf7',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span className="mono" style={{ fontSize: 10, width: 16, height: 16, display: 'grid', placeItems: 'center', borderRadius: '50%', background: done ? 'var(--nominal)' : active ? 'var(--navy)' : 'var(--dim)', color: '#fff', flexShrink: 0 }}>
                    {done ? <Check size={10} /> : i + 1}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: active ? 700 : 500, color: 'var(--ink-soft)', lineHeight: 1.2 }}>{s.title}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {/* Current step */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 14, fontFamily: 'Fraunces, serif' }}>{current.title}</h3>
            <p style={{ margin: '0 0 6px', fontSize: 12, lineHeight: 1.55, color: 'var(--ink-soft)' }}>{current.description}</p>
            <p className="mono" style={{ margin: 0, fontSize: 10.5, color: 'var(--brass)' }}>{contextLine()}</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <button className="btn sm" onClick={() => setStep((s) => clampWorkflowStep(s - 1))} disabled={isFirstWorkflowStep(step)}><ArrowLeft size={12} /> Back</button>
          <button className="btn sm primary" onClick={doAction}>
            {current.action} {isLastWorkflowStep(step) ? <Download size={12} /> : <ArrowRight size={12} />}
          </button>
          {!isLastWorkflowStep(step) && (
            <button className="btn sm ghost" onClick={() => setStep((s) => clampWorkflowStep(s + 1))}>Skip step</button>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--muted)' }}>
            {finished ? 'All six steps complete — explore freely or export your report.' : `${doneIds.length}/${WORKFLOW_STEPS.length} steps done`}
          </span>
        </div>
      </div>
    </section>
  );
}
