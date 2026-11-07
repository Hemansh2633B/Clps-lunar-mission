import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/engine/simulation';
import { makeCustomSite } from '../src/data/landingSites';
import {
  clearSession, loadSession, parseSession, resolveBoot, saveSession, sessionContextLost,
  SESSION_STORAGE_KEY, type TrainingSession, type WorkspaceSnapshot,
} from '../src/tutorial/session';

function ws(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    selectedId: 'shackleton-rim', baselineMs: Date.parse('2026-12-18T00:00:00Z'), slipDays: 3,
    config: { ...DEFAULT_CONFIG }, viewDays: 30, timeMs: Date.parse('2026-12-20T08:00:00Z'),
    mode: 'planner', compareMode: true, terrainView: false, spaceView: false,
    scenarios: [{ id: 'user-1', siteId: 'connecting-ridge', startMs: Date.parse('2026-09-01T00:00:00Z'), config: { ...DEFAULT_CONFIG }, label: 'Mine' }],
    playing: true, speed: 7200, customSites: [], ...over,
  };
}
const session = (): TrainingSession => ({ v: 1, user: ws(), training: ws({ selectedId: 'connecting-ridge', scenarios: [], playing: false, slipDays: 14 }) });

function memStorage(seed?: string) {
  const map = new Map<string, string>();
  if (seed !== undefined) map.set(SESSION_STORAGE_KEY, seed);
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    dump: () => map.get(SESSION_STORAGE_KEY) ?? null,
  };
}

describe('training session persistence', () => {
  it('round-trips the FULL workspace: pins, playback, slip, config, view, custom sites', () => {
    const custom = makeCustomSite({ name: 'My DEM', latitude: -89, longitude: 30, elevationM: 100, preset: 'flat' });
    const s = session();
    s.user.customSites = [custom];
    s.user.scenarios.push({ id: 'user-2', siteId: custom.id, startMs: Date.parse('2026-10-01T00:00:00Z'), config: { ...DEFAULT_CONFIG, loadW: 220 } });
    const st = memStorage();
    saveSession(s, st);
    const back = loadSession(st);
    expect(back).not.toBeNull();
    expect(back!.user).toEqual(s.user);
    expect(back!.training).toEqual(s.training);
    expect(back!.user.playing).toBe(true);
    expect(back!.user.speed).toBe(7200);
    expect(back!.user.scenarios).toHaveLength(2);
    expect(back!.user.customSites[0].id).toBe(custom.id);
  });
  it('corrupt JSON, wrong version and malformed shapes parse to null — never throw', () => {
    expect(parseSession('{oops')).toBeNull();
    expect(parseSession(null)).toBeNull();
    expect(parseSession(JSON.stringify({ ...session(), v: 2 }))).toBeNull();
    expect(parseSession(JSON.stringify({ v: 1, user: ws() }))).toBeNull();
    const badCfg = session(); (badCfg.user.config as unknown as Record<string, unknown>).loadW = 'lots';
    expect(parseSession(JSON.stringify(badCfg))).toBeNull();
    const badMode = session(); (badMode.user as unknown as Record<string, unknown>).mode = 'party';
    expect(parseSession(JSON.stringify(badMode))).toBeNull();
    const badTime = session(); (badTime.training as unknown as Record<string, unknown>).timeMs = 'noon';
    expect(parseSession(JSON.stringify(badTime))).toBeNull();
  });
  it('rejects dangling references: unknown selected site or scenario site', () => {
    const dangling = session(); dangling.user.selectedId = 'not-a-site';
    expect(parseSession(JSON.stringify(dangling))).toBeNull();
    const danglingSc = session(); danglingSc.training.scenarios = [{ id: 'x', siteId: 'gone', startMs: 0, config: { ...DEFAULT_CONFIG } }];
    expect(parseSession(JSON.stringify(danglingSc))).toBeNull();
  });
  it('rejects oversized scenario lists (cap is 4)', () => {
    const big = session();
    big.training.scenarios = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, siteId: 'connecting-ridge', startMs: i, config: { ...DEFAULT_CONFIG } }));
    expect(parseSession(JSON.stringify(big))).toBeNull();
  });
  it('unavailable/throwing storage degrades to session-only, never crashes', () => {
    const hostile = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(loadSession(hostile)).toBeNull();
    expect(() => saveSession(session(), hostile)).not.toThrow();
    expect(() => clearSession(hostile)).not.toThrow();
    expect(loadSession(null)).toBeNull();
  });
  it('clearSession removes the payload', () => {
    const st = memStorage();
    saveSession(session(), st);
    expect(st.dump()).not.toBeNull();
    clearSession(st);
    expect(st.dump()).toBeNull();
  });
});

describe('refresh boot resolution', () => {
  it('valid session + in-training progress boots the TRAINING workspace', () => {
    const s = session();
    for (const status of ['active', 'paused']) {
      const r = resolveBoot(s, { status, chapter: 7 });
      expect(r.boot).toBe('training');
      expect(r.keepSession).toBe(true);
      expect(r.workspace).toEqual(s.training);
    }
  });
  it('orphaned session (progress gone/completed/ch0) restores the USER workspace', () => {
    const s = session();
    for (const p of [null, { status: 'completed', chapter: 8 }, { status: 'active', chapter: 0 }, { status: 'dismissed', chapter: 0 }]) {
      const r = resolveBoot(s, p);
      expect(r.boot).toBe('user');
      expect(r.keepSession).toBe(false);
      expect(r.workspace).toEqual(s.user);
    }
  });
  it('no session boots defaults; lost context is detectable for v1.8 progress', () => {
    expect(resolveBoot(null, { status: 'active', chapter: 7 }).boot).toBe('default');
    // v1.8 saved progress at ch5/7 without a session → explicit recovery, not silent defaults.
    expect(sessionContextLost(null, { status: 'paused', chapter: 5 })).toBe(true);
    expect(sessionContextLost(null, { status: 'active', chapter: 7 })).toBe(true);
    expect(sessionContextLost(null, { status: 'active', chapter: 0 })).toBe(false);
    expect(sessionContextLost(null, { status: 'completed', chapter: 8 })).toBe(false);
    expect(sessionContextLost(null, null)).toBe(false);
    expect(sessionContextLost(session(), { status: 'active', chapter: 7 })).toBe(false);
  });
  it('corrupt stored session + in-training progress = lost context (recovery path)', () => {
    const st = memStorage('{corrupt');
    const loaded = loadSession(st);
    expect(loaded).toBeNull();
    expect(sessionContextLost(loaded, { status: 'active', chapter: 7 })).toBe(true);
  });
});
