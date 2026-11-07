import { describe, expect, it } from 'vitest';
import { DEBRIEF, FICTION_NOTICE, LAST_CHAPTER, STORY_CHAPTERS } from '../src/tutorial/story';
import { GLOSSARY_BY_ID } from '../src/data/glossary';

describe('story chapter structure', () => {
  it('has exactly chapters 0–8 in order with matching stamps', () => {
    expect(STORY_CHAPTERS).toHaveLength(9);
    expect(LAST_CHAPTER).toBe(8);
    STORY_CHAPTERS.forEach((c, i) => {
      expect(c.id).toBe(i);
      expect(c.stamp).toBe(`CH 0${i}`);
      expect(c.title.length).toBeGreaterThan(3);
      expect(c.scene.length).toBeGreaterThan(10);
      expect(c.intro.length).toBeGreaterThanOrEqual(1);
      expect(c.objective.length).toBeGreaterThan(10);
    });
  });

  it('spotlights real controls everywhere except the opening choice', () => {
    expect(STORY_CHAPTERS[0].target).toBeNull();
    for (const c of STORY_CHAPTERS.slice(1)) {
      expect(c.target, c.title).toBeTruthy();
      expect(['planner', 'compare']).toContain(c.view);
    }
  });

  it('uses the intended completion witnesses per chapter', () => {
    expect(STORY_CHAPTERS.map((c) => c.completion)).toEqual([
      'choice', 'site-selected', 'time-scrubbed', 'earth-inspected', 'config-changed',
      'slip-changed', 'read-telemetry', 'compared', 'exported',
    ]);
  });

  it('gives chapters 1–7 a well-formed knowledge check', () => {
    expect(STORY_CHAPTERS[0].check).toBeUndefined();
    expect(STORY_CHAPTERS[8].check).toBeUndefined();
    for (const c of STORY_CHAPTERS.slice(1, 8)) {
      expect(c.check, c.title).toBeDefined();
      expect(c.check!.options).toHaveLength(3);
      expect(c.check!.correct).toBeGreaterThanOrEqual(0);
      expect(c.check!.correct).toBeLessThan(3);
      expect(c.check!.why.length).toBeGreaterThan(30);
    }
  });

  it('resolves every go-deeper reference against the canonical glossary (no duplicates)', () => {
    for (const c of STORY_CHAPTERS) {
      expect(c.deeper.glossaryIds.length).toBeGreaterThan(0);
      for (const id of c.deeper.glossaryIds) {
        expect(GLOSSARY_BY_ID[id], `${c.title} → ${id}`).toBeDefined();
      }
      expect(c.deeper.text.length).toBeGreaterThan(40);
    }
  });

  it('drives real controls with its primary actions', () => {
    expect(STORY_CHAPTERS[4].primary?.action).toBe('settings');
    expect(STORY_CHAPTERS[7].primary?.action).toBe('pin');
    expect(STORY_CHAPTERS[8].primary?.action).toBe('export');
    for (const c of STORY_CHAPTERS) {
      if (c.primary?.action === 'focus') expect(c.target).toBeTruthy();
    }
  });
});

describe('story terminology and honesty', () => {
  const allText = [
    FICTION_NOTICE, DEBRIEF.title,
    ...STORY_CHAPTERS.flatMap((c) => [
      c.scene, c.objective, c.deeper.text,
      ...c.intro.map((l) => l.text),
      ...(c.check ? [c.check.question, ...c.check.options, c.check.why] : []),
    ]),
    ...DEBRIEF.lines.map((l) => l.text),
  ].join('\n');

  it('never uses survival-risk or freeze framing', () => {
    expect(allText).not.toMatch(/survival[- ]risk/i);
    expect(allText).not.toMatch(/will survive|mission survives|freeze your lander/i);
  });

  it('labels the scenario fictional and illustrative up front', () => {
    expect(STORY_CHAPTERS[0].intro.map((l) => l.text).join(' ')).toMatch(/fictional/i);
    expect(FICTION_NOTICE).toMatch(/not an actual Artemis or CLPS flight plan/i);
    expect(STORY_CHAPTERS[0].objective).toMatch(/illustrative/i);
  });

  it('separates geometric LOS from RF, energy from survival, heuristics from NASA', () => {
    expect(allText).toMatch(/NOT an RF link budget/i);
    expect(allText).toMatch(/thermal/i);
    expect(allText).toMatch(/not a NASA (methodology|vehicle specs)/i);
    expect(allText).toMatch(/not an Artemis IV selection/i);
  });

  it('uses only the two fictional speakers', () => {
    for (const c of STORY_CHAPTERS) for (const l of c.intro) expect(['MIRA', 'ARIN']).toContain(l.speaker);
    for (const l of DEBRIEF.lines) expect(['MIRA', 'ARIN']).toContain(l.speaker);
  });
});
