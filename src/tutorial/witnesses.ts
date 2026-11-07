/**
 * Pure objective witnesses for THE 14-DAY WINDOW.
 *
 * These functions are the ONLY place completion semantics live, so they can be
 * unit-tested without React or a browser. They never trust panel clicks: credit
 * comes from real application state (scenarios actually created, exports actually
 * downloaded) and from the same validity gates the instruments use.
 */
import type { MissionConfig, Scenario } from '../types/mission';

/**
 * Content fingerprint of a scenario — everything that changes the computed
 * result (site, window start, full config). Two pins with the same fingerprint
 * are the same experiment repeated, not a comparison.
 */
export function scenarioFingerprint(s: Pick<Scenario, 'siteId' | 'startMs' | 'config'>): string {
  const cfg = s.config as unknown as Record<string, unknown>;
  const body = Object.keys(cfg).sort().map((k) => `${k}=${String(cfg[k])}`).join(';');
  return `${s.siteId}|${s.startMs}|${body}`;
}

export interface ScenarioResolution {
  /** The simulation request settled (result or error) — not still computing. */
  resolved: boolean;
  /** Settled with a demo-eligible analysis AND a quantitative summary. */
  eligible: boolean;
}

export interface ComparisonWitnessInput {
  /** IDs of the user's own pins preserved in the training-session snapshot. */
  userScenarioIds: readonly string[];
  /** Scenario IDs recorded when chapter 7 became active (audit baseline). */
  chapterBaselineIds: readonly string[];
  /** Current scenarios in the (isolated) training workspace. */
  scenarios: readonly Scenario[];
  /** Resolved simulation state per scenario id (missing entry = unresolved). */
  resolutions: Readonly<Record<string, ScenarioResolution>>;
  compareMode: boolean;
  /** A training session must be active — chapter ≥ 1 always implies one. */
  trainingActive: boolean;
}

export interface ComparisonWitnessResult {
  met: boolean;
  /** New (tutorial-created), pairwise-distinct, resolved & eligible scenarios. */
  distinctValid: Scenario[];
  /** Tutorial-created scenarios still computing. */
  pending: number;
  /** Tutorial-created scenarios whose analysis is blocked or failed. */
  blocked: number;
  /** Distinct tutorial-created scenarios regardless of resolution. */
  distinctNew: Scenario[];
}

/**
 * Chapter 7 credit requires ≥2 meaningfully distinct scenarios CREATED DURING the
 * training session, resolved to valid analyses, with the comparison view open.
 *
 * - The training workspace is isolated (the user's pins live in the session
 *   snapshot), and `userScenarioIds` is a second line of defense: pre-tutorial
 *   pins can never count even if isolation were bypassed.
 * - The chapter-start baseline is recorded for audit; pins created earlier in the
 *   same training journey DO count (they are tutorial work), which also keeps the
 *   witness stable across refresh/resume.
 * - Identical repeats dedupe by content fingerprint.
 * - A pin rejected by the 4-scenario cap never enters `scenarios`, so it cannot count.
 * - Opening the comparison view alone (0/1 scenarios, unresolved, or blocked) never counts.
 */
export function comparisonWitness(i: ComparisonWitnessInput): ComparisonWitnessResult {
  const userIds = new Set(i.userScenarioIds);
  const seen = new Set<string>();
  const distinctNew: Scenario[] = [];
  for (const s of i.scenarios) {
    if (userIds.has(s.id)) continue;
    const fp = scenarioFingerprint(s);
    if (seen.has(fp)) continue;
    seen.add(fp);
    distinctNew.push(s);
  }
  let pending = 0;
  let blocked = 0;
  const distinctValid: Scenario[] = [];
  for (const s of distinctNew) {
    const r = i.resolutions[s.id];
    if (!r || !r.resolved) { pending += 1; continue; }
    if (!r.eligible) { blocked += 1; continue; }
    distinctValid.push(s);
  }
  const met = i.trainingActive && i.compareMode && distinctValid.length >= 2;
  return { met, distinctValid, pending, blocked, distinctNew };
}

/**
 * Chapter 8 credit: ONLY a guard-passing JSON mission report whose download was
 * successfully INITIATED (the anchor dispatch returned without throwing).
 * Page script cannot observe the browser's final save dialog, so this never
 * claims the user physically saved the file — browser automation separately
 * asserts real Playwright download events. CSV exports (timeseries/horizon/
 * summary/events/energy) never count. `gateOk` comes from missionExportGate;
 * blocked/stale/computing exports never reach the download.
 */
export function creditsMissionReport(
  kind: 'json' | 'timeseries' | 'horizon' | 'summary' | 'events' | 'energy',
  gateOk: boolean,
  downloadInitiated: boolean,
): boolean {
  return kind === 'json' && gateOk && downloadInitiated;
}

/** Deep-equal mission configs via the same stable serialization as fingerprints. */
export function sameConfig(a: MissionConfig, b: MissionConfig): boolean {
  return scenarioFingerprint({ siteId: '', startMs: 0, config: a }) === scenarioFingerprint({ siteId: '', startMs: 0, config: b });
}
