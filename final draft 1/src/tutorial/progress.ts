/**
 * Story progress: a pure, versioned state machine.
 *
 * Persistence key is versioned (`chandra-story-v1`); an unknown version or corrupt
 * payload is treated as "no progress" rather than crashing or forcing the tutorial.
 * All transitions are immutable so tests (and React) can reason about them, and
 * exiting never touches the mission state — the App snapshots/restores that itself.
 */
import { LAST_CHAPTER } from './story';

export const STORY_VERSION = 1 as const;
export const STORY_STORAGE_KEY = 'chandra-story-v1';

export type StoryStatus = 'active' | 'paused' | 'completed' | 'dismissed';

export interface StoryProgress {
  v: typeof STORY_VERSION;
  status: StoryStatus;
  /** Current chapter index, 0..LAST_CHAPTER. */
  chapter: number;
  /** Chapters whose objective + check were satisfied (skips are NOT listed). */
  completed: number[];
  /** Chosen option index per chapter (knowledge checks). */
  answers: Record<number, number>;
  /** First-run suggestion was dismissed — never nag again. */
  suggestionDismissed: boolean;
}

export function freshProgress(): StoryProgress {
  return { v: STORY_VERSION, status: 'active', chapter: 0, completed: [], answers: {}, suggestionDismissed: false };
}

const clampChapter = (n: number) => Math.min(Math.max(Math.trunc(n), 0), LAST_CHAPTER);

/** Strict parse: wrong version / shape → null (fresh start), never a throw. */
export function parseProgress(raw: string | null): StoryProgress | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<StoryProgress>;
    if (p.v !== STORY_VERSION) return null;
    if (p.status !== 'active' && p.status !== 'paused' && p.status !== 'completed' && p.status !== 'dismissed') return null;
    if (typeof p.chapter !== 'number' || !Number.isFinite(p.chapter)) return null;
    if (!Array.isArray(p.completed) || p.completed.some((c) => typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > LAST_CHAPTER)) return null;
    if (typeof p.answers !== 'object' || p.answers === null || Array.isArray(p.answers)) return null;
    const answers: Record<number, number> = {};
    for (const [k, v] of Object.entries(p.answers)) {
      const idx = Number(k);
      if (!Number.isInteger(idx) || idx < 0 || idx > LAST_CHAPTER || typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null;
      answers[idx] = v;
    }
    return {
      v: STORY_VERSION,
      status: p.status,
      chapter: clampChapter(p.chapter),
      completed: [...new Set(p.completed)].sort((a, b) => a - b),
      answers,
      suggestionDismissed: p.suggestionDismissed === true,
    };
  } catch {
    return null;
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function loadProgress(storage: StorageLike | null): StoryProgress | null {
  if (!storage) return null;
  try { return parseProgress(storage.getItem(STORY_STORAGE_KEY)); } catch { return null; }
}

export function saveProgress(p: StoryProgress, storage: StorageLike | null): void {
  if (!storage) return;
  try { storage.setItem(STORY_STORAGE_KEY, JSON.stringify(p)); } catch { /* storage unavailable — session-only */ }
}

export function withAnswer(p: StoryProgress, chapter: number, option: number): StoryProgress {
  return { ...p, answers: { ...p.answers, [chapter]: option } };
}

function markCompleted(p: StoryProgress, chapter: number): StoryProgress {
  return p.completed.includes(chapter) ? p : { ...p, completed: [...p.completed, chapter].sort((a, b) => a - b) };
}

/** Advance only when the objective is met; finishing ch8 completes the story. */
export function advance(p: StoryProgress, objectiveMet: boolean): StoryProgress {
  if (!objectiveMet) return p;
  const done = markCompleted(p, p.chapter);
  if (p.chapter >= LAST_CHAPTER) return { ...done, status: 'completed' };
  return { ...done, chapter: p.chapter + 1 };
}

export function back(p: StoryProgress): StoryProgress {
  return { ...p, chapter: clampChapter(p.chapter - 1) };
}

/** Skip never marks the chapter completed. Skipping ch8 ends the story. */
export function skipChapter(p: StoryProgress): StoryProgress {
  if (p.chapter >= LAST_CHAPTER) return { ...p, status: 'completed' };
  return { ...p, chapter: p.chapter + 1 };
}

export function jumpTo(p: StoryProgress, chapter: number): StoryProgress {
  return { ...p, chapter: clampChapter(chapter) };
}

export function pause(p: StoryProgress): StoryProgress {
  return p.status === 'active' ? { ...p, status: 'paused' } : p;
}

export function resume(p: StoryProgress): StoryProgress {
  return { ...p, status: p.status === 'completed' ? 'completed' : 'active' };
}

/** Leaving the story keeps position + answers so it can be resumed later. */
export function exitStory(p: StoryProgress): StoryProgress {
  return p.status === 'completed' ? p : { ...p, status: 'paused' };
}

export function restart(_p: StoryProgress): StoryProgress {
  // Restarting implies the user knows the story exists — never re-suggest it.
  return { ...freshProgress(), suggestionDismissed: true };
}

export function dismissSuggestion(p: StoryProgress | null): StoryProgress {
  const base = p ?? freshProgress();
  return { ...base, status: base.status === 'active' && base.completed.length === 0 && base.chapter === 0 ? 'dismissed' : base.status, suggestionDismissed: true };
}

/** Should the post-onboarding suggestion appear? Only when no progress was ever saved. */
export function shouldSuggest(p: StoryProgress | null): boolean {
  // Any saved progress means the user has already seen the story (started, paused,
  // completed or dismissed it) — never nag a returning user.
  return p === null;
}
