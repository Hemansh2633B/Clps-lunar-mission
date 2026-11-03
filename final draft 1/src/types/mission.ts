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
  verdict: 'NOMINAL' | 'CONDITIONAL' | 'HIGH RISK' | 'SURVIVAL RISK' | 'RELAY REQUIRED';
  verdictReason: string;
}

export interface SimulationResult {
  site: LandingSite;
  config: MissionConfig;
  samples: EvaluatedSample[];
  events: TransitionEvent[];
  summary: MissionSummary;
  computeMs: number;
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
