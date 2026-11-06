import type { EvaluatedSample, LandingSite, MissionConfig, SimulationResult, Scenario } from '../types/mission';
import { mjd } from '../engine/constants';
import { horizonTable } from '../engine/horizonPhysics';
import { EPHEMERIS_FRAME, frameResidualDeg } from '../engine/lunarFrame';
import { BATTERY_CHARGE_EFF, BATTERY_DISCHARGE_EFF, terrainDataConfidence } from '../engine/powerComms';

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
  if (t.kind === 'dem' && !t.synthetic && t.frameVerified) w.push(`Frame corrected ${t.frameTransform?.toUpperCase()} → IAU with a constant rotation; disclosed residual ≤ ${(t.frameResidualDeg ?? frameResidualDeg(t.frameTransform ?? null)).toFixed(4)}° (~120 m). Not a time-dependent rigorous transformation.`);
  if (conf !== 'measured') w.push(`Data confidence is "${conf}", not measured — do not treat the feasibility score as a measured-terrain ranking.`);
  w.push('Feasibility score is an application-defined heuristic, NOT a NASA methodology.');
  w.push('Earth visibility is geometric line-of-sight only — NOT an RF link budget.');
  w.push('Battery result is an energy-balance model only — NOT thermal/radiation survival.');
  if (sim?.sampling.capped) w.push(`Sampling capped at ${sim.sampling.sampleCount} samples; step coarsened to ${sim.sampling.effectiveStepMinutes.toFixed(2)} min (full span + both endpoints preserved).`);
  return w;
}

export function missionReportJSON(site: LandingSite, config: MissionConfig, sim: SimulationResult | null, current: EvaluatedSample) {
  const t = site.terrain;
  const conf = sim?.summary?.dataConfidence ?? terrainDataConfidence(site);
  const terrainDisclaimer = t.kind === 'dem'
    ? t.synthetic
      ? 'Terrain: synthetic demo horizon from Terrain Lab, NOT real lunar data.'
      : `Terrain: DEM-derived horizon preserved from ${t.sourceFile ?? 'local DEM'}; source frame ${t.sourceFrame ?? 'unspecified'}; coverage ${t.coveragePercent ?? 'unknown'}%. Verify frame alignment and vertical accuracy before operational use.`
    : t.kind === 'custom'
      ? 'Terrain: user-edited 8-sector horizon mask, NOT a measured DEM.'
      : 'Terrain: LOLA-inspired illustrative masks, NOT flight-certified DEM.';

  // Full reproducibility metadata: everything needed to reconstruct and audit the run.
  const reproducibility = {
    timeReference: 'UTC',
    interval: sim?.summary ? { startUtc: new Date(sim.summary.startMs).toISOString(), endUtc: new Date(sim.summary.endMs).toISOString(), durationHours: sim.summary.durationHours } : null,
    analysisStatus: sim?.analysis ?? null,
    energyIntegration: sim?.summary?.integrationDiagnostics ?? null,
    transitionDetection: sim?.transitionDiagnostics ?? null,
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
      resolutionDeg: t.resolutionDeg,
      effectiveResolutionM: t.effectiveResolutionM ?? null,
      radiusKm: t.radiusKm ?? null,
      horizonRadiusKm: t.horizonRadiusKm ?? null,
      coveragePercent: t.coveragePercent ?? null,
      verticalUncertaintyM: t.verticalUncertaintyM ?? null,
      analysisScale: t.analysisScale ?? 'local',
      angularUncertaintyDeg: t.uncertaintyDeg,
    },
    sampling: sim?.sampling ?? null,
    powerAssumptions: {
      model: 'idealized cosine incidence; zero output when Sun terrain-occulted',
      solarConstantWm2: 1361,
      arrayMode: config.arrayMode,
      arrayAreaM2: config.arrayAreaM2,
      cellEfficiency: config.cellEfficiency,
      systemDerate: config.systemDerate,
      fixedPanelAzimuthDeg: config.fixedPanelAzimuthDeg,
      loadW: config.loadW,
      note: 'Instantaneous power; no temperature, dust, or degradation effects.',
    },
    batteryAssumptions: {
      capacityKWh: config.batteryCapacityKWh,
      initialSocPct: config.initialSocPct,
      chargeEfficiency: BATTERY_CHARGE_EFF,
      dischargeEfficiency: BATTERY_DISCHARGE_EFF,
      note: 'Energy-balance model with hard SOC bounds; NOT thermal/radiation survival.',
    },
    scoreMethodology: sim?.summary?.scoreBreakdown ?? { heuristic: true, note: 'Application-defined heuristic, not a NASA methodology.' },
    warnings: reportWarnings(site, sim),
  };

  return JSON.stringify({
    product: 'CHANDRA mission planning report',
    schemaVersion: '1.7.0-product',
    generatedAt: new Date().toISOString(),
    disclaimer: `Ephemeris: astronomy-engine + IAU 2015 Moon rotation. ${terrainDisclaimer} Power: idealized cosine model with system derate. Geometric center-of-disk LOS (not an RF link budget); no atmospheric refraction. Feasibility score is an application-defined heuristic, not a NASA methodology. Data confidence: ${conf}.`,
    site,
    config,
    current: { ...current, mjd: mjd(current.timeMs) },
    summary: sim?.summary ?? null,
    events: sim?.events ?? [],
    horizonProfile: site.terrain,
    reproducibility,
  }, null, 2);
}

export function timeseriesCSV(sim: SimulationResult): string {
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
  })));
}

export function horizonCSV(site: LandingSite, current: EvaluatedSample): string {
  const step = site.terrain.kind === 'dem' ? site.terrain.resolutionDeg : 5;
  return toCSV(horizonTable(site, current, step).map((r) => ({
    azimuth_deg: r.azimuthDeg,
    terrain_elevation_deg: r.terrainElevationDeg.toFixed(4),
    sun_clearance_deg: r.sunClearanceDeg == null ? '' : r.sunClearanceDeg.toFixed(4),
    earth_clearance_deg: r.earthClearanceDeg == null ? '' : r.earthClearanceDeg.toFixed(4),
  })));
}

export function summaryCSV(sim: SimulationResult): string {
  const s = sim.summary;
  if (!s) {
    // Blocked analysis: never emit ordinary-looking quantitative rows.
    return toCSV([{ site: sim.site.name, analysis_status: sim.analysis.status, quantitative_eligible: 0, note: 'Analysis blocked — no quantitative summary exported.' }]);
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
  }]);
}

export interface ComparisonRow {
  scenario: Scenario;
  site: LandingSite;
  sim: SimulationResult | null;
}

export function comparisonCSV(rows: ComparisonRow[]): string {
  return toCSV(rows.map(({ scenario, site, sim }) => ({
    label: scenario.label || site.shortName,
    site: site.name,
    latitude: site.latitude,
    longitude: site.longitude,
    start_utc: new Date(scenario.startMs).toISOString(),
    duration_days: scenario.config.durationDays,
    array_mode: scenario.config.arrayMode,
    analysis_status: sim?.analysis.status ?? '',
    illumination_pct: sim?.summary?.illuminationPct.toFixed(2) ?? '',
    dte_pct: sim?.summary?.dtePct.toFixed(2) ?? '',
    combined_pct: sim?.summary?.combinedPct.toFixed(2) ?? '',
    mean_sun_el_deg: sim?.summary?.meanSunElevationDeg.toFixed(3) ?? '',
    peak_sun_el_deg: sim?.summary?.peakSunElevationDeg.toFixed(3) ?? '',
    mean_horizontal_w: sim?.summary?.meanHorizontalW.toFixed(1) ?? '',
    mean_vertical_w: sim?.summary?.meanVerticalTrackingW.toFixed(1) ?? '',
    longest_eclipse_h: sim?.summary?.longestEclipseHours.toFixed(2) ?? '',
    min_battery_pct: sim?.summary?.minBatterySocPct.toFixed(1) ?? '',
    score: sim?.summary?.feasibilityScore ?? '',
    score_is_heuristic: sim ? 1 : '',
    verdict: sim?.summary?.verdict ?? '',
    data_confidence: sim?.summary?.dataConfidence ?? '',
    frame_verified: sim?.summary ? (sim.summary.frameVerified ? 1 : 0) : '',
    effective_step_min: sim?.summary?.sampling.effectiveStepMinutes.toFixed(3) ?? '',
  })));
}
