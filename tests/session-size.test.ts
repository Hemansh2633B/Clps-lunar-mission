/** v1.11: reject oversized persisted payloads before JSON.parse. */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { DEFAULT_CONFIG } from '../src/engine/simulation';
import { parseSession, SESSION_VERSION, type TrainingSession, type WorkspaceSnapshot } from '../src/tutorial/session';

const LIMIT = 800_000;
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
