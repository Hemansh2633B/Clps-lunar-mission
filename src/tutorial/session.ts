/**
 * Persisted training-session snapshot for THE 14-DAY WINDOW.
 *
 * While the briefing's training mission is loaded, the user's own workspace is
 * REPLACED, not merged. This module persists both sides so a refresh can restore
 * the exact training context (chapter 5 slip, chapter 7 pins, …) and exiting can
 * restore the user's exact prior workspace — site, dates, config, view, pins,
 * custom sites and playback.
 *
 * Safety rules (v1.10 hardened; v1.11 adds a pre-parse/pre-save size cap):
 * - Serialized payloads over MAX_SESSION_LENGTH are rejected before JSON.parse
 *   and before storage writes, with an explicit reason for the recovery notice.
 * - The storage key is a stable namespace; the PAYLOAD version (`v`) drives
 *   migration. v1 (v1.9) payloads migrate to v2 only if they pass the full
 *   current validation — never by silently clamping out-of-range values.
 * - Mission parameters are validated against the SHARED `MISSION_LIMITS` (the
 *   same source of truth as the UI and engine sanitization), not a duplicated,
 *   looser range list.
 * - Custom sites are deep-validated against the full LandingSite/TerrainProfile
 *   contract, including terrain array shape, feature objects, optional metadata
 *   types and frame-metadata consistency: a persisted `frameVerified` flag is
 *   re-checked against the frame allowlist (`classifyFrame`) and never trusted
 *   on its own.
 * - Duplicate site/scenario IDs, catalog collisions and dangling references are
 *   rejected. A corrupt, out-of-range or unknown-version payload parses to null
 *   (never throws, never half-applies) and the UI offers the explicit
 *   Rebuild / Exit recovery path.
 * - Backward compatible with v1.8 progress (`chandra-story-v1`): progress saved
 *   before sessions existed still loads; the missing session is detected as LOST
 *   CONTEXT and the UI offers recovery instead of resuming against defaults.
 * - Nothing here touches mission math; it only moves already-validated app state.
 */
import type { AppMode, LandingSite, MissionConfig, Scenario, TerrainProfile } from '../types/mission';
import { LANDING_SITES } from '../data/landingSites';
import { MISSION_LIMITS, validateConfig, type NumericConfigKey } from '../engine/configLimits';
import { classifyFrame } from '../engine/lunarFrame';

/** Payload schema version. v2 (v1.10): strict MISSION_LIMITS + deep site validation. */
export const SESSION_VERSION = 2 as const;
/** Stable storage namespace (kept across schema versions so v1 payloads are found and migrated). */
export const SESSION_STORAGE_KEY = 'chandra-story-session-v1';

/**
 * Maximum serialized payload length in JavaScript UTF-16 code units, checked
 * BEFORE JSON.parse. 800,000 characters is generous for ordinary briefing
 * workspaces while bounding parser work below typical localStorage quotas.
 * It is intentionally below the theoretical structural maximum: two snapshots
 * × 64 custom sites × 3,601 elevations × ~24 characters ≈ 11 million characters
 * before metadata. A payload above this limit is rejected explicitly, never
 * clamped or partially restored. The same limit is enforced before saving.
 */
export const MAX_SESSION_LENGTH = 800_000;

export type SessionRejectionCode = 'SESSION_TOO_LARGE' | 'SESSION_INVALID' | 'SESSION_STORAGE_UNAVAILABLE';
export interface SessionRejection { code: SessionRejectionCode; message: string }
export type SessionReadResult = { session: TrainingSession; rejection: null } | { session: null; rejection: SessionRejection | null };
export type SessionSaveResult = { ok: true } | { ok: false; rejection: SessionRejection };

const INVALID_SESSION: SessionRejection = {
  code: 'SESSION_INVALID',
  message: 'A saved briefing session could not be restored — it failed validation (corrupt, out-of-range settings or inconsistent terrain metadata). Nothing was partially applied; the briefing offers Rebuild / Exit.',
};
function tooLarge(length: number): SessionRejection {
  return {
    code: 'SESSION_TOO_LARGE',
    message: `A saved briefing session is too large to restore safely (${length.toLocaleString()} characters; limit ${MAX_SESSION_LENGTH.toLocaleString()}). Nothing was applied. The briefing offers Rebuild / Exit; your current workspace is unchanged.`,
  };
}

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
const str = (x: unknown): x is string => typeof x === 'string';
const optStr = (x: unknown): boolean => x === undefined || str(x);
const optFinite = (x: unknown): boolean => x === undefined || finite(x);
const inRange = (x: number, min: number, max: number): boolean => x >= min && x <= max;
/** Valid JS Date epoch range. */
const dateMs = (x: unknown): x is number => finite(x) && Math.abs(x) <= 8.64e15;

/**
 * Mission config validation uses the SHARED application limits — the same
 * MISSION_LIMITS the settings form enforces and the engine sanitizes against.
 * No duplicated (and historically looser) ranges live here.
 */
function validConfig(c: unknown): c is MissionConfig {
  if (typeof c !== 'object' || c === null) return false;
  const o = c as Record<string, unknown>;
  for (const key of Object.keys(MISSION_LIMITS) as NumericConfigKey[]) {
    if (!finite(o[key])) return false;
  }
  if (!str(o.arrayMode) || !ARRAY_MODES.has(o.arrayMode)) return false;
  return validateConfig(c as MissionConfig).length === 0;
}

function validScenario(s: unknown): s is Scenario {
  if (typeof s !== 'object' || s === null) return false;
  const o = s as Record<string, unknown>;
  return str(o.id) && o.id.length > 0
    && str(o.siteId) && o.siteId.length > 0
    && dateMs(o.startMs) && validConfig(o.config)
    && (o.label === undefined || str(o.label));
}

const TERRAIN_KINDS = new Set(['illustrative', 'flat', 'dem', 'custom']);
const FEATURE_KINDS = new Set(['massif', 'rim', 'saddle', 'drop']);
const FRAME_TRANSFORMS = new Set(['me', 'pa', 'iau']);
const COORD_TYPES = new Set(['region-center', 'representative-point', 'surveyed', 'custom']);
const CONFIDENCE_TIERS = new Set(['measured', 'illustrative', 'synthetic', 'region-approximate']);
const MAX_ELEVATIONS = 3601; // 0.1° resolution incl. wrap point — the app never produces finer
const MAX_FEATURES = 64;

/** Deep terrain validation against the full TerrainProfile contract. */
function validTerrain(t: unknown): t is TerrainProfile {
  if (typeof t !== 'object' || t === null) return false;
  const o = t as Record<string, unknown>;
  if (!str(o.label)) return false;
  if (!str(o.kind) || !TERRAIN_KINDS.has(o.kind)) return false;
  if (!finite(o.resolutionDeg) || !inRange(o.resolutionDeg, 0.1, 90)) return false;
  const bins = 360 / o.resolutionDeg;
  if (Math.abs(bins - Math.round(bins)) > 1e-9) return false; // azimuth step must divide the circle
  if (!Array.isArray(o.elevations) || o.elevations.length > MAX_ELEVATIONS) return false;
  // Profiles are either exactly 360/resolution bins (DEM masks) or include the
  // 360° wrap point (illustrative/custom builders) — nothing else is app-authored.
  if (o.elevations.length !== Math.round(bins) && o.elevations.length !== Math.round(bins) + 1) return false;
  if (!o.elevations.every((h) => finite(h) && inRange(h, -90, 90))) return false;
  if (!finite(o.uncertaintyDeg) || !inRange(o.uncertaintyDeg, 0, 90)) return false;
  if (!finite(o.eyeHeightM) || !inRange(o.eyeHeightM, 0, 1000)) return false;
  if (!Array.isArray(o.features) || o.features.length > MAX_FEATURES) return false;
  const featuresOk = (o.features as unknown[]).every((f) => {
    if (typeof f !== 'object' || f === null) return false;
    const g = f as Record<string, unknown>;
    return str(g.name) && finite(g.azimuthDeg) && inRange(g.azimuthDeg, -720, 720)
      && finite(g.elevationDeg) && inRange(g.elevationDeg, -90, 90)
      && finite(g.widthDeg) && g.widthDeg > 0 && g.widthDeg <= 360
      && str(g.kind) && FEATURE_KINDS.has(g.kind);
  });
  if (!featuresOk) return false;
  // Optional metadata: types + sane ranges (undefined allowed, null is not app-authored).
  if (!optStr(o.sourceFrame) || !optStr(o.sourceFile) || !optStr(o.frameNote) || !optStr(o.accuracyNote) || !optStr(o.productVersion)) return false;
  if (o.synthetic !== undefined && typeof o.synthetic !== 'boolean') return false;
  if (o.frameVerified !== undefined && typeof o.frameVerified !== 'boolean') return false;
  if (o.frameTransform !== undefined && o.frameTransform !== null && (!str(o.frameTransform) || !FRAME_TRANSFORMS.has(o.frameTransform))) return false;
  if (o.analysisScale !== undefined && o.analysisScale !== 'local') return false; // regional is NOT implemented — never accepted from storage
  if (!optFinite(o.coveragePercent) || (o.coveragePercent !== undefined && !inRange(o.coveragePercent as number, 0, 100))) return false;
  for (const k of ['radiusKm', 'horizonRadiusKm', 'effectiveResolutionM', 'regionalRadiusKm']) {
    const v = o[k];
    if (v !== undefined && (!finite(v) || (v as number) <= 0 || (v as number) > 100000)) return false;
  }
  if (o.gridSize !== undefined && (!Number.isInteger(o.gridSize) || !inRange(o.gridSize as number, 2, 8192))) return false;
  if (o.samplingDeg !== undefined && (!finite(o.samplingDeg) || !inRange(o.samplingDeg as number, 0.01, 90))) return false;
  if (o.frameResidualDeg !== undefined && (!finite(o.frameResidualDeg) || !inRange(o.frameResidualDeg as number, 0, 10))) return false;
  if (o.azimuthOffsetDeg !== undefined && (!finite(o.azimuthOffsetDeg) || !inRange(o.azimuthOffsetDeg as number, -360, 360))) return false;
  if (o.verticalUncertaintyM !== undefined && (!finite(o.verticalUncertaintyM) || !inRange(o.verticalUncertaintyM as number, 0, 10000))) return false;
  // Frame-metadata consistency: a persisted frameVerified flag is NEVER trusted
  // over contradictory metadata. Re-derive recognition from the allowlist.
  if (o.kind === 'dem' && o.synthetic !== true && o.frameVerified === true) {
    const cls = classifyFrame(str(o.sourceFrame) ? o.sourceFrame : undefined);
    if (!cls.recognized || cls.transform !== o.frameTransform) return false;
    if ((o.frameTransform === 'me' || o.frameTransform === 'pa')
      && (!finite(o.frameResidualDeg) || !finite(o.azimuthOffsetDeg))) return false;
  }
  return true;
}

/** Custom sites are app-authored JSON; validate the FULL LandingSite contract. */
function validSite(s: unknown): s is LandingSite {
  if (typeof s !== 'object' || s === null) return false;
  const o = s as Record<string, unknown>;
  if (!str(o.id) || o.id.length === 0 || !str(o.name) || !str(o.shortName)) return false;
  if (!finite(o.latitude) || !inRange(o.latitude, -90, 90)) return false;
  if (!finite(o.longitude) || !inRange(o.longitude, -360, 720)) return false;
  if (!finite(o.elevationM) || !inRange(o.elevationM, -20000, 20000)) return false;
  if (!str(o.region) || !str(o.description) || !str(o.accent)) return false;
  if (o.category !== 'polar' && o.category !== 'reference') return false;
  if (o.custom !== undefined && typeof o.custom !== 'boolean') return false;
  if (!optStr(o.program) || !optStr(o.coordinateProvenance) || !optStr(o.elevationProvenance) || !optStr(o.sourceUrl) || !optStr(o.sourceDate)) return false;
  if (o.coordinateType !== undefined && (!str(o.coordinateType) || !COORD_TYPES.has(o.coordinateType))) return false;
  if (o.coordinateUncertaintyDeg !== undefined && (!finite(o.coordinateUncertaintyDeg) || !inRange(o.coordinateUncertaintyDeg as number, 0, 180))) return false;
  if (o.dataConfidence !== undefined && (!str(o.dataConfidence) || !CONFIDENCE_TIERS.has(o.dataConfidence))) return false;
  if (!validTerrain(o.terrain)) return false;
  // Synthetic/real consistency: procedural terrain can never claim measured confidence.
  const t = o.terrain as TerrainProfile;
  if (t.synthetic === true && o.dataConfidence === 'measured') return false;
  return true;
}

function validBaseline(b: unknown): b is SessionBaseline {
  if (typeof b !== 'object' || b === null) return false;
  const o = b as Record<string, unknown>;
  return Number.isInteger(o.chapter) && (o.chapter as number) >= 0 && (o.chapter as number) <= 8
    && str(o.selectedId) && finite(o.timeMs) && finite(o.slipDays)
    && str(o.configKey) && finite(o.reportExportCount)
    && Array.isArray(o.scenarioIds) && o.scenarioIds.every((x) => str(x));
}

const CATALOG_IDS = new Set(LANDING_SITES.map((s) => s.id));
const MAX_CUSTOM_SITES = 64;
const MAX_SCENARIOS = 4;

function validWorkspace(w: unknown): w is WorkspaceSnapshot {
  if (typeof w !== 'object' || w === null) return false;
  const o = w as Record<string, unknown>;
  if (!str(o.selectedId) || o.selectedId.length === 0) return false;
  if (!dateMs(o.baselineMs) || !dateMs(o.timeMs)) return false;
  if (!finite(o.slipDays) || !inRange(o.slipDays, 0, 60)) return false; // the slip slider's real range
  if (!finite(o.viewDays) || !inRange(o.viewDays, 1, 366)) return false;
  if (!finite(o.speed) || o.speed <= 0 || o.speed > 604800) return false; // playback caps at 7 d/s
  if (!validConfig(o.config)) return false;
  if (o.mode !== 'planner' && o.mode !== 'educator') return false;
  if (typeof o.compareMode !== 'boolean' || typeof o.terrainView !== 'boolean' || typeof o.spaceView !== 'boolean' || typeof o.playing !== 'boolean') return false;
  if (!Array.isArray(o.scenarios) || o.scenarios.length > MAX_SCENARIOS || !o.scenarios.every(validScenario)) return false;
  if (!Array.isArray(o.customSites) || o.customSites.length > MAX_CUSTOM_SITES || !o.customSites.every(validSite)) return false;
  const custom = o.customSites as LandingSite[];
  const customIds = custom.map((s) => s.id);
  if (new Set(customIds).size !== customIds.length) return false; // duplicate custom IDs
  if (customIds.some((id) => CATALOG_IDS.has(id))) return false; // catalog collision
  const scenarioIds = (o.scenarios as Scenario[]).map((s) => s.id);
  if (new Set(scenarioIds).size !== scenarioIds.length) return false; // duplicate scenario IDs
  const ids = new Set([...CATALOG_IDS, ...customIds]);
  if (!ids.has(o.selectedId as string)) return false;
  return (o.scenarios as Scenario[]).every((s) => ids.has(s.siteId));
}

/**
 * Strict parse with explicit version migration. v1 (v1.9) payloads have the same
 * shape as v2, so migration is safe REVALIDATION: a legacy payload that passes
 * the current rules is upgraded; one that does not (e.g. a 200-day mission the
 * v1.9 validator wrongly allowed) is rejected wholesale → the UI's Rebuild/Exit
 * recovery explains what could not be restored. Never partial, never clamped.
 */
export function readSession(raw: string | null): SessionReadResult {
  if (raw === null) return { session: null, rejection: null };
  if (raw.length > MAX_SESSION_LENGTH) return { session: null, rejection: tooLarge(raw.length) };
  if (!raw) return { session: null, rejection: INVALID_SESSION };
  try {
    const p = JSON.parse(raw) as Partial<TrainingSession> & { v?: unknown };
    if (p.v !== SESSION_VERSION && p.v !== 1) return { session: null, rejection: INVALID_SESSION };
    if (!validWorkspace(p.user) || !validWorkspace(p.training)) return { session: null, rejection: INVALID_SESSION };
    if (p.baseline !== undefined && p.baseline !== null && !validBaseline(p.baseline)) return { session: null, rejection: INVALID_SESSION };
    return { session: { v: SESSION_VERSION, user: p.user, training: p.training, baseline: p.baseline ?? null }, rejection: null };
  } catch {
    return { session: null, rejection: INVALID_SESSION };
  }
}

/** Compatibility wrapper: null means absent or rejected; readSession exposes why. */
export function parseSession(raw: string | null): TrainingSession | null {
  return readSession(raw).session;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function loadSessionDetails(storage: StorageLike | null): SessionReadResult {
  if (!storage) return { session: null, rejection: null };
  try { return readSession(storage.getItem(SESSION_STORAGE_KEY)); }
  catch {
    return { session: null, rejection: { code: 'SESSION_STORAGE_UNAVAILABLE', message: 'Browser storage is unavailable, so a saved briefing could not be read. The current in-memory workspace is unchanged.' } };
  }
}

export function loadSession(storage: StorageLike | null): TrainingSession | null {
  return loadSessionDetails(storage).session;
}

/** Saves only payloads the reader will accept; failures are returned, never silent. */
export function saveSession(s: TrainingSession, storage: StorageLike | null): SessionSaveResult {
  let raw: string;
  try { raw = JSON.stringify({ ...s, v: SESSION_VERSION }); }
  catch { return { ok: false, rejection: INVALID_SESSION }; }
  if (raw.length > MAX_SESSION_LENGTH) return { ok: false, rejection: tooLarge(raw.length) };
  if (!storage) return { ok: false, rejection: { code: 'SESSION_STORAGE_UNAVAILABLE', message: 'Browser storage is unavailable — the briefing continues in memory but will not survive a refresh.' } };
  try { storage.setItem(SESSION_STORAGE_KEY, raw); return { ok: true }; }
  catch { return { ok: false, rejection: { code: 'SESSION_STORAGE_UNAVAILABLE', message: 'Browser storage is full or unavailable — the briefing continues in memory but the latest changes may not survive a refresh.' } }; }
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
