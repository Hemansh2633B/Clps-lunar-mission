import type { LandingSite, MissionConfig, SimulationResult } from '../types/mission';
import { simulationKey, type SimulationProgress } from './simulation';
import type { SimulationRequest, WorkerOutbound } from './simulation.worker';

let worker: Worker | null = null;
let nextId = 1;

interface PendingEntry {
  key: string;
  request: SimulationRequest;
  onProgress?: (p: SimulationProgress) => void;
  resolve: (r: SimulationResult) => void;
  reject: (e: Error) => void;
}
const pending = new Map<number, PendingEntry>();
const cache = new Map<string, SimulationResult>(); // insertion order == LRU order (re-inserted on touch)
const inflight = new Map<string, Promise<SimulationResult>>();
const wanted = new Map<string, number>(); // active consumers per key (reference counting)
const abandoned = new Set<string>(); // keys whose last consumer left, pending debounced cancel
const CACHE_LIMIT = 36;
const CANCEL_DEBOUNCE_MS = 40;
let reconcileScheduled = false;

/** Raised when a superseded request is cancelled; consumers ignore it via their active guard. */
export class SimulationCancelledError extends Error {
  constructor() { super('Simulation cancelled (superseded by a newer request)'); this.name = 'SimulationCancelledError'; }
}

function touchCache(key: string) {
  const v = cache.get(key);
  if (v !== undefined) { cache.delete(key); cache.set(key, v); }
}
function evictCache() {
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
      const data = event.data;
      if ('progress' in data) {
        pending.get(data.progress)?.onProgress?.({ phase: data.phase, fraction: data.fraction });
        return;
      }
      const { id, ok, result, error } = data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (ok && result) entry.resolve(result);
      else entry.reject(new Error(error || 'Simulation failed'));
    };
    worker.onerror = (event) => {
      for (const [, entry] of pending) entry.reject(new Error(event.message || 'Simulation worker error'));
      pending.clear();
      inflight.clear();
      worker?.terminate();
      worker = null; // a later request spawns a fresh worker instead of reusing a broken one
    };
  }
  return worker;
}

/**
 * Debounced cancellation reconcile. A release marks a key abandoned; a re-request
 * within the debounce window (React StrictMode's mount→unmount→mount, or a quick drag
 * back) un-abandons it, so no compute is wasted respawning for a still-wanted window.
 * Only genuinely abandoned, still-pending requests are cancelled; the worker is then
 * terminated (stopping the running computation + clearing its queue) and the remaining
 * wanted requests re-posted. Coalesced so a burst of releases triggers one respawn.
 */
function scheduleReconcile() {
  if (reconcileScheduled) return;
  reconcileScheduled = true;
  setTimeout(() => {
    reconcileScheduled = false;
    let cancelledAny = false;
    for (const key of abandoned) {
      if (wanted.has(key) || cache.has(key)) continue; // re-requested or completed meanwhile
      for (const [id, entry] of pending) {
        if (entry.key === key) {
          pending.delete(id);
          entry.reject(new SimulationCancelledError());
          cancelledAny = true;
          break;
        }
      }
    }
    abandoned.clear();
    if (cancelledAny && worker) {
      worker.terminate();
      worker = null;
      for (const entry of pending.values()) getWorker().postMessage(entry.request);
    }
  }, CANCEL_DEBOUNCE_MS);
}

export function requestSimulation(
  site: LandingSite, startMs: number, endMs: number, config: MissionConfig,
  onProgress?: (p: SimulationProgress) => void,
): Promise<SimulationResult> {
  const key = simulationKey(site, startMs, endMs, config);
  wanted.set(key, (wanted.get(key) ?? 0) + 1);
  abandoned.delete(key); // re-requested before the debounced cancel fired — keep it
  const cached = cache.get(key);
  if (cached !== undefined) { touchCache(key); return Promise.resolve(cached); }
  const existing = inflight.get(key);
  if (existing) {
    if (onProgress) { for (const e of pending.values()) if (e.key === key) { e.onProgress = onProgress; break; } }
    return existing;
  }
  const promise = new Promise<SimulationResult>((resolve, reject) => {
    const id = nextId++;
    const request: SimulationRequest = { id, site, startMs, endMs, config };
    pending.set(id, {
      key, request, onProgress,
      resolve: (result) => {
        cache.set(key, result);
        evictCache();
        inflight.delete(key);
        resolve(result);
      },
      reject: (err) => {
        inflight.delete(key);
        reject(err);
      },
    });
    getWorker().postMessage(request);
  });
  inflight.set(key, promise);
  return promise;
}

/**
 * Release a consumer's interest in a key. When the last consumer abandons a still-
 * pending request, cancel it (reject + remove) and respawn the worker so no compute is
 * wasted on a superseded window. Cached results are kept for reuse.
 */
export function releaseSimulation(site: LandingSite, startMs: number, endMs: number, config: MissionConfig): void {
  const key = simulationKey(site, startMs, endMs, config);
  const n = (wanted.get(key) ?? 1) - 1;
  if (n > 0) { wanted.set(key, n); return; }
  wanted.delete(key);
  if (cache.has(key)) { touchCache(key); return; }
  // Last consumer left a still-pending request: mark abandoned and reconcile shortly.
  // A re-request within the debounce window cancels the cancellation (see scheduleReconcile).
  if (inflight.has(key)) { abandoned.add(key); scheduleReconcile(); }
}

export function cachedSimulation(site: LandingSite, startMs: number, endMs: number, config: MissionConfig): SimulationResult | undefined {
  const key = simulationKey(site, startMs, endMs, config);
  const v = cache.get(key);
  if (v !== undefined) touchCache(key);
  return v;
}

/** Test/introspection helpers (not used by the UI). */
export function _cacheStats() { return { size: cache.size, pending: pending.size, inflight: inflight.size, wanted: wanted.size }; }
export function _resetSimulationClient() {
  worker?.terminate();
  worker = null;
  pending.clear(); cache.clear(); inflight.clear(); wanted.clear(); abandoned.clear();
  nextId = 1; reconcileScheduled = false;
}
