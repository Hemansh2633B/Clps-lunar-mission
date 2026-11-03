import type { LandingSite, MissionConfig, SimulationResult } from '../types/mission';
import { simulationKey } from './simulation';
import type { SimulationRequest, SimulationResponse } from './simulation.worker';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: SimulationResult) => void; reject: (e: Error) => void }>();
const cache = new Map<string, SimulationResult>();
const inflight = new Map<string, Promise<SimulationResult>>();
const CACHE_LIMIT = 36;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<SimulationResponse>) => {
      const { id, ok, result, error } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (ok && result) entry.resolve(result);
      else entry.reject(new Error(error || 'Simulation failed'));
    };
    worker.onerror = (event) => {
      for (const [, entry] of pending) entry.reject(new Error(event.message || 'Simulation worker error'));
      pending.clear();
    };
  }
  return worker;
}

export function requestSimulation(site: LandingSite, startMs: number, endMs: number, config: MissionConfig): Promise<SimulationResult> {
  const key = simulationKey(site, startMs, endMs, config);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = new Promise<SimulationResult>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, {
      resolve: (result) => {
        cache.set(key, result);
        if (cache.size > CACHE_LIMIT) {
          const first = cache.keys().next().value;
          if (first) cache.delete(first);
        }
        inflight.delete(key);
        resolve(result);
      },
      reject: (err) => {
        inflight.delete(key);
        reject(err);
      },
    });
    const request: SimulationRequest = { id, site, startMs, endMs, config };
    getWorker().postMessage(request);
  });
  inflight.set(key, promise);
  return promise;
}

export function cachedSimulation(site: LandingSite, startMs: number, endMs: number, config: MissionConfig): SimulationResult | undefined {
  return cache.get(simulationKey(site, startMs, endMs, config));
}
