import { useEffect, useState } from 'react';
import type { LandingSite, MissionConfig, SimulationResult } from '../types/mission';
import { cachedSimulation, requestSimulation, releaseSimulation } from '../engine/simulationClient';
import { simulationKey, type SimulationProgress } from '../engine/simulation';

export interface SimulationState {
  data: SimulationResult | null;
  loading: boolean;
  error: string | null;
  progress: SimulationProgress | null;
}

/**
 * Results are keyed to the exact input configuration (site, terrain + frame,
 * UTC interval, and mission config). A cache miss for the CURRENT key never keeps
 * the previous scenario's data on screen — the hook returns cached-or-null for the
 * active key, so a date/site change can never show stale results. Superseded
 * requests are guarded by the `active` flag, released for cancellation, and can
 * never overwrite a newer key. Phase progress is surfaced while a window computes.
 */
export function useSimulation(site: LandingSite, startMs: number, endMs: number, config: MissionConfig): SimulationState {
  const key = simulationKey(site, startMs, endMs, config);
  const [state, setState] = useState<SimulationState & { key: string }>(() => {
    const cached = cachedSimulation(site, startMs, endMs, config);
    return { key, data: cached ?? null, loading: !cached, error: null, progress: null };
  });

  useEffect(() => {
    let active = true;
    const cached = cachedSimulation(site, startMs, endMs, config);
    if (cached) {
      setState({ key, data: cached, loading: false, error: null, progress: null });
      return;
    }
    // Cache miss for THIS key: clear any previous scenario's data immediately.
    setState({ key, data: null, loading: true, error: null, progress: null });
    requestSimulation(site, startMs, endMs, config, (p) => {
      if (active) setState((s) => (s.key === key ? { ...s, progress: p } : s));
    })
      .then((result) => { if (active) setState({ key, data: result, loading: false, error: null, progress: null }); })
      .catch((err) => {
        if (active && err?.name !== 'SimulationCancelledError') {
          setState({ key, data: null, loading: false, error: err instanceof Error ? err.message : String(err), progress: null });
        }
      });
    return () => { active = false; releaseSimulation(site, startMs, endMs, config); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Render-time guard: if the key changed before the effect ran, never return data
  // belonging to a different key (eliminates the one-frame stale window).
  if (state.key !== key) {
    const cached = cachedSimulation(site, startMs, endMs, config);
    return { data: cached ?? null, loading: !cached, error: null, progress: null };
  }
  return { data: state.data, loading: state.loading, error: state.error, progress: state.progress };
}
