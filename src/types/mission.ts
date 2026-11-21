import type { EnergyHistoryRow, IntegrationDiagnostics } from '../engine/integration';
import type { SiteGeometry } from './geometry';
import type { OccultationState } from '../engine/occultation';

export type SiteCategory = 'polar' | 'reference' | 'far-side';
export type ArrayMode = 'horizontal' | 'vertical-tracking' | 'vertical-fixed';
export type AppMode = 'planner' | 'educator';
export type BodyKind = 'sun' | 'earth';
/** Selenographic side: |longitude| ≤ 90° faces Earth; the rest is the far side; 80–100° is the limb band. */
export type LunarSide = 'near' | 'far' | 'limb';
export type RelayModelKind = 'circular-lunar' | 'earth-moon-l2-halo' | 'fixed-body';

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
  /** Where the DEM came from (dataset id, source product/URL, subset checksum, resampling). Descriptive only. */
  sourceProvenance?: string;
  /** Local surface slope at the landing point, degrees (0 = level). Only defined when a DEM/measured model provides it. */
  slopeDeg?: number;
  /** Downslope azimuth, degrees clockwise from north. Required whenever slopeDeg is present. */
  aspectDeg?: number;
  /** How the slope was obtained; never silently assumed. */
  slopeProvenance?: string;
  /** Horizontal spacing of the elevation samples the slope came from, metres. */
  slopeSpacingM?: number;
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
  /** Near side / far side / limb band, derived from the IAU 2015 east longitude. */
  side?: LunarSide;
  /** False when no authoritative elevation exists; `elevationM` is then a disclosed datum placeholder. */
  elevationAvailable?: boolean;
  /** Human-readable region class (basin floor, polar highland, mare, …) when known. */
  regionType?: string;
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
  /** Inertial vectors + explicit lunar-limb occultation state for this epoch. */
  geometry: SiteGeometry;
}

/**
 * Three independent tests are reported, never conflated:
 *  • `geometricVisible` — target centre above the local *horizontal plane*
 *    (elevation ≥ 0). Reference only; it is NOT a visibility claim.
 *  • `bodyOccultation` — is the target behind the Moon's limb? (curvature dip)
 *  • `visible` — both of the above plus the local terrain horizon.
 */
export interface VisibilityState {
  visible: boolean;
  geometricVisible: boolean;
  clearanceDeg: number;
  terrainElevationDeg: number;
  reason: 'clear' | 'terrain' | 'below-horizon' | 'never' | 'lunar-limb' | 'margin';
  /** Elevation of the mean lunar limb in this azimuth, degrees (≤ 0). */
  limbElevationDeg?: number;
  /** Elevation actually used as the obstruction: max(terrain, limb). */
  obstructionElevationDeg?: number;
  /** Which obstruction set the limit. `none` when the body is clear of both. */
  obstructionSource?: 'terrain' | 'lunar-limb' | 'margin' | 'none';
  /** Lunar-body occultation state (independent of local terrain). */
  bodyOccultation?: OccultationState;
  /** Fraction of the body's apparent disk hidden by the lunar limb, 0…1. */
  occultedFraction?: number;
  /** Apparent angular radius of the observed body, degrees. */
  angularRadiusDeg?: number;
}

/** Solar incidence on the local terrain surface (not on a flat deck). */
export interface SolarIncidence {
  /** Local surface slope, degrees (0 = level). */
  slopeDeg: number;
  /** Downslope azimuth, degrees clockwise from north. */
  aspectDeg: number;
  /** Angle between the Sun direction and the surface normal, degrees (90 = grazing). */
  incidenceDeg: number;
  /** cos(incidence): fraction of the direct beam intercepted by a surface element. */
  cosIncidence: number;
  /** Where the slope came from; `assumed-flat` is disclosed, never disguised. */
  source: 'dem' | 'custom' | 'assumed-flat';
}

/** Parametric relay-spacecraft state. A model, not an ephemeris — always labelled. */
export interface RelayConfig {
  id: string;
  name: string;
  model: RelayModelKind;
  /** circular-lunar: altitude above the 1737.4 km sphere, km. */
  altitudeKm?: number;
  /** circular-lunar: inclination to the J2000 equator, degrees. */
  inclinationDeg?: number;
  /** circular-lunar: right ascension of the ascending node, degrees. */
  raanDeg?: number;
  /** circular-lunar: argument of latitude at epoch, degrees. */
  phaseDeg?: number;
  /** circular-lunar: optional period override, minutes (default: two-body Kepler period). */
  periodMinutes?: number;
  /** earth-moon-l2-halo: amplitude in the halo plane, km. */
  haloAmplitudeKm?: number;
  /** earth-moon-l2-halo: period, days (default 14). */
  haloPeriodDays?: number;
  /** earth-moon-l2-halo: phase at epoch, degrees. */
  haloPhaseDeg?: number;
  /** fixed-body: selenographic position (keeps the body-fixed frame, e.g. a surface asset). */
  latitudeDeg?: number;
  longitudeDeg?: number;
  /** Model epoch for phase propagation (UTC ms). Defaults to the analysis start. */
  epochMs?: number;
  /** Free-text provenance for a user-supplied state vector/orbit; never invented here. */
  note?: string;
}

export interface RelaySample {
  id: string;
  name: string;
  model: RelayModelKind;
  /** Relay direction from the site: azimuth (deg from north, clockwise) and elevation above the horizontal plane. */
  azimuthDeg: number;
  elevationDeg: number;
  rangeKm: number;
  /** Site → relay: clear of the lunar body's limb? */
  siteBodyClear: boolean;
  /** Site → relay: clear of the local terrain horizon? */
  siteTerrainClear: boolean;
  /** Elevation actually required at the site: max(terrain horizon, lunar limb). */
  siteLimitDeg: number;
  /** Relay → Earth: clear of the lunar body? */
  earthClear: boolean;
  /** Closest approach of the relay→Earth segment to the Moon's centre minus the limb radius, km. */
  earthClearanceKm: number;
  /** Both legs clear at this instant. Geometry only — NOT an RF link. */
  linkUp: boolean;
  relayLatitudeDeg: number;
  relayLongitudeDeg: number;
  relayAltitudeKm: number;
}

export interface VisibilityWindow {
  startMs: number;
  endMs: number;
}

export interface RelaySummary {
  id: string;
  name: string;
  model: RelayModelKind;
  /** Fraction of the analysis window with both legs geometrically clear, %. */
  linkPct: number;
  /** Longest continuous outage of the two-hop link, hours. */
  longestOutageHours: number;
  /** Number of link windows in the analysis window. */
  windowCount: number;
  /** Fraction of the window where the lunar body blocks the site→relay leg, %. */
  siteLimbBlockedPct: number;
  /** Fraction of the window where the lunar body blocks the relay→Earth leg, %. */
  earthLimbBlockedPct: number;
  /** Mean relay elevation above the site horizon, degrees. */
  meanElevationDeg: number;
  /** Explicit disclaimer repeated in every export. */
  note: string;
}

export interface PowerState {
  fluxWm2: number;
  horizontalW: number;
  verticalTrackingW: number;
  verticalFixedW: number;
  selectedW: number;
  horizontalIncidence: number;
  verticalIncidence: number;
  /** Direct-beam power on the local terrain slope, W (undefined without a slope). */
  terrainSurfaceW?: number;
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
  /** Lunar-limb geometry summary for this epoch (additive; absent on manually built samples). */
  lunar?: {
    dipDeg: number;
    limbElevationDeg: number;
    sunOccultation: OccultationState;
    earthOccultation: OccultationState;
    sunLimbClearanceDeg: number;
    earthLimbClearanceDeg: number;
  };
  /** Solar incidence on the local terrain slope, when a slope is known. */
  incidence?: SolarIncidence;
  /** Configured relay link state at this epoch (null/absent when no relay is configured). */
  relay?: RelaySample | null;
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
  /** Optional relay spacecraft state; absent/null means direct-to-Earth only. */
  relay?: RelayConfig | null;
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

/**
 * Scientific-analysis status, enforced at the COMPUTATION boundary (not just the UI).
 * A discriminated result: eligible variants carry data confidence; blocked variants
 * carry a reason + an actionable resolution. `quantitativeEligible` means the result
 * may be presented as a measured-science conclusion; `demoEligible` means it may be
 * shown as a clearly-labeled demonstration. Blocked results produce NO ordinary
 * quantitative summary (summary === null) so a bypassed UI path cannot surface them.
 */
export type AnalysisStatus =
  | 'VALID' | 'SYNTHETIC_DEMO' | 'ILLUSTRATIVE'
  | 'FRAME_UNVERIFIED' | 'INCOMPLETE_COVERAGE' | 'FRAME_MODEL_OUTSIDE_VALIDATED_RANGE'
  | 'NUMERICAL_RESOLUTION_INSUFFICIENT' | 'COMPUTATION_FAILED';

interface AssessmentFlags { quantitativeEligible: boolean; demoEligible: boolean }
interface BlockedAssessment extends AssessmentFlags {
  quantitativeEligible: false; demoEligible: false; reason: string; resolution: string;
}
export type AnalysisAssessment =
  | (AssessmentFlags & { status: 'VALID'; quantitativeEligible: true; demoEligible: true; dataConfidence: 'measured' })
  | (AssessmentFlags & { status: 'SYNTHETIC_DEMO'; quantitativeEligible: false; demoEligible: true; dataConfidence: 'synthetic'; note: string })
  | (AssessmentFlags & { status: 'ILLUSTRATIVE'; quantitativeEligible: false; demoEligible: true; dataConfidence: 'illustrative' | 'region-approximate'; note: string })
  | (BlockedAssessment & { status: 'FRAME_UNVERIFIED' })
  | (BlockedAssessment & { status: 'INCOMPLETE_COVERAGE' })
  | (BlockedAssessment & { status: 'FRAME_MODEL_OUTSIDE_VALIDATED_RANGE' })
  | (BlockedAssessment & { status: 'NUMERICAL_RESOLUTION_INSUFFICIENT' })
  | (BlockedAssessment & { status: 'COMPUTATION_FAILED' });

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
  /** Hours of the window with the Sun clear of terrain and the lunar limb. */
  sunlitHours?: number;
  /** Hours of the window in darkness. */
  darkHours?: number;
  /** Longest uninterrupted illuminated interval, hours. */
  longestIlluminationHours?: number;
  /** Next sunrise after the window start (null when none within the forward search). */
  nextSunriseMs?: number | null;
  /** Next sunset after the window start (null when none within the forward search). */
  nextSunsetMs?: number | null;
  /** Visibility windows derived from the refined transition events (capped for export size). */
  windows?: { sun: VisibilityWindow[]; earth: VisibilityWindow[]; relay: VisibilityWindow[] };
  /** Fraction of the window with the Earth occulted by the lunar body (curvature), %. */
  earthOccludedPct?: number;
  /** Fraction of the window with the Earth above the limb but blocked by local terrain, %. */
  earthTerrainBlockedPct?: number;
  /** Mean solar incidence angle on the local terrain slope, degrees (null without a slope). */
  meanSolarIncidenceDeg?: number | null;
  /** Two-hop relay result when a relay is configured. */
  relay?: RelaySummary | null;
  /** Relay-specific verdict text; the primary `verdict` stays DTE-based. */
  relayVerdict?: string | null;
}

export interface SimulationResult {
  site: LandingSite;
  config: MissionConfig;
  samples: EvaluatedSample[];
  events: TransitionEvent[];
  /** Null when the analysis is blocked — no ordinary quantitative conclusions exist. */
  summary: MissionSummary | null;
  computeMs: number;
  sampling: SamplingInfo;
  /** Reliability of the adaptive transition detection (budget/fallback/unresolved). */
  transitionDiagnostics: TransitionDiagnostics;
  /** Computation-boundary scientific status (discriminated). */
  analysis: AnalysisAssessment;
  /**
   * The event-aware integrator's OWN energy/battery trajectory (v1.10): one row
   * per accepted adaptive-Simpson sub-interval boundary, reconciling with the
   * summary by construction. Null for blocked analyses (no quantitative history).
   */
  energyHistory?: EnergyHistoryRow[] | null;
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
