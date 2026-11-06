/**
 * React binding for the story: owns versioned progress, observes REAL app-state
 * changes as objective witnesses, and exposes handlers that drive real controls.
 * The hook never fabricates interactions — completion comes from the same state
 * the instruments render (selection, time, config, slip, pins, guarded exports).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LAST_CHAPTER, STORY_CHAPTERS } from './story';
import {
  advance, back, dismissSuggestion, exitStory, freshProgress, jumpTo, loadProgress,
  pause as pauseProgress, restart as restartProgress, resume as resumeProgress,
  saveProgress, shouldSuggest, skipChapter, withAnswer, type StoryProgress,
} from './progress';

/** Live app values the hook watches (all owned by App, none duplicated). */
export interface StorySignals {
  selectedId: string;
  timeMs: number;
  slipDays: number;
  /** JSON.stringify(config) — any settings change is a witness. */
  configKey: string;
  scenarioCount: number;
  compareMode: boolean;
  /** Increments only on a real, guard-passing export. */
  exportCount: number;
}

export interface StoryActions {
  /** Snapshot the user's setup, then load the labeled training mission. */
  loadTrainingMission: () => void;
  /** Restore the pre-story setup (no-op if training was never loaded). */
  restoreMission: () => void;
  ensureView: (view: 'planner' | 'compare') => void;
  focusTarget: (key: string) => void;
  openSettings: () => void;
  openGlossary: (firstTerm: string) => void;
  openGuide: () => void;
  openTerrainLab: () => void;
  pinCurrent: () => void;
  exportReport: () => void;
  notify: (msg: string) => void;
}

interface WitnessBaseline {
  selectedId: string;
  timeMs: number;
  slipDays: number;
  configKey: string;
  exportCount: number;
}

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export function useStoryTutorial(signals: StorySignals, actions: StoryActions) {
  const [progress, setProgress] = useState<StoryProgress | null>(() => loadProgress(storage()));
  const [panelOpen, setPanelOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  /** ch1 escape hatch: explicitly keep the current region (a decision, not a fake control). */
  const [keptRegion, setKeptRegion] = useState(false);
  const baseline = useRef<{ chapter: number; values: WitnessBaseline } | null>(null);

  const active = panelOpen && progress !== null && (progress.status === 'active' || progress.status === 'completed');
  const chapter = progress ? STORY_CHAPTERS[progress.chapter] : STORY_CHAPTERS[0];
  const debrief = active && progress?.status === 'completed';

  // Capture the witness baseline synchronously when the active chapter changes,
  // so no render ever compares against the previous chapter's baseline.
  if (active && progress?.status === 'active' && baseline.current?.chapter !== progress.chapter) {
    baseline.current = {
      chapter: progress.chapter,
      values: { selectedId: signals.selectedId, timeMs: signals.timeMs, slipDays: signals.slipDays, configKey: signals.configKey, exportCount: signals.exportCount },
    };
  }

  // Persist every transition (versioned key; corrupt/absent storage is session-only).
  useEffect(() => {
    if (progress) saveProgress(progress, storage());
  }, [progress]);

  useEffect(() => {
    setKeptRegion(false);
  }, [progress?.chapter]);

  // Navigate to the chapter's view, then bring the real target into view.
  useEffect(() => {
    if (!active || progress?.status !== 'active' || debrief) return;
    if (chapter.view) actions.ensureView(chapter.view);
    if (!chapter.target) return;
    const key = chapter.target;
    const id = window.setTimeout(() => actions.focusTarget(key), 300);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, progress?.chapter, debrief]);

  const objectiveMet = useMemo(() => {
    if (!progress || progress.status !== 'active') return false;
    // Revisited chapters stay satisfied — the work was already done.
    if (progress.completed.includes(chapter.id) && chapter.completion !== 'choice') return true;
    const b = baseline.current?.chapter === chapter.id ? baseline.current.values : null;
    switch (chapter.completion) {
      case 'choice': return false; // driven by the two real choices in ch0
      case 'site-selected': return keptRegion || (b !== null && signals.selectedId !== b.selectedId);
      case 'time-scrubbed':
      case 'earth-inspected': return b !== null && Math.abs(signals.timeMs - b.timeMs) >= 30 * 60 * 1000;
      case 'config-changed': return b !== null && signals.configKey !== b.configKey;
      case 'slip-changed': return b !== null && signals.slipDays !== b.slipDays;
      case 'read-telemetry': return progress.answers[chapter.id] !== undefined;
      case 'compared': return signals.scenarioCount >= 2 && signals.compareMode;
      case 'exported': return b !== null && signals.exportCount > b.exportCount;
      default: return false;
    }
  }, [progress, chapter, signals, keptRegion]);

  const answered = progress?.answers[chapter.id] !== undefined;
  const canContinue = objectiveMet && (!chapter.check || answered);
  const furthest = progress ? Math.max(progress.chapter, ...progress.completed.map((c) => c + 1), 0) : 0;

  const start = useCallback(() => {
    setSuggestOpen(false);
    setProgress((p) => {
      const base = p ?? freshProgress();
      return base.status === 'completed' ? base : resumeProgress(base.status === 'dismissed' ? freshProgress() : base);
    });
    setPanelOpen(true);
  }, []);

  const replay = useCallback(() => {
    setSuggestOpen(false);
    setProgress((p) => restartProgress(p ?? freshProgress()));
    setPanelOpen(true);
  }, []);

  const suggestAfterOnboarding = useCallback(() => {
    if (shouldSuggest(loadProgress(storage()))) setSuggestOpen(true);
  }, []);

  const dismissSuggestionUi = useCallback(() => {
    setSuggestOpen(false);
    setProgress((p) => dismissSuggestion(p));
  }, []);

  const chooseTraining = useCallback(() => {
    actions.loadTrainingMission();
    setProgress((p) => advance(p ?? freshProgress(), true));
  }, [actions]);

  const chooseExplore = useCallback(() => {
    setProgress((p) => exitStory(p ?? freshProgress()));
    setPanelOpen(false);
    actions.notify('Briefing paused — resume it any time from the Field Guide (G). Your setup is untouched.');
  }, [actions]);

  const answer = useCallback((option: number) => {
    setProgress((p) => (p ? withAnswer(p, p.chapter, option) : p));
  }, []);

  const next = useCallback(() => {
    setProgress((p) => (p ? advance(p, objectiveMet) : p));
  }, [objectiveMet]);

  const goBack = useCallback(() => setProgress((p) => (p ? back(p) : p)), []);
  const skip = useCallback(() => setProgress((p) => (p ? skipChapter(p) : p)), []);
  const jump = useCallback((idx: number) => {
    setProgress((p) => (p && idx <= furthest ? jumpTo(p, idx) : p));
  }, [furthest]);

  const pause = useCallback(() => {
    setProgress((p) => (p ? pauseProgress(p) : p));
    setPanelOpen(false);
    actions.notify('Briefing paused — your place is saved. Resume from the Field Guide.');
  }, [actions]);

  /** Exit restores the pre-story mission setup (if the training mission was loaded). */
  const exit = useCallback(() => {
    actions.restoreMission();
    setProgress((p) => (p ? exitStory(p) : p));
    setPanelOpen(false);
  }, [actions]);

  const closeDebrief = useCallback(() => {
    actions.restoreMission();
    setPanelOpen(false);
  }, [actions]);

  const runPrimary = useCallback(() => {
    const prim = chapter.primary;
    if (!prim) return;
    if (prim.action === 'focus' && chapter.target) actions.focusTarget(chapter.target);
    else if (prim.action === 'settings') actions.openSettings();
    else if (prim.action === 'pin') actions.pinCurrent();
    else if (prim.action === 'export') actions.exportReport();
  }, [chapter, actions]);

  const openDeeper = useCallback(() => {
    const first = chapter.deeper.glossaryIds[0];
    actions.openGlossary(first ?? '');
  }, [chapter, actions]);

  return {
    progress, chapter, active, debrief, panelOpen, suggestOpen,
    objectiveMet, answered, canContinue, furthest, lastChapter: LAST_CHAPTER,
    start, replay, suggestAfterOnboarding, dismissSuggestion: dismissSuggestionUi,
    chooseTraining, chooseExplore, answer, next, back: goBack, skip, jump,
    pause, exit, closeDebrief, runPrimary, openDeeper,
    keepRegion: () => setKeptRegion(true), keptRegion,
    debriefExplore: () => { closeDebrief(); actions.notify('Free exploration — the planner is all yours.'); },
    debriefGlossary: () => { closeDebrief(); actions.openGuide(); },
    debriefTerrain: () => { closeDebrief(); actions.openTerrainLab(); },
  };
}

export type StoryController = ReturnType<typeof useStoryTutorial>;
