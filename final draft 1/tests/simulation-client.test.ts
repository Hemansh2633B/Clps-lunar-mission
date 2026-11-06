import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LANDING_SITES } from '../src/data/landingSites';
import { DEFAULT_CONFIG } from '../src/engine/simulation';
import {
  requestSimulation, releaseSimulation, cachedSimulation,
  _cacheStats, _resetSimulationClient, SimulationCancelledError,
} from '../src/engine/simulationClient';
import { simulateMission } from '../src/engine/simulation';

const site = LANDING_SITES[0];
const START = Date.parse('2026-12-18T00:00:00Z');
const DAY = 86_400_000;
const cfg = { ...DEFAULT_CONFIG, durationDays: 3 };

// A fake Worker that computes asynchronously (so requests can be cancelled mid-flight)
// and forwards a progress message before the result, mirroring the real worker.
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  terminated = false;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(req: { id: number; site: typeof site; startMs: number; endMs: number; config: typeof cfg }) {
    setTimeout(() => {
      if (this.terminated) return;
      this.onmessage?.({ data: { progress: req.id, phase: 'sampling', fraction: 0.5 } });
      const result = simulateMission(req.site, req.startMs, req.endMs, req.config);
      if (this.terminated) return;
      this.onmessage?.({ data: { id: req.id, ok: true, result } });
    }, 80); // slower than the 40ms cancel debounce so abandonment can win the race
  }
  terminate() { this.terminated = true; }
}

const flush = () => new Promise((r) => setTimeout(r, 120));

describe('simulation client: cache, cancellation, progress', () => {
  beforeEach(() => {
    _resetSimulationClient();
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => {
    _resetSimulationClient();
    vi.unstubAllGlobals();
  });

  it('caches a resolved result and reuses it for the same key', async () => {
    const a = await requestSimulation(site, START, START + 3 * DAY, cfg);
    releaseSimulation(site, START, START + 3 * DAY, cfg);
    expect(cachedSimulation(site, START, START + 3 * DAY, cfg)).toBe(a);
    const b = await requestSimulation(site, START, START + 3 * DAY, cfg);
    expect(b).toBe(a); // identical cached object
    releaseSimulation(site, START, START + 3 * DAY, cfg);
    expect(_cacheStats().size).toBe(1);
  });

  it('deduplicates concurrent identical requests into one inflight promise', async () => {
    const p1 = requestSimulation(site, START, START + 3 * DAY, cfg);
    const p2 = requestSimulation(site, START, START + 3 * DAY, cfg);
    expect(_cacheStats().pending).toBe(1);
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe(b);
    releaseSimulation(site, START, START + 3 * DAY, cfg);
    releaseSimulation(site, START, START + 3 * DAY, cfg);
  });

  it('cancels a superseded request when its last consumer releases it', async () => {
    const p = requestSimulation(site, START, START + 3 * DAY, cfg);
    const caught = p.catch((e) => e);
    expect(_cacheStats().pending).toBe(1);
    releaseSimulation(site, START, START + 3 * DAY, cfg); // abandon before it completes
    const err = await caught;
    expect(err).toBeInstanceOf(SimulationCancelledError);
    await flush();
    expect(_cacheStats().pending).toBe(0);
    expect(cachedSimulation(site, START, START + 3 * DAY, cfg)).toBeUndefined();
  });

  it('does not cancel a request released then immediately re-requested (StrictMode remount)', async () => {
    const p1 = requestSimulation(site, START, START + 3 * DAY, cfg);
    const caught1 = p1.catch((e) => e);
    releaseSimulation(site, START, START + 3 * DAY, cfg); // mount -> unmount
    const p2 = requestSimulation(site, START, START + 3 * DAY, cfg); // remount within debounce
    const result = await p2;
    expect(result.summary).toBeTruthy();
    expect(await caught1).toBe(result); // resolved, not cancelled — the key was re-requested
    expect(FakeWorker.instances.length).toBe(1); // no wasteful respawn
    releaseSimulation(site, START, START + 3 * DAY, cfg);
  });

  it('reference-counts shared requests: one release keeps it, the last release cancels', async () => {
    const p1 = requestSimulation(site, START, START + 3 * DAY, cfg);
    const p2 = requestSimulation(site, START, START + 3 * DAY, cfg);
    const caught = Promise.all([p1.catch((e) => e), p2.catch((e) => e)]);
    releaseSimulation(site, START, START + 3 * DAY, cfg); // first consumer leaves
    expect(_cacheStats().pending).toBe(1); // still wanted by the second
    releaseSimulation(site, START, START + 3 * DAY, cfg); // last consumer leaves
    const [e1, e2] = await caught;
    expect(e1).toBeInstanceOf(SimulationCancelledError);
    expect(e2).toBeInstanceOf(SimulationCancelledError);
  });

  it('cancelling one request does not drop a different still-wanted request', async () => {
    const pa = requestSimulation(site, START, START + 3 * DAY, cfg);
    const pb = requestSimulation(site, START, START + 4 * DAY, { ...cfg, durationDays: 4 });
    const caughtA = pa.catch((e) => e);
    releaseSimulation(site, START, START + 3 * DAY, cfg); // cancel A
    expect(await caughtA).toBeInstanceOf(SimulationCancelledError);
    const b = await pb; // B survives the respawn and resolves
    expect(b.summary).toBeTruthy();
    releaseSimulation(site, START, START + 4 * DAY, { ...cfg, durationDays: 4 });
  });

  it('forwards phase progress to the requester', async () => {
    const phases: string[] = [];
    await requestSimulation(site, START, START + 3 * DAY, cfg, (p) => phases.push(p.phase));
    releaseSimulation(site, START, START + 3 * DAY, cfg);
    expect(phases).toContain('sampling');
  });

  it('simulateMission reports ordered phases with non-decreasing fractions', () => {
    const events: { phase: string; fraction: number }[] = [];
    simulateMission(site, START, START + 3 * DAY, cfg, (p) => events.push({ ...p }));
    const phases = events.map((e) => e.phase);
    expect(phases).toContain('sampling');
    expect(phases.indexOf('transitions')).toBeGreaterThan(phases.lastIndexOf('sampling'));
    expect(phases).toContain('energy');
    expect(phases).toContain('summary');
    for (let i = 1; i < events.length; i++) expect(events[i].fraction).toBeGreaterThanOrEqual(events[i - 1].fraction);
    expect(events[events.length - 1].fraction).toBeLessThanOrEqual(1);
  });

  it('keeps the cache within its limit (LRU eviction)', async () => {
    // 40 distinct windows; the cache must never exceed 36 entries.
    for (let i = 0; i < 40; i++) {
      const s = START + i * DAY;
      await requestSimulation(site, s, s + 3 * DAY, cfg);
      releaseSimulation(site, s, s + 3 * DAY, cfg);
      expect(_cacheStats().size).toBeLessThanOrEqual(36);
    }
    // The oldest window was evicted; a recent one is still cached.
    expect(cachedSimulation(site, START, START + 3 * DAY, cfg)).toBeUndefined();
    expect(cachedSimulation(site, START + 39 * DAY, START + 42 * DAY, cfg)).toBeTruthy();
  }, 20000);
});
