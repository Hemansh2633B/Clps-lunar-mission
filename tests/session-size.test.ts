/** v1.11: reject oversized persisted payloads before JSON.parse. */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { DEFAULT_CONFIG } from '../src/engine/simulation';
import { parseSession, readSession, loadSessionDetails, saveSession, MAX_SESSION_LENGTH, SESSION_STORAGE_KEY, SESSION_VERSION, type TrainingSession, type WorkspaceSnapshot } from '../src/tutorial/session';

const LIMIT = MAX_SESSION_LENGTH;
function session(): TrainingSession {
  const ws: WorkspaceSnapshot = {
    selectedId: 'shackleton-rim', baselineMs: Date.parse('2026-12-18T00:00:00Z'), slipDays: 0,
    config: { ...DEFAULT_CONFIG }, viewDays: 30, timeMs: Date.parse('2026-12-18T00:00:00Z'),
    mode: 'planner', compareMode: false, terrainView: false, spaceView: false,
    scenarios: [], playing: false, speed: 3600, customSites: [],
  };
  return { v: SESSION_VERSION, user: ws, training: ws };
}
afterEach(() => vi.restoreAllMocks());

describe('session serialized-size guard', () => {
  it('rejects an oversized payload before calling JSON.parse', () => {
    const raw = JSON.stringify(session()).padEnd(LIMIT + 1, ' ');
    const parse = vi.spyOn(JSON, 'parse');
    expect(parseSession(raw)).toBeNull();
    expect(parse).not.toHaveBeenCalled();
  });

  it('accepts a valid payload exactly at the limit and still migrates v1', () => {
    const raw = JSON.stringify({ ...session(), v: 1 }).padEnd(LIMIT, ' ');
    expect(raw.length).toBe(LIMIT);
    const parsed = parseSession(raw);
    expect(parsed?.v).toBe(SESSION_VERSION);
    expect(parsed?.user.selectedId).toBe('shackleton-rim');
  });

  it('does not bypass structural validation for a small payload', () => {
    const bad = session() as unknown as { user: { config: { loadW: number } } };
    bad.user.config.loadW = 1e9;
    expect(parseSession(JSON.stringify(bad))).toBeNull();
  });
});


describe('explicit session rejection and save preflight', () => {
  it('returns SESSION_TOO_LARGE with an actionable notice before parsing', () => {
    const raw = 'x'.repeat(LIMIT + 1);
    const parse = vi.spyOn(JSON, 'parse');
    const result = readSession(raw);
    expect(result.session).toBeNull();
    expect(result.rejection?.code).toBe('SESSION_TOO_LARGE');
    expect(result.rejection?.message).toMatch(/Rebuild \/ Exit/);
    expect(result.rejection?.message).toMatch(/unchanged/);
    expect(parse).not.toHaveBeenCalled();
  });

  it('absent storage is not a rejection; corrupt storage keeps the validation reason', () => {
    expect(readSession(null)).toEqual({ session: null, rejection: null });
    expect(readSession('{bad').rejection?.code).toBe('SESSION_INVALID');
  });

  it('loadSessionDetails surfaces the size rejection from storage', () => {
    const storage = { getItem: () => 'x'.repeat(LIMIT + 1), setItem: () => {}, removeItem: () => {} };
    expect(loadSessionDetails(storage).rejection?.code).toBe('SESSION_TOO_LARGE');
  });

  it('refuses to save a payload the reader would reject, without calling setItem', () => {
    const s = session();
    s.user.scenarios = [{ id: 'big', siteId: 'shackleton-rim', startMs: 0, config: { ...DEFAULT_CONFIG }, label: 'x'.repeat(LIMIT) }];
    const setItem = vi.fn();
    const storage = { getItem: () => null, setItem, removeItem: () => {} };
    const result = saveSession(s, storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe('SESSION_TOO_LARGE');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('storage write failures are returned instead of silently swallowed', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
    const result = saveSession(session(), storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe('SESSION_STORAGE_UNAVAILABLE');
    expect(saveSession(session(), null).ok).toBe(false);
  });

  it('a valid save still round-trips through the same storage key', () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
    expect(saveSession(session(), storage).ok).toBe(true);
    expect(map.has(SESSION_STORAGE_KEY)).toBe(true);
    expect(loadSessionDetails(storage).session?.v).toBe(SESSION_VERSION);
  });
});
