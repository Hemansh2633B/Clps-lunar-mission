import type { LandingSite, MissionConfig, SimulationResult } from '../types/mission';
import { simulateMission } from './simulation';

export interface SimulationRequest {
  id: number;
  site: LandingSite;
  startMs: number;
  endMs: number;
  config: MissionConfig;
}

export interface SimulationResponse {
  id: number;
  ok: boolean;
  result?: SimulationResult;
  error?: string;
}

self.onmessage = (event: MessageEvent<SimulationRequest>) => {
  const { id, site, startMs, endMs, config } = event.data;
  try {
    const result = simulateMission(site, startMs, endMs, config);
    (self as unknown as Worker).postMessage({ id, ok: true, result } satisfies SimulationResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies SimulationResponse);
  }
};
