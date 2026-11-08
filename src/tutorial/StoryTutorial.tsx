/**
 * THE 14-DAY WINDOW — compact docked briefing panel + non-blocking spotlight.
 *
 * The panel narrates; the REAL app does the work. Every primary action drives an
 * existing control/handler, the spotlight only rings real `data-tour` elements
 * (pointer-events: none — it never traps clicks), and all numbers come from the
 * live narrative layer. Paper-folio identity: stamps, mission-log UTC, field-journal
 * dialogue cards. No chatbot chrome.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Compass, Pause, X } from 'lucide-react';
import { CHARACTERS, DEBRIEF, STORY_CHAPTERS, type DialogueLine } from './story';
import { chapterNarrative, type StoryWorld } from './narrative';
import type { StoryController } from './useStoryTutorial';
import { GLOSSARY_BY_ID } from '../data/glossary';
import { formatUtcStamp } from '../utils/utc';

function Dialogue({ line }: { line: DialogueLine }) {
  const c = CHARACTERS[line.speaker];
  return (
    <div className="story-line">
      <span className={`story-avatar ${line.speaker === 'MIRA' ? 'mira' : 'arin'}`} aria-hidden="true">{c.initial}</span>
      <div>
        <span className="story-speaker">{c.name}</span>
        <p>{line.text}</p>
      </div>
    </div>
  );
}

/** Non-blocking ring around a real control; scrolls it into view, never traps input. */
export function StorySpotlight({ targetKey }: { targetKey: string | null }) {
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const scrolledFor = useRef<string | null>(null);

  useEffect(() => {
    if (!targetKey) { setRect(null); scrolledFor.current = null; return; }
    let tries = 0;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${targetKey}"]`);
      if (!el) {
        setRect(null);
        return false;
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top - 5, left: r.left - 5, width: r.width + 10, height: r.height + 10 });
      if (scrolledFor.current !== targetKey) {
        scrolledFor.current = targetKey;
        const offscreen = r.top < 60 || r.bottom > window.innerHeight - 40;
        if (offscreen) {
          const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
        }
      }
      return true;
    };
    measure();
    // Lazy views / worker results can mount or resize the target after us.
    const poll = window.setInterval(() => { tries += 1; measure(); if (tries > 40) window.clearInterval(poll); }, 250);
    const quick = window.setInterval(measure, 1000);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => { window.clearInterval(poll); window.clearInterval(quick); window.removeEventListener('scroll', measure, true); window.removeEventListener('resize', measure); };
  }, [targetKey]);

  if (!targetKey || !rect) return null;
  return <div className="story-spotlight" aria-hidden="true" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />;
}

/** One-time, dismissible post-onboarding invitation (never shown to returning users). */
export function StorySuggestion({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  return (
    <div className="story-suggestion" role="region" aria-label="Interactive briefing suggestion">
      <span className="stamp brass" style={{ transform: 'rotate(-1.2deg)' }}>NEW · INTERACTIVE BRIEFING</span>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div className="display" style={{ fontSize: 15, fontWeight: 600 }}>THE 14-DAY WINDOW</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          Join Mira’s fictional mission team as the new analyst: a launch slips two weeks, and you file the planning report. 10–15 minutes, real controls, live numbers.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="btn sm primary" onClick={onStart}>Start the briefing</button>
        <button className="btn sm ghost" onClick={onDismiss}>Not now</button>
      </div>
    </div>
  );
}

interface PanelProps {
  controller: StoryController;
  world: StoryWorld;
  timeMs: number;
}

export function StoryTutorial({ controller, world, timeMs }: PanelProps) {
  const { chapter, progress, debrief } = controller;
  const [collapsed, setCollapsed] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const narrative = chapterNarrative(chapter.id, world);
  const chosen = progress?.answers[chapter.id];
  const checkUnlocked = controller.objectiveMet || chapter.completion === 'read-telemetry' || chosen !== undefined;

  // Move focus to the panel heading on chapter transitions (keyboard + screen readers).
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    setCollapsed(false);
  }, [chapter.id, debrief]);

  if (!controller.active || !progress) return null;

  return (
    <>
      <StorySpotlight targetKey={debrief || collapsed || controller.recoveryNeeded ? null : chapter.target} />
      <section className={`story-panel ${collapsed ? 'collapsed' : ''}`} role="region" aria-label="The 14-day window — interactive mission briefing">
        <div aria-live="polite" className="sr-only">
          {debrief ? 'Briefing complete. Debrief available.'
            : controller.recoveryNeeded ? 'Training context unavailable. Rebuild the training mission or exit the briefing.'
            : `Chapter ${chapter.id} of 8: ${chapter.title}. Objective: ${chapter.objective}`}
        </div>
        <header className="story-head">
          <span className="stamp brass story-stamp">{debrief ? 'DEBRIEF' : `${chapter.stamp} / 08`}</span>
          <h2 className="display story-title" ref={headingRef} tabIndex={-1}>{debrief ? DEBRIEF.title : chapter.title}</h2>
          <div className="story-head-actions">
            <button className="btn sm ghost icon" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? 'Expand briefing panel' : 'Collapse briefing panel'} aria-expanded={!collapsed}>
              {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {!debrief && <button className="btn sm ghost icon" onClick={controller.pause} aria-label="Pause briefing (keeps the training mission loaded)" title="Pause — keeps your place and the training mission"><Pause size={13} /></button>}
            <button className="btn sm ghost icon" onClick={debrief ? controller.closeDebrief : controller.exit} aria-label={debrief ? 'Close debrief' : 'Exit briefing and restore my previous setup'} title={debrief ? 'Close' : 'Exit — restores your pre-briefing setup'}><X size={13} /></button>
          </div>
        </header>
        <div className="story-log mono">MISSION LOG · {formatUtcStamp(timeMs)} · TRAINING EXERCISE (FICTITIOUS)</div>

        {!collapsed && (
          <div className="story-body">
            {controller.recoveryNeeded && !debrief ? (
              <div className="story-objective" role="alert">
                <span className="mono story-objective-label">TRAINING CONTEXT UNAVAILABLE</span>
                <p>
                  Your saved place is chapter {chapter.id}, but the isolated training workspace could not be
                  restored — storage was cleared or corrupted, this save predates v1.9 session snapshots, or it
                  failed session validation (oversized payload, mission settings outside the supported ranges, inconsistent terrain
                  frame metadata, or duplicate/dangling references). Invalid values are never silently clamped
                  or partially applied. Resuming on the current planner state would misreport your progress, so
                  the briefing will not pretend. Rebuild a fresh training mission (your current setup is
                  preserved and restored on exit), or leave the briefing.
                </p>
                <div className="story-controls">
                  <button className="btn sm primary" onClick={controller.rebuildTraining}>Rebuild the training mission</button>
                  <button className="btn sm" onClick={controller.exit}>Exit the briefing</button>
                </div>
              </div>
            ) : debrief ? (
              <>
                <p className="story-scene">The shift log closes. {progress.completed.length} of {STORY_CHAPTERS.length} chapters completed{progress.completed.length < STORY_CHAPTERS.length ? ' (some skipped — they stay available on replay)' : ''}.</p>
                {DEBRIEF.lines.map((l, i) => <Dialogue key={i} line={l} />)}
                <div className="story-controls" style={{ flexWrap: 'wrap' }}>
                  <button className="btn sm primary" onClick={controller.replay}>Replay the briefing</button>
                  <button className="btn sm" onClick={controller.debriefExplore}>Explore the planner</button>
                  <button className="btn sm" onClick={controller.debriefGlossary}>Open the glossary</button>
                  <button className="btn sm" onClick={controller.debriefTerrain}><Compass size={12} /> Terrain Lab (advanced)</button>
                </div>
              </>
            ) : (
              <>
                <p className="story-scene">{chapter.scene}</p>
                {chapter.intro.map((l, i) => <Dialogue key={`i${i}`} line={l} />)}

                <div className={`story-objective ${controller.objectiveMet ? 'met' : ''}`}>
                  <span className="mono story-objective-label">OBJECTIVE {controller.objectiveMet ? '· DONE ✓' : ''}</span>
                  <p>{chapter.objective}</p>
                  {chapter.id === 0 ? (
                    <div className="story-controls">
                      <button className="btn sm primary" onClick={controller.chooseTraining}>Start the training mission</button>
                      <button className="btn sm" onClick={controller.chooseExplore}>Explore first</button>
                    </div>
                  ) : (
                    <div className="story-controls">
                      {chapter.primary && <button className="btn sm primary" onClick={controller.runPrimary}>{chapter.primary.label}</button>}
                      {chapter.id === 1 && !controller.objectiveMet && (
                        <button className="btn sm ghost" onClick={controller.keepRegion}>Use this region</button>
                      )}
                    </div>
                  )}
                </div>

                {chapter.id !== 0 && (
                  <>
                    {narrative.lines.length > 0 && (
                      <div className="story-live">
                        <span className="mono story-live-label">LIVE READ · FROM THE SOLVER</span>
                        {narrative.lines.map((l, i) => <Dialogue key={`n${i}`} line={l} />)}
                      </div>
                    )}
                    {narrative.readouts.length > 0 && (
                      <dl className="story-readouts mono">
                        {narrative.readouts.map((r) => (
                          <div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>
                        ))}
                      </dl>
                    )}
                    {narrative.note && <p className="story-note">{narrative.note}</p>}
                  </>
                )}

                {chapter.check && (checkUnlocked ? (
                  <fieldset className="story-check">
                    <legend className="mono story-check-label">KNOWLEDGE CHECK</legend>
                    <p className="story-check-q">{chapter.check.question}</p>
                    {chapter.check.options.map((opt, i) => (
                      <button key={i} type="button" className={`story-opt ${chosen === i ? (i === chapter.check!.correct ? 'right' : 'wrong') : ''}`}
                        aria-pressed={chosen === i} onClick={() => controller.answer(i)}>
                        <span className="mono" aria-hidden="true">{String.fromCharCode(65 + i)}</span> {opt}
                      </button>
                    ))}
                    {chosen !== undefined && (
                      <p className="story-feedback" role="status">
                        <strong>{chosen === chapter.check.correct ? 'Correct. ' : 'Not quite. '}</strong>{chapter.check.why}
                      </p>
                    )}
                  </fieldset>
                ) : (
                  <p className="story-hint">Complete the objective above to unlock the knowledge check.</p>
                ))}

                <details className="story-deeper">
                  <summary>Go deeper — the formal definitions</summary>
                  <p>{chapter.deeper.text}</p>
                  {chapter.deeper.glossaryIds.map((id) => {
                    const g = GLOSSARY_BY_ID[id];
                    if (!g) return null;
                    return (
                      <div key={id} className="story-term">
                        <span className="mono">{g.term}{g.unit ? ` (${g.unit})` : ''}</span>
                        <p>{g.plain}</p>
                        <p className="tech">{g.technical}</p>
                      </div>
                    );
                  })}
                  <button className="btn sm ghost" onClick={controller.openDeeper}>Open in the Field Guide glossary</button>
                </details>

                {chapter.id !== 0 && (
                  <div className="story-controls story-nav">
                    <button className="btn sm" onClick={controller.back} disabled={chapter.id === 0}>Back</button>
                    <button className="btn sm ghost" onClick={controller.skip}>Skip chapter</button>
                    <button className="btn sm primary" onClick={controller.next} disabled={!controller.canContinue}
                      title={controller.canContinue ? undefined : 'Finish the objective and knowledge check first (or skip)'}>
                      {chapter.id === controller.lastChapter ? 'Finish briefing' : 'Next chapter'}
                    </button>
                  </div>
                )}

                <div className="story-dots" role="group" aria-label="Briefing chapters">
                  {STORY_CHAPTERS.map((c) => (
                    <button key={c.id} type="button"
                      className={`story-dot ${progress.completed.includes(c.id) ? 'done' : ''} ${c.id === chapter.id ? 'current' : ''}`}
                      disabled={c.id > controller.furthest}
                      aria-label={`Chapter ${c.id}: ${c.title}${progress.completed.includes(c.id) ? ' (completed)' : ''}`}
                      aria-current={c.id === chapter.id ? 'step' : undefined}
                      onClick={() => controller.jump(c.id)} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </>
  );
}
