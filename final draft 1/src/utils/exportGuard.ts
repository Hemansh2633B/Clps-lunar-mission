/**
 * Guarded mission exports — the single decision point used by App.handleExport.
 *
 * The tutorial's final objective and the toolbar share this gate, so a CSV export,
 * an in-flight window, a stale result or a blocked analysis can never be mistaken
 * for a filed mission report. Pure and unit-testable.
 */
import type { SimulationResult } from '../types/mission';

export type ExportKind = 'json' | 'timeseries' | 'horizon' | 'summary';

export interface ExportGateInput {
  kind: ExportKind;
  loading: boolean;
  error: string | null;
  sim: SimulationResult | null;
  expectedSiteId: string;
  expectedStartMs: number;
  expectedEndMs: number;
  /** Horizon CSV carries instantaneous clearances — block at unvalidated epochs. */
  horizonInstantBlocked?: boolean;
}

export type ExportGateResult =
  | { ok: true }
  | { ok: false; code: 'computing' | 'error' | 'missing' | 'blocked' | 'stale'; reason: string };

export function missionExportGate(i: ExportGateInput): ExportGateResult {
  if (i.loading) {
    return { ok: false, code: 'computing', reason: 'Mission window is still computing — export blocked to avoid stale results.' };
  }
  if (i.error) {
    return { ok: false, code: 'error', reason: `Mission window failed (${i.error}) — nothing to export.` };
  }
  if (!i.sim) {
    return { ok: false, code: 'missing', reason: 'No computed mission window yet — nothing to export.' };
  }
  if (i.kind === 'horizon' && i.horizonInstantBlocked) {
    return { ok: false, code: 'blocked', reason: 'Horizon clearance export blocked — the frame correction is not validated at the current epoch. Scrub into the validated range.' };
  }
  if (!i.sim.analysis.demoEligible) {
    return { ok: false, code: 'blocked', reason: `Export blocked — analysis is ${i.sim.analysis.status}. Resolve the flagged issue before exporting.` };
  }
  // Defense in depth against staleness: the result must belong to the CURRENT
  // site and mission window (the hook already keys data, this catches bypasses).
  const s = i.sim.summary;
  if (i.sim.site.id !== i.expectedSiteId || !s || s.startMs !== i.expectedStartMs || s.endMs !== i.expectedEndMs) {
    return { ok: false, code: 'stale', reason: 'The computed result does not match the current site/window — export blocked until the fresh result resolves.' };
  }
  return { ok: true };
}
