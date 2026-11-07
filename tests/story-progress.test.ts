import { describe, expect, it } from 'vitest';
import {
  STORY_STORAGE_KEY, STORY_VERSION, advance, back, dismissSuggestion, exitStory,
  freshProgress, jumpTo, loadProgress, parseProgress, pause, restart, resume,
  saveProgress, shouldSuggest, skipChapter, withAnswer, type StoryProgress,
} from '../src/tutorial/progress';

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    dump: () => map,
  };
}

describe('versioned persistence', () => {
  it('uses a versioned key and round-trips through storage', () => {
    expect(STORY_STORAGE_KEY).toBe('chandra-story-v1');
    const s = fakeStorage();
    const p = withAnswer({ ...freshProgress(), chapter: 3 }, 2, 1);
    saveProgress(p, s);
    expect(s.dump().has(STORY_STORAGE_KEY)).toBe(true);
    expect(loadProgress(s)).toEqual(p);
  });

  it('treats corrupt payloads and foreign versions as no progress', () => {
    expect(parseProgress(null)).toBeNull();
    expect(parseProgress('not json')).toBeNull();
    expect(parseProgress(JSON.stringify({ ...freshProgress(), v: STORY_VERSION + 1 }))).toBeNull();
    expect(parseProgress(JSON.stringify({ ...freshProgress(), status: 'bogus' }))).toBeNull();
    expect(parseProgress(JSON.stringify({ ...freshProgress(), chapter: NaN }))).toBeNull();
    expect(parseProgress(JSON.stringify({ ...freshProgress(), completed: [99] }))).toBeNull();
    expect(parseProgress(JSON.stringify({ ...freshProgress(), answers: { 1: -2 } }))).toBeNull();
    expect(parseProgress(JSON.stringify({ ...freshProgress(), answers: [] }))).toBeNull();
  });

  it('clamps out-of-range chapters and deduplicates completions', () => {
    const p = parseProgress(JSON.stringify({ ...freshProgress(), chapter: 42, completed: [2, 2, 1] }));
    expect(p?.chapter).toBe(8);
    expect(p?.completed).toEqual([1, 2]);
  });

  it('survives unavailable storage without throwing', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadProgress(throwing)).toBeNull();
    expect(loadProgress(null)).toBeNull();
    expect(() => saveProgress(freshProgress(), throwing)).not.toThrow();
    expect(() => saveProgress(freshProgress(), null)).not.toThrow();
  });
});

describe('progress transitions', () => {
  it('advances only when the objective is met, and never mutates', () => {
    const p = freshProgress();
    expect(advance(p, false)).toBe(p);
    const q = advance(p, true);
    expect(q.chapter).toBe(1);
    expect(q.completed).toEqual([0]);
    expect(p.chapter).toBe(0);
    expect(p.completed).toEqual([]);
  });

  it('walks the full story to completion', () => {
    let p = freshProgress();
    for (let i = 0; i <= 8; i++) p = advance(p, true);
    expect(p.status).toBe('completed');
    expect(p.completed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(p.chapter).toBe(8);
  });

  it('skip moves on without credit; skipping the last chapter ends the story', () => {
    let p = freshProgress();
    p = skipChapter(p);
    expect(p.chapter).toBe(1);
    expect(p.completed).toEqual([]);
    p = jumpTo(p, 8);
    p = skipChapter(p);
    expect(p.status).toBe('completed');
    expect(p.completed).toEqual([]);
  });

  it('back and jump clamp to the chapter range', () => {
    expect(back(freshProgress()).chapter).toBe(0);
    expect(jumpTo(freshProgress(), -3).chapter).toBe(0);
    expect(jumpTo(freshProgress(), 100).chapter).toBe(8);
  });

  it('pause, resume and exit preserve position and answers', () => {
    const p = withAnswer({ ...freshProgress(), chapter: 4, completed: [0, 1, 2, 3] }, 3, 1);
    const paused = pause(p);
    expect(paused.status).toBe('paused');
    expect(resume(paused).status).toBe('active');
    const exited = exitStory(p);
    expect(exited.status).toBe('paused');
    expect(exited.chapter).toBe(4);
    expect(exited.answers).toEqual({ 3: 1 });
    expect(exited.completed).toEqual([0, 1, 2, 3]);
    // Exiting a completed story keeps it completed.
    const done: StoryProgress = { ...p, status: 'completed' };
    expect(exitStory(done).status).toBe('completed');
    expect(resume(done).status).toBe('completed');
  });

  it('restart resets everything but never re-enables the suggestion', () => {
    const p: StoryProgress = { ...freshProgress(), chapter: 6, completed: [0, 1, 2], answers: { 1: 0 } };
    const r = restart(p);
    expect(r.chapter).toBe(0);
    expect(r.completed).toEqual([]);
    expect(r.answers).toEqual({});
    expect(r.status).toBe('active');
    expect(r.suggestionDismissed).toBe(true);
    expect(shouldSuggest(r)).toBe(false);
  });

  it('records answers immutably', () => {
    const p = freshProgress();
    const q = withAnswer(p, 2, 1);
    expect(q.answers).toEqual({ 2: 1 });
    expect(p.answers).toEqual({});
  });
});

describe('first-run suggestion policy', () => {
  it('suggests only to genuinely fresh users', () => {
    expect(shouldSuggest(null)).toBe(true);
    expect(shouldSuggest(dismissSuggestion(null))).toBe(false);
    expect(shouldSuggest(freshProgress())).toBe(false); // already interacting
    expect(shouldSuggest({ ...freshProgress(), status: 'paused', chapter: 3 })).toBe(false);
    expect(shouldSuggest({ ...freshProgress(), status: 'completed' })).toBe(false);
  });

  it('dismissing marks the suggestion gone without touching real progress', () => {
    const p: StoryProgress = { ...freshProgress(), status: 'paused', chapter: 5, completed: [0, 1] };
    const d = dismissSuggestion(p);
    expect(d.suggestionDismissed).toBe(true);
    expect(d.chapter).toBe(5);
    expect(d.status).toBe('paused');
    const fresh = dismissSuggestion(null);
    expect(fresh.status).toBe('dismissed');
    expect(fresh.suggestionDismissed).toBe(true);
  });
});
