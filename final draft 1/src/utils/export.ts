/**
 * Scientific exports (v1.10).
 *
 * Every output is designed to remain understandable AFTER it leaves the app:
 * - The JSON report carries application + independent report-schema versions,
 *   a SHA-256 analysis fingerprint (over the SAME simulationKey the cache uses),
 *   the EFFECTIVE sanitized configuration (never silently-clamped values), full
 *   site/terrain provenance, status-aware DEM disclosure, sampling/transition/
 *   integration diagnostics, the engine's own energy history, and all warnings.
 * - Every CSV row repeats compact provenance columns (fingerprint, versions,
 *   site, status, confidence, frame, LOCAL horizon scale, disclosure codes) so a
 *   CSV separated from its report is still traceable. No metadata comment rows:
 *   the files remain standards-compatible CSV.
 * - Refined transition events keep their exact millisecond timestamps.
 * - Comparison rows carry EXPLICIT resolution states — blank numeric cells are
 *   never an implicit status, and mixed-confidence rows are never ranked.
 *
 * Download semantics: `download()` dispatches a browser download request. Page
 * script cannot observe the user's save dialog, so messages say "initiated",
 * never "saved"/"completed". Browser automation asserts real download events.
 */
import type { EvaluatedSample, LandingSite, MissionConfig, MissionSummary, SimulationResult, Scenario } from '../types/mission';
import type { AnalysisAssessment } from '../types/mission';
import { mjd } from '../engine/constants';
import { DAY_MS } from '../engine/constants';
import { horizonTable } from '../engine/horizonPhysics';
import { EPHEMERIS_FRAME, FRAME_VALIDATED_RANGE_LABEL, frameResidualDeg } from '../engine/lunarFrame';
import { BATTERY_CHARGE_EFF, BATTERY_DISCHARGE_EFF, terrainDataConfidence } from '../engine/powerComms';
import { MISSION_LIMITS, sanitizeConfig, type NumericConfigKey } from '../engine/configLimits';
import { simulationKey } from '../engine/simulation';
import { APP_VERSION, REPORT_SCHEMA_VERSION, REPORT_SCHEMA_POLICY } from '../version';
import { analysisFingerprint, shortFingerprint } from './analysisId';

export { REPORT_SCHEMA_VERSION };

export type ExportKind = 'json' | 'timeseries' | 'horizon' | 'summary' | 'events' | 'energy';

const EXPORT_LABELS: Record<ExportKind, string> = {
  json: 'mission report (JSON)',
  timeseries: 'telemetry timeseries (CSV)',
  horizon: 'horizon mask (CSV)',
  summary: 'window summary (CSV)',
  events: 'visibility events (CSV)',
  energy: 'energy & battery history (CSV)',
};

/** Honest download terminology: an anchor click INITIATES a download; the
 *  browser's final save dialog is not observable from page script. */
export function exportInitiatedMessage(kind: ExportKind): string {
  return `Export initiated — ${EXPORT_LABELS[kind]}. Check your browser's downloads to confirm the file arrived.`;
}

export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  return lines.join('\n');
}

/**
 * Every horizon in CHANDRA is a LOCAL (landing-centered) horizon. The regional PGDA
 * distant-horizon products were not available, so no regional horizon is fabricated.
 * This disclosure keeps reports consistent with the "Local horizon" UI label.
 */
export function localHorizonDisclosure(t: LandingSite['terrain']): string {
  const reach = t.horizonRadiusKm ?? t.radiusKm;
  const reachNote = reach != null ? ` (horizon reach ~${reach} km)` : '';
  if (t.kind === 'dem' && !t.synthetic) {
    return `LOCAL HORIZON — terrain occlusion is ray-marched from the local elevation crop${reachNote}; obstructions beyond that radius are not captured. This is NOT a regional distant-horizon model.`;
  }
  return `LOCAL HORIZON — the horizon is a landing-centered ${t.synthetic ? 'synthetic demo' : 'illustrative'} mask${reachNote}, not a measured regional distant-horizon model.`;
}

/**
 * Status-aware terrain disclosure (v1.10). Replaces the generic "verify frame
 * alignment" wording: a verified+rotated DEM says exactly which frame was
 * recognized, which constant transformation was applied, its residual and its
 * planning-grade limitation; blocked states explain the actual block. Agrees
 * with the AnalysisAssessment, the a11y DEM footer and the CSV status columns.
 */
export function terrainDisclosure(site: LandingSite, analysis: AnalysisAssessment | null): string {
  const t = site.terrain;
  if (t.synthetic) {
    return 'Terrain: synthetic demo horizon — procedural demonstration data, NOT real lunar data. Calculated demonstration only, never a scientific result.';
  }
  if (t.kind !== 'dem') {
    return t.kind === 'custom'
      ? 'Terrain: user-edited 8-sector horizon mask — illustrative demonstration data, not a measured DEM. Sector values are exact only at the eight edited azimuths.'
      : 'Terrain: LOLA-inspired illustrative mask — demonstration data, not a measured flight DEM. Coordinates are real; relief is representative.';
  }
  const file = t.sourceFile ?? 'local DEM';
  const frame = t.sourceFrame ?? 'unspecified';
  if (analysis && !analysis.demoEligible) {
    if (analysis.status === 'FRAME_MODEL_OUTSIDE_VALIDATED_RANGE') {
      return `DEM ${file}: the constant ${String(t.frameTransform ?? '?').toUpperCase()}→IAU correction is SPICE-validated only over ${FRAME_VALIDATED_RANGE_LABEL}. This interval lies outside that range, so quantitative analysis is blocked — the correction is never extrapolated.`;
    }
    if (analysis.status === 'INCOMPLETE_COVERAGE') {
      return `DEM ${file}: ray coverage is ${(t.coveragePercent ?? 0).toFixed(1)}% — missing rays prevent a complete horizon, so quantitative analysis is blocked. ${analysis.reason}`;
    }
    if (analysis.status === 'FRAME_UNVERIFIED') {
      return `DEM ${file}: source frame "${frame}" is NOT on the validated allowlist, so its alignment with the IAU 2015 ephemeris frame cannot be verified — quantitative analysis is blocked. ${analysis.resolution}`;
    }
    return `DEM ${file}: quantitative analysis is blocked (${analysis.status}). ${analysis.reason}`;
  }
  if (t.frameVerified && (t.frameTransform === 'me' || t.frameTransform === 'pa')) {
    const residual = (t.frameResidualDeg ?? frameResidualDeg(t.frameTransform)).toFixed(4);
    const offset = t.azimuthOffsetDeg != null ? ` Azimuth offset applied: ${t.azimuthOffsetDeg.toFixed(4)}°.` : '';
    return `DEM ${file}: source frame ${frame} recognized on the validated allowlist (DE421 realization). Mask rotated to the IAU 2015 ephemeris frame via the constant ${t.frameTransform.toUpperCase()}→IAU correction.${offset} Disclosed residual ≤ ${residual}°, SPICE-validated over ${FRAME_VALIDATED_RANGE_LABEL}. This is a planning-grade constant approximation, NOT a time-dependent rigorous transformation; vertical accuracy is ${t.verticalUncertaintyM != null ? `${t.verticalUncertaintyM} m (product-provided)` : 'not certified by the product metadata'}.`;
  }
  if (t.frameVerified && t.frameTransform === 'iau') {
    return `DEM ${file}: declared frame ${frame} is already in the supported IAU 2015 ephemeris frame — no rotation applied, subject to the application's documented frame validation. Verify the product's stated IAU realization before operational use.`;
  }
  return `DEM ${file}: source frame "${frame}" is not verified against the allowlist — quantitative mission visibility is blocked until the frame is confirmed compatible with IAU 2015.`;
}

/** Collect honest, reproducible warnings for a site + result. */
export function reportWarnings(site: LandingSite, sim: SimulationResult | null): string[] {
  const t = site.terrain;
  const w: string[] = [];
  if (sim?.analysis && !sim.analysis.demoEligible && 'reason' in sim.analysis) {
    w.push(`ANALYSIS BLOCKED (${sim.analysis.status}): ${sim.analysis.reason} Resolution: ${sim.analysis.resolution}`);
  }
  if (sim?.transitionDiagnostics.fallbackUsed) w.push(`Transition detection used the fine-scan fallback for ${sim.transitionDiagnostics.exhaustedIntervals} interval(s); resolved to ${(sim.transitionDiagnostics.minStepMs / 1000).toFixed(0)} s.`);
  const conf = sim?.summary?.dataConfidence ?? terrainDataConfidence(site);
  if (t.synthetic) w.push('Synthetic demo terrain — procedural, NOT real lunar data; not a scientific result.');
  else if (t.kind !== 'dem') w.push('Illustrative / user-edited terrain — NOT a measured flight DEM; ranking is indicative only.');
  if (t.kind === 'dem' && !t.synthetic && !t.frameVerified) w.push('FRAME UNVERIFIED — terrain reference frame not confirmed compatible with the IAU 2015 ephemeris frame; quantitative mission visibility is blocked.');
  if (t.kind === 'dem' && !t.synthetic && (t.coveragePercent ?? 100) < 100) w.push(`Incomplete ray coverage (${(t.coveragePercent ?? 0).toFixed(1)}%) — quantitative mission visibility is blocked.`);
  if (t.kind === 'dem' && !t.synthetic && t.frameVerified && (t.frameTransform === 'me' || t.frameTransform === 'pa')) w.push(`Frame corrected ${t.frameTransform.toUpperCase()} → IAU with a constant rotation; disclosed residual ≤ ${(t.frameResidualDeg ?? frameResidualDeg(t.frameTransform)).toFixed(4)}° (~120 m). Planning-grade; not a time-dependent rigorous transformation. Validated ${FRAME_VALIDATED_RANGE_LABEL}.`);
  w.push(localHorizonDisclosure(t));
  if (conf !== 'measured') w.push(`Data confidence is "${conf}", not measured — do not treat the feasibility score as a measured-terrain ranking.`);
  w.push('Feasibility score is an application-defined heuristic, NOT a NASA methodology.');
  w.push('Earth visibility is geometric line-of-sight only — NOT an RF link budget.');
  w.push('Battery result is an energy-balance model only — NOT thermal/radiation survival.');
  if (sim?.sampling.capped) w.push(`Sampling capped at ${sim.sampling.sampleCount} samples; step coarsened to ${sim.sampling.effectiveStepMinutes.toFixed(2)} min (full span + both endpoints preserved).`);
  return w;
}

/** Compact, machine-readable disclosure codes repeated on every CSV row.
 *  Full text lives in the JSON report (keyed by the same analysis fingerprint). */
export function disclosureCodes(site: LandingSite, sim: SimulationResult | null): string[] {
  const t = site.terrain;
  const codes = ['LOCAL_HORIZON', 'SCORE_HEURISTIC', 'LOS_NOT_RF', 'ENERGY_NOT_THERMAL'];
  if (t.synthetic) codes.push('SYNTHETIC_TERRAIN');
  else if (t.kind !== 'dem') codes.push('ILLUSTRATIVE_TERRAIN');
  else if (!t.frameVerified) codes.push('FRAME_UNVERIFIED');
  else if (t.frameTransform === 'me' || t.frameTransform === 'pa') codes.push('FRAME_CONSTANT_CORRECTION');
  if (t.kind === 'dem' && !t.synthetic && (t.coveragePercent ?? 100) < 100) codes.push('COVERAGE_INCOMPLETE');
  if (sim?.analysis.status === 'FRAME_MODEL_OUTSIDE_VALIDATED_RANGE') codes.push('FRAME_EPOCH_UNVALIDATED');
  if (sim?.sampling.capped) codes.push('SAMPLING_CAPPED');
  if (sim?.transitionDiagnostics.fallbackUsed) codes.push('TRANSITION_FALLBACK');
  return codes;
}

/** Provenance column template (names only) — documented + unit-tested. */
export function csvProvenanceColumns(): Record<string, string> {
  return {
    analysis_fingerprint: '', app_version: '', report_schema: '', site_id: '',
    analysis_status: '', data_confidence: '', terrain_kind: '', frame_transform: '',
    horizon_scale: '', disclosures: '',
  };
}

function provenanceRow(sim: SimulationResult, fingerprint: string): Record<string, string> {
  const t = sim.site.terrain;
  return {
    analysis_fingerprint: shortFingerprint(fingerprint),
    app_version: APP_VERSION,
    report_schema: REPORT_SCHEMA_VERSION,
    site_id: sim.site.id,
    analysis_status: sim.analysis.status,
    data_confidence: sim.summary?.dataConfidence ?? terrainDataConfidence(sim.site),
    terrain_kind: t.kind,
    frame_transform: t.frameTransform ?? 'none',
    horizon_scale: 'LOCAL',
    disclosures: disclosureCodes(sim.site, sim).join(';'),
  };
}

export async function missionReportJSON(site: LandingSite, config: MissionConfig, sim: SimulationResult | null, current: EvaluatedSample): Promise<string> {
  const t = site.terrain;
  const conf = sim?.summary?.dataConfidence ?? terrainDataConfidence(site);
  // The report describes what the ENGINE calculated: SimulationResult.config is
  // the sanitized effective config. Requested values are recorded separately and
  // any clamping is disclosed — never presented as if it had been used.
  const effectiveConfig = sim?.config ?? sanitizeConfig(config);
  const clampedFields: string[] = (Object.keys(MISSION_LIMITS) as NumericConfigKey[]).filter((k) => effectiveConfig[k] !== config[k]);
  if (effectiveConfig.arrayMode !== config.arrayMode) clampedFields.push('arrayMode');
  const disclosure = terrainDisclosure(site, sim?.analysis ?? null);
  const fingerprint = sim?.summary ? await analysisFingerprint(sim.site, sim.summary.startMs, sim.summary.endMs, effectiveConfig) : null;

  const reproducibility = {
    timeReference: 'UTC',
    interval: sim?.summary ? { startUtc: new Date(sim.summary.startMs).toISOString(), endUtc: new Date(sim.summary.endMs).toISOString(), durationHours: sim.summary.durationHours } : null,
    analysisStatus: sim?.analysis ?? null,
    effectiveConfig,
    requestedConfig: config,
    energyIntegration: sim?.summary?.integrationDiagnostics ?? null,
    transitionDetection: sim?.transitionDiagnostics ?? null,
    numericalUncertainty: sim?.summary ? {
      estimatedEnergyErrorKWh: sim.summary.integrationDiagnostics?.estimatedEnergyErrorKWh ?? null,
      relativeEnergyError: sim.summary.integrationDiagnostics?.relativeEnergyError ?? null,
      integrationResolution: sim.summary.integrationDiagnostics?.resolutionStatus ?? null,
      transitionMinStepMs: sim.transitionDiagnostics.minStepMs,
      transitionResolution: sim.transitionDiagnostics.resolutionStatus,
      maxSamplingGapMinutes: sim.sampling.maxGapMinutes,
    } : null,
    ephemeris: {
      model: 'astronomy-engine (JPL DE402/DE421-class ephemeris)',
      moonRotation: 'IAU 2015 (RotationAxis + Libration)',
      frame: EPHEMERIS_FRAME,
      lightTimeCorrected: true,
      stellarAberration: true,
      refraction: 'none (airless body)',
      independentValidation: 'SPICE DE421 + moon_pa_de421 + pck00008; see tests/data/frame-reference.json',
    },
    siteProvenance: {
      siteId: site.id,
      siteName: site.name,
      latitude: site.latitude,
      longitude: site.longitude,
      elevationM: site.elevationM,
      program: site.program ?? null,
      coordinateType: site.coordinateType ?? null,
      coordinateProvenance: site.coordinateProvenance ?? null,
      coordinateUncertaintyDeg: site.coordinateUncertaintyDeg ?? null,
      elevationProvenance: site.elevationProvenance ?? null,
      sourceUrl: site.sourceUrl ?? null,
      sourceDate: site.sourceDate ?? null,
      dataConfidence: conf,
    },
    terrain: {
      kind: t.kind,
      synthetic: t.synthetic ?? false,
      sourceFile: t.sourceFile ?? null,
      sourceFrame: t.sourceFrame ?? null,
      frameVerified: t.frameVerified ?? (t.kind !== 'dem'),
      frameTransform: t.frameTransform ?? null,
      frameResidualDeg: t.frameResidualDeg ?? null,
      azimuthOffsetDeg: t.azimuthOffsetDeg ?? null,
      validatedEpochRange: (t.frameTransform === 'me' || t.frameTransform === 'pa') ? FRAME_VALIDATED_RANGE_LABEL : null,
      appliedTransformation: (t.frameTransform === 'me' || t.frameTransform === 'pa')
        ? `Constant ${t.frameTransform.toUpperCase()}→IAU rotation (planning-grade; not time-dependent)`
        : t.frameTransform === 'iau' ? 'None — declared IAU frame already matches the ephemeris frame' : 'None',
      disclosure,
      resolutionDeg: t.resolutionDeg,
      effectiveResolutionM: t.effectiveResolutionM ?? null,
      radiusKm: t.radiusKm ?? null,
      horizonRadiusKm: t.horizonRadiusKm ?? null,
      coveragePercent: t.coveragePercent ?? null,
      verticalUncertaintyM: t.verticalUncertaintyM ?? null,
      analysisScale: t.analysisScale ?? 'local',
      horizonScale: 'LOCAL HORIZON',
      horizonScaleNote: localHorizonDisclosure(t),
      angularUncertaintyDeg: t.uncertaintyDeg,
    },
    sampling: sim?.sampling ?? null,
    powerAssumptions: {
      model: 'idealized cosine incidence; zero output when Sun terrain-occulted',
      solarConstantWm2: 1361,
      arrayMode: effectiveConfig.arrayMode,
      arrayAreaM2: effectiveConfig.arrayAreaM2,
      cellEfficiency: effectiveConfig.cellEfficiency,
      systemDerate: effectiveConfig.systemDerate,
      fixedPanelAzimuthDeg: effectiveConfig.fixedPanelAzimuthDeg,
      loadW: effectiveConfig.loadW,
      note: 'Instantaneous power; no temperature, dust, or degradation effects.',
    },
    batteryAssumptions: {
      capacityKWh: effectiveConfig.batteryCapacityKWh,
      initialSocPct: effectiveConfig.initialSocPct,
      chargeEfficiency: BATTERY_CHARGE_EFF,
      dischargeEfficiency: BATTERY_DISCHARGE_EFF,
      note: 'Energy-balance model with hard SOC bounds; NOT thermal/radiation survival.',
    },
    scoreMethodology: sim?.summary?.scoreBreakdown ?? { heuristic: true, note: 'Application-defined heuristic, not a NASA methodology.' },
    warnings: reportWarnings(site, sim),
  };

  return JSON.stringify({
    product: 'CHANDRA mission planning report',
    applicationVersion: APP_VERSION,
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    schemaVersionPolicy: REPORT_SCHEMA_POLICY,
    generatedAt: new Date().toISOString(),
    timeReference: 'UTC',
    analysisFingerprint: fingerprint,
    analysisFingerprintShort: fingerprint ? shortFingerprint(fingerprint) : null,
    fingerprintMethod: 'SHA-256 over the canonical simulation key (site + terrain identity + UTC window + effective config); CSV rows repeat the leading 16 hex characters.',
    disclaimer: `Ephemeris: astronomy-engine + IAU 2015 Moon rotation. ${disclosure} Horizon: LOCAL (landing-centered), not a regional distant-horizon model. Power: idealized cosine model with system derate. Geometric center-of-disk LOS (not an RF link budget); no atmospheric refraction. Feasibility score is an application-defined heuristic, not a NASA methodology. Data confidence: ${conf}.`,
    site,
    config: effectiveConfig,
    effectiveConfig,
    requestedConfig: config,
    configWasClamped: clampedFields.length > 0,
    clampedFields,
    current: { ...current, mjd: mjd(current.timeMs) },
    summary: sim?.summary ?? null,
    events: sim?.events ?? [],
    energyHistory: sim?.energyHistory ?? null,
    energyHistoryMethod: 'Rows are the event-aware integrator\'s own accepted adaptive-Simpson sub-interval boundaries (same generation integral, efficiencies, SOC bounds and depletion interpolation as the summary). generated_w is the interval average, not an instantaneous value. No intermediate interpolation.',
    horizonProfile: site.terrain,
    reproducibility,
  }, null, 2);
}

export async function timeseriesCSV(sim: SimulationResult, fingerprint: string): Promise<string> {
  const prov = provenanceRow(sim, fingerprint);
  return toCSV(sim.samples.map((s) => ({
    utc: new Date(s.timeMs).toISOString(),
    mjd: mjd(s.timeMs).toFixed(6),
    sun_az_deg: s.sun.azimuthDeg.toFixed(4),
    sun_el_deg: s.sun.elevationDeg.toFixed(4),
    sun_terrain_deg: s.sunVisibility.terrainElevationDeg.toFixed(4),
    sun_clearance_deg: s.sunVisibility.clearanceDeg.toFixed(4),
    sun_visible: s.sunVisibility.visible ? 1 : 0,
    earth_az_deg: s.earth.azimuthDeg.toFixed(4),
    earth_el_deg: s.earth.elevationDeg.toFixed(4),
    earth_terrain_deg: s.earthVisibility.terrainElevationDeg.toFixed(4),
    earth_clearance_deg: s.earthVisibility.clearanceDeg.toFixed(4),
    earth_visible: s.earthVisibility.visible ? 1 : 0,
    viable: s.viable ? 1 : 0,
    flux_wm2: s.power.fluxWm2.toFixed(2),
    horizontal_w: s.power.horizontalW.toFixed(2),
    vertical_tracking_w: s.power.verticalTrackingW.toFixed(2),
    vertical_fixed_w: s.power.verticalFixedW.toFixed(2),
    selected_w: s.power.selectedW.toFixed(2),
    libration_lat_deg: s.libration.subEarthLatitudeDeg.toFixed(4),
    libration_lon_deg: s.libration.subEarthLongitudeDeg.toFixed(4),
    ...prov,
  })));
}

/**
 * Refined visibility transitions at their EXACT millisecond timestamps — never
 * rounded to the sample grid. `visible_before` is tracked per body from the
 * window's initial state; `visible_after` is the event's post-transition state.
 */
export async function eventsCSV(sim: SimulationResult, fingerprint: string): Promise<string> {
  const prov = provenanceRow(sim, fingerprint);
  const columns = ['event_utc', 'event_time_ms', 'body', 'visible_before', 'visible_after', 'refinement_min_step_ms', 'transition_resolution', 'fallback_used', ...Object.keys(csvProvenanceColumns())];
  const events = [...sim.events].sort((a, b) => a.timeMs - b.timeMs);
  if (events.length === 0 || sim.samples.length === 0) return columns.join(',');
  const first = sim.samples[0];
  const state: Record<string, boolean> = { sun: first.sunVisibility.visible, earth: first.earthVisibility.visible, combined: first.viable };
  const rows = events.map((e) => {
    const before = state[e.body] ?? !e.visible;
    state[e.body] = e.visible;
    return {
      event_utc: new Date(e.timeMs).toISOString(),
      event_time_ms: e.timeMs,
      body: e.body,
      visible_before: before ? 1 : 0,
      visible_after: e.visible ? 1 : 0,
      refinement_min_step_ms: sim.transitionDiagnostics.minStepMs,
      transition_resolution: sim.transitionDiagnostics.resolutionStatus,
      fallback_used: sim.transitionDiagnostics.fallbackUsed ? 1 : 0,
      ...prov,
    };
  });
  return toCSV(rows);
}

/**
 * The engine's event-aware energy/battery trajectory (v1.10). One row per
 * accepted quadrature sub-interval boundary — the exact points where the battery
 * was stepped. Reconciles with the mission summary by construction; blank
 * generated_w/net_kwh on the initial row is explicit (boundary=start), never zero.
 */
export async function energyHistoryCSV(sim: SimulationResult, fingerprint: string): Promise<string> {
  const prov = provenanceRow(sim, fingerprint);
  const columns = ['utc', 'interval_start_utc', 'interval_hours', 'boundary', 'sun_lit', 'generated_w', 'load_w', 'net_kwh', 'cumulative_generated_kwh', 'cumulative_consumed_kwh', 'battery_kwh', 'battery_soc_pct', 'battery_state', 'deficit_hours', ...Object.keys(csvProvenanceColumns())];
  const history = sim.energyHistory ?? [];
  if (history.length === 0) return columns.join(',');
  return toCSV(history.map((r) => ({
    utc: new Date(r.timeMs).toISOString(),
    interval_start_utc: new Date(r.intervalStartMs).toISOString(),
    interval_hours: ((r.timeMs - r.intervalStartMs) / 3_600_000).toFixed(6),
    boundary: r.boundary,
    sun_lit: r.sunLit ? 1 : 0,
    generated_w: r.generatedW == null ? '' : r.generatedW.toFixed(3),
    load_w: r.loadW.toFixed(3),
    net_kwh: r.netKWh == null ? '' : r.netKWh.toFixed(6),
    cumulative_generated_kwh: r.cumulativeGeneratedKWh.toFixed(6),
    cumulative_consumed_kwh: r.cumulativeConsumedKWh.toFixed(6),
    battery_kwh: r.batteryKWh.toFixed(6),
    battery_soc_pct: r.socPct.toFixed(3),
    battery_state: r.state,
    deficit_hours: r.deficitHours.toFixed(6),
    ...prov,
  })));
}

export async function horizonCSV(site: LandingSite, current: EvaluatedSample, sim: SimulationResult, fingerprint: string): Promise<string> {
  const step = site.terrain.kind === 'dem' ? site.terrain.resolutionDeg : 5;
  const prov = provenanceRow(sim, fingerprint);
  return toCSV(horizonTable(site, current, step).map((r) => ({
    instant_utc: new Date(current.timeMs).toISOString(),
    azimuth_deg: r.azimuthDeg,
    terrain_elevation_deg: r.terrainElevationDeg.toFixed(4),
    sun_clearance_deg: r.sunClearanceDeg == null ? '' : r.sunClearanceDeg.toFixed(4),
    earth_clearance_deg: r.earthClearanceDeg == null ? '' : r.earthClearanceDeg.toFixed(4),
    ...prov,
  })));
}

export async function summaryCSV(sim: SimulationResult, fingerprint: string): Promise<string> {
  const prov = provenanceRow(sim, fingerprint);
  const s = sim.summary;
  if (!s) {
    // Blocked analysis: never emit ordinary-looking quantitative rows.
    return toCSV([{ site: sim.site.name, analysis_status: sim.analysis.status, quantitative_eligible: 0, note: 'Analysis blocked — no quantitative summary exported.', ...prov }]);
  }
  return toCSV([{
    site: sim.site.name,
    analysis_status: sim.analysis.status,
    quantitative_eligible: sim.analysis.quantitativeEligible ? 1 : 0,
    latitude: sim.site.latitude,
    longitude: sim.site.longitude,
    energy_error_kwh: s.integrationDiagnostics?.estimatedEnergyErrorKWh.toFixed(6) ?? '',
    integration_resolution: s.integrationDiagnostics?.resolutionStatus ?? '',
    transition_resolution: sim.transitionDiagnostics.resolutionStatus,
    start_utc: new Date(s.startMs).toISOString(),
    end_utc: new Date(s.endMs).toISOString(),
    duration_hours: s.durationHours.toFixed(2),
    illumination_pct: s.illuminationPct.toFixed(2),
    dte_pct: s.dtePct.toFixed(2),
    combined_pct: s.combinedPct.toFixed(2),
    mean_sun_el_deg: s.meanSunElevationDeg.toFixed(3),
    peak_sun_el_deg: s.peakSunElevationDeg.toFixed(3),
    mean_horizontal_w: s.meanHorizontalW.toFixed(1),
    mean_vertical_tracking_w: s.meanVerticalTrackingW.toFixed(1),
    longest_eclipse_h: s.longestEclipseHours.toFixed(2),
    longest_dte_gap_h: s.longestDteGapHours.toFixed(2),
    min_battery_pct: s.minBatterySocPct.toFixed(1),
    feasibility_score: s.feasibilityScore,
    score_is_heuristic: 1,
    verdict: s.verdict,
    data_confidence: s.dataConfidence,
    frame_verified: s.frameVerified ? 1 : 0,
    requested_step_min: s.sampling.requestedStepMinutes,
    effective_step_min: s.sampling.effectiveStepMinutes.toFixed(3),
    sample_count: s.sampling.sampleCount,
    sampling_capped: s.sampling.capped ? 1 : 0,
    ...prov,
  }]);
}

// ---- Comparison exports (v1.10): explicit per-row resolution states ----------

export interface ComparisonRow {
  scenario: Scenario;
  /** null when the scenario references a site that no longer exists — never silently substituted. */
  site: LandingSite | null;
  sim: SimulationResult | null;
  loading?: boolean;
  error?: string | null;
}

export type ComparisonResolutionState =
  | 'VALID' | 'SYNTHETIC_DEMO' | 'ILLUSTRATIVE'
  | 'COMPUTING' | 'BLOCKED' | 'COMPUTATION_FAILED' | 'MISSING_SITE' | 'STALE';

export interface ResolvedComparisonRow {
  scenario: Scenario;
  site: LandingSite | null;
  resolutionState: ComparisonResolutionState;
  analysisStatus: string | null;
  quantitativeEligible: boolean;
  summary: MissionSummary | null;
  failureReason: string | null;
  warnings: string[];
  dataConfidence: string | null;
  /** The current, eligible simulation — null unless the row is resolved AND current. */
  sim: SimulationResult | null;
}

/** Pure per-row resolution: blank numeric cells are never an implicit status. */
export function resolveComparisonRow(row: ComparisonRow): ResolvedComparisonRow {
  const base = {
    scenario: row.scenario, site: row.site,
    analysisStatus: null as string | null, quantitativeEligible: false,
    summary: null as MissionSummary | null, sim: null as SimulationResult | null,
    dataConfidence: row.site ? terrainDataConfidence(row.site) : null,
  };
  if (!row.site) {
    return { ...base, resolutionState: 'MISSING_SITE', failureReason: `Scenario references site "${row.scenario.siteId}", which no longer exists in this workspace. Reassign or remove the scenario.`, warnings: [] };
  }
  const warnings = reportWarnings(row.site, row.sim);
  if (row.error) {
    return { ...base, resolutionState: 'COMPUTATION_FAILED', failureReason: `Scenario computation failed: ${row.error}`, warnings };
  }
  const sim = row.sim;
  if (!sim) {
    return { ...base, resolutionState: 'COMPUTING', failureReason: 'Simulation not resolved yet — numeric fields are intentionally empty; no result is claimed.', warnings };
  }
  // Defense in depth: the cached result must belong to THIS scenario's inputs.
  const endMs = row.scenario.startMs + row.scenario.config.durationDays * DAY_MS;
  const windowMismatch = sim.summary != null && (sim.summary.startMs !== row.scenario.startMs || sim.summary.endMs !== endMs);
  const keyMismatch = simulationKey(sim.site, row.scenario.startMs, endMs, sim.config)
    !== simulationKey(row.site, row.scenario.startMs, endMs, sanitizeConfig(row.scenario.config));
  if (sim.site.id !== row.scenario.siteId || windowMismatch || keyMismatch) {
    return { ...base, resolutionState: 'STALE', analysisStatus: sim.analysis.status, failureReason: 'The cached result was computed for different scenario inputs (site, window or configuration) — it is not exported as current. Wait for the fresh result.', warnings };
  }
  if (sim.analysis.status === 'COMPUTATION_FAILED') {
    return { ...base, resolutionState: 'COMPUTATION_FAILED', analysisStatus: sim.analysis.status, failureReason: sim.analysis.reason, warnings };
  }
  if (!sim.analysis.demoEligible) {
    return { ...base, resolutionState: 'BLOCKED', analysisStatus: sim.analysis.status, failureReason: sim.analysis.reason, warnings };
  }
  return {
    ...base,
    resolutionState: sim.analysis.status as 'VALID' | 'SYNTHETIC_DEMO' | 'ILLUSTRATIVE',
    analysisStatus: sim.analysis.status,
    quantitativeEligible: sim.analysis.quantitativeEligible,
    summary: sim.summary,
    failureReason: null,
    warnings,
    dataConfidence: sim.summary?.dataConfidence ?? base.dataConfidence,
    sim,
  };
}

export const COMPARISON_EXPORT_POLICY =
  'Incomplete comparisons are permitted with an explicit per-row resolution state (VALID / SYNTHETIC_DEMO / ILLUSTRATIVE / COMPUTING / BLOCKED / COMPUTATION_FAILED / MISSING_SITE / STALE). Numeric fields stay empty/null unless the row is resolved and eligible — blank cells are never an implicit status and never zero-filled.';
export const COMPARISON_RANKING_NOTE =
  'Rows of different data-confidence tiers are never ranked together. The feasibility score is an application-defined heuristic, not a NASA methodology; Earth LOS is geometric, not an RF link budget.';

export async function comparisonCSV(rows: ComparisonRow[]): Promise<string> {
  const resolved = rows.map(resolveComparisonRow);
  const fps = await Promise.all(resolved.map((r) => r.sim && r.summary
    ? analysisFingerprint(r.sim.site, r.summary.startMs, r.summary.endMs, r.sim.config)
    : Promise.resolve('')));
  return toCSV(resolved.map((r, i) => {
    const s = r.summary;
    const t = r.site?.terrain;
    // Free-text columns (label/site/failure_reason/warnings) come LAST so quoted
    // commas never shift the numeric columns for naive parsers.
    return {
      scenario_id: r.scenario.id,
      resolution_state: r.resolutionState,
      analysis_status: r.analysisStatus ?? '',
      quantitative_eligible: r.sim ? (r.quantitativeEligible ? 1 : 0) : '',
      site_id: r.scenario.siteId,
      latitude: r.site?.latitude ?? '',
      longitude: r.site?.longitude ?? '',
      coordinate_type: r.site?.coordinateType ?? '',
      data_confidence: r.dataConfidence ?? '',
      terrain_kind: t?.kind ?? '',
      source_frame: t?.sourceFrame ?? '',
      frame_transform: t?.frameTransform ?? '',
      horizon_scale: r.site ? 'LOCAL' : '',
      start_utc: new Date(r.scenario.startMs).toISOString(),
      end_utc: new Date(r.scenario.startMs + r.scenario.config.durationDays * DAY_MS).toISOString(),
      duration_days: r.scenario.config.durationDays,
      array_mode: r.scenario.config.arrayMode,
      load_w: r.scenario.config.loadW,
      array_area_m2: r.scenario.config.arrayAreaM2,
      step_minutes: r.scenario.config.stepMinutes,
      illumination_pct: s?.illuminationPct.toFixed(2) ?? '',
      dte_pct: s?.dtePct.toFixed(2) ?? '',
      combined_pct: s?.combinedPct.toFixed(2) ?? '',
      mean_sun_el_deg: s?.meanSunElevationDeg.toFixed(3) ?? '',
      peak_sun_el_deg: s?.peakSunElevationDeg.toFixed(3) ?? '',
      mean_horizontal_w: s?.meanHorizontalW.toFixed(1) ?? '',
      mean_vertical_w: s?.meanVerticalTrackingW.toFixed(1) ?? '',
      longest_eclipse_h: s?.longestEclipseHours.toFixed(2) ?? '',
      min_battery_pct: s?.minBatterySocPct.toFixed(1) ?? '',
      score: s?.feasibilityScore ?? '',
      score_is_heuristic: s ? 1 : '',
      verdict: s?.verdict ?? '',
      effective_step_min: s?.sampling.effectiveStepMinutes.toFixed(3) ?? '',
      sample_count: s?.sampling.sampleCount ?? '',
      analysis_fingerprint: fps[i] ? shortFingerprint(fps[i]) : '',
      app_version: APP_VERSION,
      report_schema: REPORT_SCHEMA_VERSION,
      label: r.scenario.label ?? '',
      site: r.site?.name ?? '',
      failure_reason: r.failureReason ?? '',
      warnings: r.warnings.join('; '),
    };
  }));
}

export async function comparisonJSON(rows: ComparisonRow[]): Promise<string> {
  const resolved = rows.map(resolveComparisonRow);
  const fps = await Promise.all(resolved.map((r) => r.sim && r.summary
    ? analysisFingerprint(r.sim.site, r.summary.startMs, r.summary.endMs, r.sim.config)
    : Promise.resolve(null)));
  return JSON.stringify({
    product: 'CHANDRA scenario comparison',
    applicationVersion: APP_VERSION,
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    schemaVersionPolicy: REPORT_SCHEMA_POLICY,
    generatedAt: new Date().toISOString(),
    timeReference: 'UTC',
    policy: COMPARISON_EXPORT_POLICY,
    rankingNote: COMPARISON_RANKING_NOTE,
    rows: resolved.map((r, i) => ({
      scenario: r.scenario,
      resolutionState: r.resolutionState,
      analysisStatus: r.analysisStatus,
      analysis: r.sim?.analysis ?? null,
      quantitativeEligible: r.quantitativeEligible,
      dataConfidence: r.dataConfidence,
      failureReason: r.failureReason,
      warnings: r.warnings,
      analysisFingerprint: fps[i],
      requestedConfig: r.scenario.config,
      effectiveConfig: r.sim?.config ?? null,
      site: r.site ? { id: r.site.id, name: r.site.name, latitude: r.site.latitude, longitude: r.site.longitude, elevationM: r.site.elevationM } : null,
      siteProvenance: r.site ? {
        siteId: r.site.id, siteName: r.site.name,
        coordinateType: r.site.coordinateType ?? null,
        coordinateProvenance: r.site.coordinateProvenance ?? null,
        coordinateUncertaintyDeg: r.site.coordinateUncertaintyDeg ?? null,
        sourceUrl: r.site.sourceUrl ?? null, sourceDate: r.site.sourceDate ?? null,
        dataConfidence: r.dataConfidence,
        terrainKind: r.site.terrain.kind,
        sourceFile: r.site.terrain.sourceFile ?? null,
        sourceFrame: r.site.terrain.sourceFrame ?? null,
        frameVerified: r.site.terrain.frameVerified ?? (r.site.terrain.kind !== 'dem'),
        frameTransform: r.site.terrain.frameTransform ?? null,
        frameResidualDeg: r.site.terrain.frameResidualDeg ?? null,
        validatedEpochRange: (r.site.terrain.frameTransform === 'me' || r.site.terrain.frameTransform === 'pa') ? FRAME_VALIDATED_RANGE_LABEL : null,
        horizonScale: 'LOCAL HORIZON',
        disclosure: terrainDisclosure(r.site, r.sim?.analysis ?? null),
      } : null,
      summary: r.summary,
    })),
  }, null, 2);
}
