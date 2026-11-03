import { useEffect, useState } from 'react';
import type { LandingSite, MissionConfig, SimulationResult } from '../types/mission';
import { cachedSimulation, requestSimulation } from '../engine/simulationClient';
import { simulationKey } from '../engine/simulation';

export interface SimulationState {
  data: SimulationResult | null;
  loading: boolean;
  error: string | null;
}

export function useSimulation(site: LandingSite, startMs: number, endMs: number, config: MissionConfig): SimulationState {
  const key = simulationKey(site, startMs, endMs, config);
  const [state, setState] = useState<SimulationState>(() => ({
    data: cachedSimulation(site, startMs, endMs, config) ?? null,
    loading: !cachedSimulation(site, startMs, endMs, config),
    error: null,
  }));

  useEffect(() => {
    let active = true;
    const cached = cachedSimulation(site, startMs, endMs, config);
    if (cached) {
      setState({ data: cached, loading: false, error: null });
      return;
    }
    setState((s) => ({ data: s.data, loading: true, error: null }));
    requestSimulation(site, startMs, endMs, config)
      .then((result) => { if (active) setState({ data: result, loading: false, error: null }); })
      .catch((err) => { if (active) setState({ data: null, loading: false, error: err instanceof Error ? err.message : String(err) }); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
