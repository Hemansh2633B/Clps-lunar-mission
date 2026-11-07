/**
 * Guarded mission exports — the single decision point used by App.handleExport.
 *
 * The tutorial's final objective and the toolbar share this gate, so a CSV export,
 * an in-flight window, a stale result or a blocked analysis can never be mistaken
 * for a filed mission report. Pure and unit-testable.
 *
 * v1.10 defense in depth: beyond site id + exact window, the gate verifies FULL
 * analysis identity via the SAME `simulationKey()` the useSimulation hook and the
 * cache use (site + terrain elevations/frame/coverage + effective config). A result
 * computed for a different configuration or an edited terrain can never export,
 * and a degraded transition resolution can never present as a complete report.
 */
import type { LandingSite, MissionConfig, SimulationResult } from '../types/mission';
import { simulationKey } from '../engine/simulation';
import { sanitizeConfig } from '../engine/configLimits';

export type ExportKind = 'json' | 'timeseries' | 'horizon' | 'summary' | 'events' | 'energy';

export interface ExportGateInput {
  kind: ExportKind;
  loading: boolean;
  error: string | null;
  sim: SimulationResult | null;
  expectedSiteId: string;
  expectedStartMs: number;
  expectedEndMs: number;
  /** Full current site identity (terrain included) — simulationKey comparison. */
  expectedSite: LandingSite;
  /** Current requested config; sanitized before comparison (the engine sanitizes too). */
  expectedConfig: MissionConfig;
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
  // A numerical-resolution failure must never present as a complete mission report,
  // even if a bypassed path supplied an eligible-looking assessment.
  if (i.sim.transitionDiagnostics.resolutionStatus === 'degraded') {
    return { ok: false, code: 'blocked', reason: 'Export blocked — the transition detector left intervals unresolved (NUMERICAL_RESOLUTION_INSUFFICIENT). Shorten the window or refine the sample step, then re-run.' };
  }
  // Defense in depth against staleness: the result must belong to the CURRENT
  // site and mission window (the hook already keys data, this catches bypasses).
  const s = i.sim.summary;
  if (i.sim.site.id !== i.expectedSiteId || !s || s.startMs !== i.expectedStartMs || s.endMs !== i.expectedEndMs) {
    return { ok: false, code: 'stale', reason: 'The computed result does not match the current site/window — export blocked until the fresh result resolves.' };
  }
  // Full identity check via the SAME key the hook/cache uses: terrain identity
  // (elevations, frame, coverage), coordinates and EVERY effective config field.
  // Both sides use the sanitized config, so engine clamping never causes a false
  // mismatch — while a genuinely different configuration always does.
  const actualKey = simulationKey(i.sim.site, s.startMs, s.endMs, i.sim.config);
  const expectedKey = simulationKey(i.expectedSite, i.expectedStartMs, i.expectedEndMs, sanitizeConfig(i.expectedConfig));
  if (actualKey !== expectedKey) {
    return { ok: false, code: 'stale', reason: 'The computed result belongs to a different configuration or terrain identity — export blocked until the fresh result resolves.' };
  }
  return { ok: true };
}
