import type { IntegrationDiagnostics } from '../engine/integration';

export type SiteCategory = 'polar' | 'reference';
export type ArrayMode = 'horizontal' | 'vertical-tracking' | 'vertical-fixed';
export type AppMode = 'planner' | 'educator';
export type BodyKind = 'sun' | 'earth';

export interface TerrainFeature {
  name: string;
  azimuthDeg: number;
  elevationDeg: number;
  widthDeg: number;
  kind: 'massif' | 'rim' | 'saddle' | 'drop';
}

export interface TerrainProfile {
  label: string;
  kind: 'illustrative' | 'flat' | 'dem' | 'custom';
  resolutionDeg: number;
  elevations: number[];
  features: TerrainFeature[];
  /** For illustrative masks: assumed angular uncertainty. For DEM masks: azimuth sampling half-width, not vertical accuracy. */
  uncertaintyDeg: number;
  eyeHeightM: number;
  sourceFrame?: string;
  sourceFile?: string;
  synthetic?: boolean;
  coveragePercent?: number;
  radiusKm?: number;
  horizonRadiusKm?: number;
  gridSize?: number;
  samplingDeg?: number;
  accuracyNote?: string;
  /** Frame compatibility with the IAU 2015 ephemeris frame (verified via SPICE). */
  frameVerified?: boolean;
  frameTransform?: 'me' | 'pa' | 'iau' | null;
  frameNote?: string;
  frameResidualDeg?: number;
  /** Azimuth offset (deg) applied to align a source-frame mask with the IAU frame. */
  azimuthOffsetDeg?: number;
  /** Local (landing-centered) vs regional (distant-obstruction) analysis. */
  analysisScale?: 'local' | 'regional';
  regionalRadiusKm?: number;
  /** Authoritative vertical uncertainty (m) if a product provides it; else undefined. */
  verticalUncertaintyM?: number;
  effectiveResolutionM?: number;
  productVersion?: string;
}

/** How the mission window was sampled (reproducibility + convergence disclosure). */
export interface SamplingInfo {
  requestedStepMinutes: number;
  effectiveStepMinutes: number;
  sampleCount: number;
  capped: boolean;
  maxGapMinutes: number;
  strategy: string;
}

/** Transparent decomposition of the application-defined feasibility heuristic. */
export interface ScoreBreakdown {
  heuristic: true;
  components: { key: string; label: string; valuePct: number; weight: number; contribution: number }[];
  weightsSum: number;
  dataConfidence: 'measured' | 'illustrative' | 'synthetic' | 'region-approximate' | 'mixed';
  note: string;
}

export interface LandingSite {
  id: string;
  name: string;
  shortName: string;
  latitude: number;
  longitude: number;
  elevationM: number;
  category: SiteCategory;
  region: string;
  description: string;
  terrain: TerrainProfile;
  accent: string;
  custom?: boolean;
  /** Candidate program / mission class (e.g. 'Artemis III (2024)', 'Apollo', 'Chang\'e'). */
  program?: string;
  /** How the coordinate was obtained — never invent precise landing points. */
  coordinateType?: 'region-center' | 'representative-point' | 'surveyed' | 'custom';
  coordinateProvenance?: string;
  coordinateUncertaintyDeg?: number;
  elevationProvenance?: string;
  sourceUrl?: string;
  sourceDate?: string;
  dataConfidence?: 'measured' | 'illustrative' | 'synthetic' | 'region-approximate';
}

export interface SkyPosition {
  azimuthDeg: number;
  elevationDeg: number;
  distanceKm: number;
}

export interface LibrationState {
  subEarthLatitudeDeg: number;
  subEarthLongitudeDeg: number;
  opticalLatitudeDeg: number;
  opticalLongitudeDeg: number;
}

export interface EphemerisSample {
  timeMs: number;
  sun: SkyPosition;
  earth: SkyPosition;
  libration: LibrationState;
  subsolarLatitudeDeg: number;
  subsolarLongitudeDeg: number;
}

export interface VisibilityState {
  visible: boolean;
  geometricVisible: boolean;
  clearanceDeg: number;
  terrainElevationDeg: number;
  reason: 'clear' | 'terrain' | 'below-horizon' | 'never';
}

export interface PowerState {
  fluxWm2: number;
  horizontalW: number;
  verticalTrackingW: number;
  verticalFixedW: number;
  selectedW: number;
  horizontalIncidence: number;
  verticalIncidence: number;
}

export interface EvaluatedSample {
  timeMs: number;
  sun: SkyPosition;
  earth: SkyPosition;
  sunVisibility: VisibilityState;
  earthVisibility: VisibilityState;
  power: PowerState;
  viable: boolean;
  libration: LibrationState;
  subsolarLatitudeDeg: number;
  subsolarLongitudeDeg: number;
}

export interface MissionConfig {
  durationDays: number;
  arrayMode: ArrayMode;
  arrayAreaM2: number;
  cellEfficiency: number;
  systemDerate: number;
  fixedPanelAzimuthDeg: number;
  loadW: number;
  batteryCapacityKWh: number;
  initialSocPct: number;
  commsMarginDeg: number;
  stepMinutes: number;
}

export interface TransitionEvent {
  timeMs: number;
  body: BodyKind | 'combined';
  visible: boolean;
}

export interface UnresolvedInterval { startMs: number; endMs: number; body: BodyKind | 'combined' }

/** Reliability disclosure for the adaptive visibility-transition detector. */
export interface TransitionDiagnostics {
  nodeBudgetPerInterval: number;
  minStepMs: number;
  rateBoundDegPerHour: number;
  budgetExhausted: boolean;
  exhaustedIntervals: number;
  fallbackUsed: boolean;
  unresolvedIntervals: UnresolvedInterval[];
  nodesEvaluated: number;
  resolutionStatus: 'resolved' | 'fallback-resolved' | 'degraded';
}

export interface MissionSummary {
  startMs: number;
  endMs: number;
  durationHours: number;
  sampleCount: number;
  illuminationPct: number;
  dtePct: number;
  combinedPct: number;
  meanSunElevationDeg: number;
  meanVisibleSunElevationDeg: number;
  peakSunElevationDeg: number;
  peakEarthElevationDeg: number;
  meanHorizontalW: number;
  meanVerticalTrackingW: number;
  meanSelectedW: number;
  peakSelectedW: number;
  horizontalEnergyKWh: number;
  verticalEnergyKWh: number;
  selectedEnergyKWh: number;
  longestEclipseHours: number;
  longestDteGapHours: number;
  longestCombinedGapHours: number;
  minBatterySocPct: number;
  finalBatterySocPct: number;
  depletionHours: number;
  firstDepletionMs: number | null;
  earthNeverVisible: boolean;
  feasibilityScore: number;
  verdict: 'NOMINAL' | 'CONDITIONAL' | 'HIGH RISK' | 'ENERGY DEFICIT' | 'RELAY REQUIRED';
  verdictReason: string;
  /** Effective sampling used (reproducibility + convergence). */
  sampling: SamplingInfo;
  /** Transparent, application-defined heuristic decomposition (not a NASA method). */
  scoreBreakdown: ScoreBreakdown;
  /** Confidence of the underlying terrain data (separate from performance). */
  dataConfidence: ScoreBreakdown['dataConfidence'];
  /** Whether the terrain frame is verified compatible with the ephemeris frame. */
  frameVerified: boolean;
  /** Event-aware energy/battery integration quality (resolution + numerical uncertainty). */
  integrationDiagnostics?: IntegrationDiagnostics;
}

export interface SimulationResult {
  site: LandingSite;
  config: MissionConfig;
  samples: EvaluatedSample[];
  events: TransitionEvent[];
  summary: MissionSummary;
  computeMs: number;
  sampling: SamplingInfo;
  /** Reliability of the adaptive transition detection (budget/fallback/unresolved). */
  transitionDiagnostics: TransitionDiagnostics;
}

export interface Scenario {
  id: string;
  siteId: string;
  startMs: number;
  config: MissionConfig;
  label?: string;
}

export interface GuidedScenario {
  id: string;
  title: string;
  kicker: string;
  description: string;
  siteId: string;
  startMs: number;
  durationDays: number;
  slipDays: number;
  arrayMode: ArrayMode;
  steps: { title: string; body: string; action?: 'compare' | 'slip' | 'panorama' | 'map' | 'terrain' }[];
}
