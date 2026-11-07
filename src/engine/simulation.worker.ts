import type { LandingSite, MissionConfig, SimulationResult } from '../types/mission';
import { simulateMission } from './simulation';

export interface SimulationRequest {
  id: number;
  site: LandingSite;
  startMs: number;
  endMs: number;
  config: MissionConfig;
}

export interface SimulationProgressMessage {
  progress: number; // request id
  phase: 'sampling' | 'transitions' | 'energy' | 'summary';
  fraction: number;
}

export interface SimulationResponse {
  id: number;
  ok: boolean;
  result?: SimulationResult;
  error?: string;
}

export type WorkerOutbound = SimulationResponse | SimulationProgressMessage;

self.onmessage = (event: MessageEvent<SimulationRequest>) => {
  const { id, site, startMs, endMs, config } = event.data;
  const post = (msg: WorkerOutbound) => (self as unknown as Worker).postMessage(msg);
  try {
    // Progress messages reach the main thread in real time even though this loop is
    // synchronous: postMessage queues to the main thread, whose event loop is free.
    const result = simulateMission(site, startMs, endMs, config, (p) => post({ progress: id, phase: p.phase, fraction: p.fraction }));
    post({ id, ok: true, result });
  } catch (err) {
    post({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
