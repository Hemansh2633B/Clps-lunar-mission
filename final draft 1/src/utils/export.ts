import type { EvaluatedSample, LandingSite, MissionConfig, SimulationResult, Scenario } from '../types/mission';
import { mjd } from '../engine/constants';
import { horizonTable } from '../engine/horizonPhysics';

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

export function missionReportJSON(site: LandingSite, config: MissionConfig, sim: SimulationResult | null, current: EvaluatedSample) {
  const terrainDisclaimer = site.terrain.kind === 'dem'
    ? site.terrain.synthetic
      ? 'Terrain: synthetic demo horizon from Terrain Lab, NOT real lunar data.'
      : `Terrain: DEM-derived horizon preserved from ${site.terrain.sourceFile ?? 'local DEM'}; source frame ${site.terrain.sourceFrame ?? 'unspecified'}; coverage ${site.terrain.coveragePercent ?? 'unknown'}%. Verify frame alignment and vertical accuracy before operational use.`
    : site.terrain.kind === 'custom'
      ? 'Terrain: user-edited 8-sector horizon mask, NOT a measured DEM.'
      : 'Terrain: LOLA-inspired illustrative masks, NOT flight-certified DEM.';
  return JSON.stringify({
    product: 'SELENE mission planning report',
    generatedAt: new Date().toISOString(),
    disclaimer: `Ephemeris: astronomy-engine + IAU 2015 Moon rotation. ${terrainDisclaimer} Power: idealized cosine model with system derate. Center-of-disk LOS; no atmospheric refraction.`,
    site,
    config,
    current: { ...current, mjd: mjd(current.timeMs) },
    summary: sim?.summary ?? null,
    events: sim?.events ?? [],
    horizonProfile: site.terrain,
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
  return toCSV([{
    site: sim.site.name,
    latitude: sim.site.latitude,
    longitude: sim.site.longitude,
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
    verdict: s.verdict,
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
    illumination_pct: sim?.summary.illuminationPct.toFixed(2) ?? '',
    dte_pct: sim?.summary.dtePct.toFixed(2) ?? '',
    combined_pct: sim?.summary.combinedPct.toFixed(2) ?? '',
    mean_sun_el_deg: sim?.summary.meanSunElevationDeg.toFixed(3) ?? '',
    peak_sun_el_deg: sim?.summary.peakSunElevationDeg.toFixed(3) ?? '',
    mean_horizontal_w: sim?.summary.meanHorizontalW.toFixed(1) ?? '',
    mean_vertical_w: sim?.summary.meanVerticalTrackingW.toFixed(1) ?? '',
    longest_eclipse_h: sim?.summary.longestEclipseHours.toFixed(2) ?? '',
    min_battery_pct: sim?.summary.minBatterySocPct.toFixed(1) ?? '',
    score: sim?.summary.feasibilityScore ?? '',
    verdict: sim?.summary.verdict ?? '',
  })));
}
