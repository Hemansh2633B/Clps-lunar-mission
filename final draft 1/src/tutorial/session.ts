/**
 * Persisted training-session snapshot for THE 14-DAY WINDOW.
 *
 * While the briefing's training mission is loaded, the user's own workspace is
 * REPLACED, not merged. This module persists both sides so a refresh can restore
 * the exact training context (chapter 5 slip, chapter 7 pins, …) and exiting can
 * restore the user's exact prior workspace — site, dates, config, view, pins,
 * custom sites and playback.
 *
 * Safety rules:
 * - Versioned key (`chandra-story-session-v1`); strict shape validation. A corrupt
 *   or unknown-version payload parses to null (never throws, never half-applies).
 * - Backward compatible with v1.8 progress (`chandra-story-v1`): progress saved
 *   before sessions existed still loads; the missing session is detected as LOST
 *   CONTEXT and the UI offers an explicit recovery path instead of resuming
 *   chapter 6/7 against unrelated defaults.
 * - Nothing here touches mission math; it only moves already-validated app state.
 */
import type { AppMode, LandingSite, MissionConfig, Scenario } from '../types/mission';
import { LANDING_SITES } from '../data/landingSites';

export const SESSION_VERSION = 1 as const;
export const SESSION_STORAGE_KEY = 'chandra-story-session-v1';

/** Complete restorable mission workspace (all fields JSON-safe). */
export interface WorkspaceSnapshot {
  selectedId: string;
  baselineMs: number;
  slipDays: number;
  config: MissionConfig;
  viewDays: number;
  timeMs: number;
  mode: AppMode;
  compareMode: boolean;
  terrainView: boolean;
  spaceView: boolean;
  scenarios: Scenario[];
  playing: boolean;
  speed: number;
  /** User-created sites (catalog sites are code, never persisted). */
  customSites: LandingSite[];
}

/**
 * The active chapter's witness baseline, persisted so a refresh does not void
 * work already done (e.g. the chapter-5 slip change still differs from the
 * chapter-start value after reload). Export credit is intentionally NOT restored:
 * after a refresh the report must be filed again in the new page session.
 */
export interface SessionBaseline {
  chapter: number;
  selectedId: string;
  timeMs: number;
  slipDays: number;
  configKey: string;
  reportExportCount: number;
  scenarioIds: string[];
}

export interface TrainingSession {
  v: typeof SESSION_VERSION;
  /** The user's workspace at training start — restored on exit/finish. */
  user: WorkspaceSnapshot;
  /** The live training workspace — updated (debounced) as the user works. */
  training: WorkspaceSnapshot;
  /** Witness baseline of the active chapter (optional for forward compat). */
  baseline?: SessionBaseline | null;
}

const ARRAY_MODES = new Set(['horizontal', 'vertical-tracking', 'vertical-fixed']);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function validConfig(c: unknown): c is MissionConfig {
  if (typeof c !== 'object' || c === null) return false;
  const o = c as Record<string, unknown>;
  const numeric = ['durationDays', 'arrayAreaM2', 'cellEfficiency', 'systemDerate', 'fixedPanelAzimuthDeg', 'loadW', 'batteryCapacityKWh', 'initialSocPct', 'commsMarginDeg', 'stepMinutes'];
  if (!numeric.every((k) => finite(o[k]))) return false;
  if (typeof o.arrayMode !== 'string' || !ARRAY_MODES.has(o.arrayMode)) return false;
  const d = o.durationDays as number;
  const step = o.stepMinutes as number;
  return d > 0 && d <= 366 && step > 0 && step <= 1440;
}

function validScenario(s: unknown): s is Scenario {
  if (typeof s !== 'object' || s === null) return false;
  const o = s as Record<string, unknown>;
  return typeof o.id === 'string' && o.id.length > 0
    && typeof o.siteId === 'string' && o.siteId.length > 0
    && finite(o.startMs) && validConfig(o.config)
    && (o.label === undefined || typeof o.label === 'string');
}

/** Custom sites are app-authored JSON; validate the fields the planner reads. */
function validSite(s: unknown): s is LandingSite {
  if (typeof s !== 'object' || s === null) return false;
  const o = s as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string' || typeof o.shortName !== 'string') return false;
  if (!finite(o.latitude) || !finite(o.longitude) || !finite(o.elevationM)) return false;
  if (Math.abs(o.latitude as number) > 90 || (o.longitude as number) < -360 || (o.longitude as number) > 720) return false;
  if (typeof o.region !== 'string' || typeof o.description !== 'string' || typeof o.accent !== 'string') return false;
  if (o.category !== 'polar' && o.category !== 'reference') return false;
  const t = o.terrain as Record<string, unknown> | undefined;
  if (typeof t !== 'object' || t === null) return false;
  if (!['illustrative', 'flat', 'dem', 'custom'].includes(String(t.kind))) return false;
  if (!finite(t.resolutionDeg) || !finite(t.uncertaintyDeg) || !finite(t.eyeHeightM)) return false;
  if (!Array.isArray(t.elevations) || !t.elevations.every(finite)) return false;
  if (!Array.isArray(t.features)) return false;
  return (t.features as unknown[]).every((f) => {
    if (typeof f !== 'object' || f === null) return false;
    const g = f as Record<string, unknown>;
    return typeof g.name === 'string' && finite(g.azimuthDeg) && finite(g.elevationDeg) && finite(g.widthDeg)
      && ['massif', 'rim', 'saddle', 'drop'].includes(String(g.kind));
  });
}

function validBaseline(b: unknown): b is SessionBaseline {
  if (typeof b !== 'object' || b === null) return false;
  const o = b as Record<string, unknown>;
  return Number.isInteger(o.chapter) && (o.chapter as number) >= 0 && (o.chapter as number) <= 8
    && typeof o.selectedId === 'string' && finite(o.timeMs) && finite(o.slipDays)
    && typeof o.configKey === 'string' && finite(o.reportExportCount)
    && Array.isArray(o.scenarioIds) && o.scenarioIds.every((x) => typeof x === 'string');
}

function validWorkspace(w: unknown): w is WorkspaceSnapshot {
  if (typeof w !== 'object' || w === null) return false;
  const o = w as Record<string, unknown>;
  if (typeof o.selectedId !== 'string' || o.selectedId.length === 0) return false;
  if (!finite(o.baselineMs) || !finite(o.slipDays) || !finite(o.timeMs) || !finite(o.viewDays) || !finite(o.speed)) return false;
  if ((o.viewDays as number) <= 0 || (o.viewDays as number) > 366 || (o.speed as number) <= 0) return false;
  if (!validConfig(o.config)) return false;
  if (o.mode !== 'planner' && o.mode !== 'educator') return false;
  if (typeof o.compareMode !== 'boolean' || typeof o.terrainView !== 'boolean' || typeof o.spaceView !== 'boolean' || typeof o.playing !== 'boolean') return false;
  if (!Array.isArray(o.scenarios) || o.scenarios.length > 4 || !o.scenarios.every(validScenario)) return false;
  if (!Array.isArray(o.customSites) || o.customSites.length > 64 || !o.customSites.every(validSite)) return false;
  const ids = new Set([...LANDING_SITES.map((s) => s.id), ...(o.customSites as LandingSite[]).map((s) => s.id)]);
  if (!ids.has(o.selectedId as string)) return false;
  return (o.scenarios as Scenario[]).every((s) => ids.has(s.siteId));
}

/** Strict parse: wrong version / shape → null, never a throw, never partial. */
export function parseSession(raw: string | null): TrainingSession | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<TrainingSession>;
    if (p.v !== SESSION_VERSION) return null;
    if (!validWorkspace(p.user) || !validWorkspace(p.training)) return null;
    if (p.baseline !== undefined && p.baseline !== null && !validBaseline(p.baseline)) return null;
    return { v: SESSION_VERSION, user: p.user, training: p.training, baseline: p.baseline ?? null };
  } catch {
    return null;
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function loadSession(storage: StorageLike | null): TrainingSession | null {
  if (!storage) return null;
  try { return parseSession(storage.getItem(SESSION_STORAGE_KEY)); } catch { return null; }
}

export function saveSession(s: TrainingSession, storage: StorageLike | null): void {
  if (!storage) return;
  try { storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s)); } catch { /* storage full/unavailable — in-memory session still works */ }
}

export function clearSession(storage: StorageLike | null): void {
  if (!storage) return;
  try { storage.removeItem(SESSION_STORAGE_KEY); } catch { /* unavailable */ }
}

/**
 * Decide what the app boots into after a refresh. Pure + unit-tested.
 * - training: valid session + progress inside the training chapters → restore the
 *   training workspace exactly (panel stays closed; the launcher offers Resume).
 * - user: session exists but progress is gone/completed/inconsistent → restore the
 *   USER workspace (their data is never sacrificed) and drop the session.
 * - default: no session. If progress still points into training chapters, the hook
 *   surfaces `recoveryNeeded` so resuming offers Rebuild / Exit — never silently
 *   continues chapter 6/7 on unrelated defaults.
 */
export function resolveBoot(
  session: TrainingSession | null,
  progress: { status: string; chapter: number } | null,
): { boot: 'training' | 'user' | 'default'; workspace: WorkspaceSnapshot | null; keepSession: boolean } {
  if (!session) return { boot: 'default', workspace: null, keepSession: false };
  const inTraining = progress !== null && (progress.status === 'active' || progress.status === 'paused') && progress.chapter >= 1;
  if (inTraining) return { boot: 'training', workspace: session.training, keepSession: true };
  return { boot: 'user', workspace: session.user, keepSession: false };
}

/** True when saved progress expects a training workspace that no longer exists. */
export function sessionContextLost(
  session: TrainingSession | null,
  progress: { status: string; chapter: number } | null,
): boolean {
  return session === null && progress !== null
    && (progress.status === 'active' || progress.status === 'paused')
    && progress.chapter >= 1;
}
