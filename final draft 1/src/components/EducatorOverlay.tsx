import { useState } from 'react';
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

const FAQS: { q: string; a: string }[] = [
  { q: 'Is this flight software?', a: 'No. It is a planning-grade briefing desk. The Sun/Earth ephemeris and IAU 2015 Moon rotation are real, the illustrative benchmark masks are LOLA-style planning profiles, and nothing here is certified for a countdown.' },
  { q: 'Why do horizontal panels fail at 89°S?', a: 'Because the Sun stays within a couple of degrees of the horizon. A flat panel’s power follows the sine of that tiny elevation, so most of the solar constant glances off. A vertical mast facing the Sun follows the cosine, which is nearly 1.' },
  { q: 'What is optical libration doing to the radio?', a: 'It moves the sub-Earth point by several degrees in latitude and longitude. Near the pole, Earth lives on the horizon. A few degrees of wobble, plus a crater rim, is the difference between a Direct-to-Earth pass and a blackout.' },
  { q: 'How is this different from QuickMap and Horizons?', a: 'QuickMap is a map. Horizons is a sky. This desk asks the only question that joins them: at this latitude, this longitude, and this hour, is the Sun above my mask, and is Earth?' },
  { q: 'Why does a 14-day slip matter so much?', a: 'The Sun walks about half a degree of azimuth every hour. Fourteen days is most of the way around the crater. A stay planned for the lit arc can land inside a multi-day massif eclipse. The slip slider computes that, it does not illustrate it.' },
  { q: 'Does the far side ever see Earth in this model?', a: 'No. Chang’e-4 in Von Kármán sits on the far side. Earth remains tens of degrees below the geometric horizon for the whole synodic day. Terrain cannot save a radio pointed at rock. You need a relay.' },
  { q: 'Can I bring my own coordinates or DEM?', a: 'Yes. Drop a custom latitude/longitude, edit an 8-sector mask, or load a real single-band lunar GeoTIFF in the Terrain Lab. Real DEM horizons are preserved sample-for-sample and labeled with their source frame; synthetic demos stay labeled.' },
  { q: 'What does educator mode change?', a: 'Only the language. The elevations, watts, and blackouts stay. The captions stop saying MJD and start saying why a mast is standing in the dust.' },
];

export function EducatorOverlay({ open, onClose, active, step, onStart, onStep, onApply }: Props) {
  const [faqOpen, setFaqOpen] = useState<number | null>(0);
  if (!open) return null;
  return (
    <div className="drawer fade-in">
      <div className="modal-header">
        <span className="panel-title"><BookOpen size={13} /> Field guide · folio 04</span>
        <button className="btn sm ghost icon" onClick={onClose} aria-label="Close field guide"><X size={13} /></button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <figure style={{ margin: 0 }}>
          <div style={{ border: '8px solid #fff', boxShadow: '6px 8px 0 rgba(28,36,48,.08)', overflow: 'hidden' }}>
            <img src="/assets/hero-lunar.jpg" alt="Vintage illustration of a lander on a lunar ridge with Earth low on the horizon" style={{ width: '100%', display: 'block' }} />
          </div>
          <figcaption className="hint" style={{ marginTop: 8 }}>PLATE 01 · RIM STUDY · GRAZING SUNLIGHT, LOW EARTH</figcaption>
        </figure>

        <div className="plate" style={{ padding: 14 }}>
          <span className="stamp coral" style={{ transform: 'rotate(-1deg)' }}>THE 1.54° PROBLEM</span>
          <h3 className="display" style={{ fontSize: 21, lineHeight: 1.12, margin: '10px 0 8px' }}>At 89° South, a 48-hour launch slip can freeze your lander in <em style={{ color: 'var(--coral)' }}>permanent shadow.</em></h3>
          <p className="small" style={{ margin: 0 }}>South-pole mission design is a slow argument between a 1.54° tilt, a wobbling Earth, and the day you actually launch. This desk keeps both problems on one sheet of paper.</p>
        </div>

        {active ? (
          <div className="plate" style={{ padding: 12 }}>
            <div className="mono" style={{ fontSize: 10, color: 'var(--brass)', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>{active.kicker}</div>
            <div className="display" style={{ fontSize: 16, fontWeight: 600, margin: '4px 0 8px' }}>{active.title}</div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
              {active.steps.map((_, i) => <span key={i} style={{ flex: 1, height: 3, background: i <= step ? 'var(--emerald)' : 'var(--line)' }} />)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              <Lightbulb size={13} color="var(--brass)" /> Step {step + 1}: {active.steps[step].title}
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 12px' }}>{active.steps[step].body}</p>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn sm" disabled={step === 0} onClick={() => onStep(-1)}><ChevronLeft size={12} /> Back</button>
              <button className="btn sm primary" onClick={() => onApply(active)}><Play size={12} /> Apply scenario</button>
              <button className="btn sm" disabled={step >= active.steps.length - 1} onClick={() => onStep(1)}>Next <ChevronRight size={12} /></button>
            </div>
          </div>
        ) : (
          <p className="small" style={{ margin: 0 }}>
            Guided stories translate the telemetry into plain English. Pick a scenario to load the site, date and array configuration, then walk through the annotations.
          </p>
        )}

        <div>
          <div className="panel-title" style={{ marginBottom: 8 }}>Guided scenarios</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {GUIDED_SCENARIOS.map((s) => (
              <button key={s.id} className="plate" style={{ textAlign: 'left', padding: 10, borderColor: active?.id === s.id ? 'var(--emerald)' : 'var(--line)', background: active?.id === s.id ? '#e7f5ee' : 'var(--paper-2)' }} onClick={() => onStart(s)}>
                <div className="mono" style={{ fontSize: 9, color: 'var(--brass)', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600 }}>{s.kicker}</div>
                <div className="display" style={{ fontSize: 14, fontWeight: 600, margin: '3px 0' }}>{s.title}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>{s.description}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="panel-title" style={{ marginBottom: 8 }}>Two readers, one solver</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <figure style={{ margin: 0 }}>
              <div style={{ border: '6px solid #fff', boxShadow: '4px 5px 0 rgba(28,36,48,.07)', overflow: 'hidden' }}>
                <img src="/assets/ops-desk.jpg" alt="Flight ops desk with lunar charts" style={{ width: '100%', display: 'block', aspectRatio: '4/3', objectFit: 'cover' }} />
              </div>
              <figcaption className="hint" style={{ marginTop: 6 }}>FLIGHT OPS · THE MASK TABLE</figcaption>
            </figure>
            <figure style={{ margin: 0 }}>
              <div style={{ border: '6px solid #fff', boxShadow: '4px 5px 0 rgba(28,36,48,.07)', overflow: 'hidden' }}>
                <img src="/assets/classroom.jpg" alt="Educator and students around a lunar globe" style={{ width: '100%', display: 'block', aspectRatio: '4/3', objectFit: 'cover' }} />
              </div>
              <figcaption className="hint" style={{ marginTop: 6 }}>EDUCATOR · THE REASON</figcaption>
            </figure>
          </div>
          <p className="small" style={{ marginTop: 8, marginBottom: 0 }}>Flip the mode in the header. The arithmetic does not change — the sentence does. Engineers get the mask table; students get the reason the mast is standing up.</p>
        </div>

        <div>
          <div className="panel-title" style={{ marginBottom: 8 }}>Questions worth a straight answer</div>
          <div style={{ borderTop: '1px solid var(--line)' }}>
            {FAQS.map((item, i) => {
              const on = faqOpen === i;
              return (
                <div key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                  <button type="button" aria-expanded={on} onClick={() => setFaqOpen(on ? null : i)}
                    style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }}>
                    <span className="display" style={{ fontSize: 15, lineHeight: 1.2, color: 'var(--ink)' }}>{item.q}</span>
                    <span className="mono" style={{ color: 'var(--brass)' }}>{on ? '–' : '+'}</span>
                  </button>
                  {on && <p className="small" style={{ margin: '0 0 12px', maxWidth: 640 }}>{item.a}</p>}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="panel-title" style={{ marginBottom: 8 }}>Glossary</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {GLOSSARY.map((g) => (
              <div key={g.term} style={{ fontSize: 11, lineHeight: 1.5, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                <span className="mono" style={{ color: 'var(--earth)', fontWeight: 600 }}>{g.term}</span>
                <span style={{ color: 'var(--muted)' }}> — {g.definition}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="hint" style={{ margin: 0 }}>Planning-grade optical model. Benchmark masks are synthesized LOLA-style profiles, not a live PDS query. Not certified for flight.</p>
      </div>
    </div>
  );
}
