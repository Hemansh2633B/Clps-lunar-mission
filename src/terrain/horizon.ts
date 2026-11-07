import type { HorizonMask, TerrainData } from './types';

function sampleHeight(data: TerrainData, east: number, north: number): number | null {
  const n = data.grid.size;
  const radiusM = data.radius_km * 1000;
  const spacing = data.grid.spacing_m;
  const col = (east + radiusM) / spacing;
  const row = (radiusM - north) / spacing;
  const c = Math.floor(col);
  const r = Math.floor(row);
  if (c < 0 || r < 0 || c >= n - 1 || r >= n - 1) return null;
  const heights = [r * n + c, r * n + c + 1, (r + 1) * n + c, (r + 1) * n + c + 1].map((i) => data.grid.elevations_m[i]);
  if (heights.some((h) => h === null)) return null;
  const u = col - c;
  const v = row - r;
  const [h0, h1, h2, h3] = heights as number[];
  return h0 * (1 - u) * (1 - v) + h1 * u * (1 - v) + h2 * (1 - u) * v + h3 * u * v;
}

/**
 * Ray-marched horizon from the loaded grid; NoData rays are reported, never filled.
 *
 * A conservative edge inset of sqrt(2) grid spacings guarantees that every
 * bilinear stencil lies inside the analysis disk, so a fully covered DEM does
 * not report artificial NoData at the circular boundary. The excluded annulus
 * is disclosed as `edge_inset_m` / `horizon_radius_km`; it is not filled.
 */
export function horizonFromGrid(data: TerrainData, azStepDeg = 2, eyeHeightM = 2): HorizonMask {
  if (!Number.isInteger(azStepDeg) || azStepDeg < 1 || azStepDeg > 15 || 360 % azStepDeg !== 0) {
    throw new Error('az_step_deg must be an integer between 1 and 15 that divides 360.');
  }
  if (!Number.isFinite(eyeHeightM) || eyeHeightM < 0 || eyeHeightM > 50) {
    throw new Error('eye_height_m must be between 0 and 50 meters.');
  }
  const azimuths: number[] = [];
  const elevations: number[] = [];
  const coverage: number[] = [];
  const ranges: number[] = [];
  const radiusM = data.radius_km * 1000;
  const spacing = data.grid.spacing_m;
  const edgeInsetM = spacing * Math.SQRT2;
  const horizonRadiusM = Math.max(spacing, radiusM - edgeInsetM);
  const samplingStepM = Math.max(spacing * 0.5, 1);
  const lunarRadius = data.source.lunar_radius_m;
  const datumRadius = data.source.elevation_reference_radius_m;
  const observerHeight = data.landing_elevation_m + eyeHeightM;
  for (let az = 0; az < 360; az += azStepDeg) {
    const bearing = (az * Math.PI) / 180;
    let best = -90;
    let bestRange = 0;
    let valid = 0;
    let total = 0;
    for (let distance = spacing; distance <= horizonRadiusM + 1e-6; distance += samplingStepM) {
      total++;
      const h = sampleHeight(data, distance * Math.sin(bearing), distance * Math.cos(bearing));
      if (h == null) continue;
      valid++;
      const angle = distance / lunarRadius;
      const radial = datumRadius + h;
      const scale = (radial * Math.sin(angle)) / distance;
      const up = radial * Math.cos(angle) - (datumRadius + observerHeight);
      const horizontal = distance * scale;
      const elevation = (Math.atan2(up, horizontal) * 180) / Math.PI;
      if (elevation > best) {
        best = elevation;
        bestRange = distance;
      }
    }
    azimuths.push(az);
    elevations.push(Math.round(best * 10000) / 10000);
    coverage.push(total ? Math.round((100 * valid) / total * 100) / 100 : 0);
    ranges.push(Math.round((bestRange / 1000) * 10000) / 10000);
  }
  return {
    latitude: data.latitude,
    longitude: data.longitude,
    radius_km: data.radius_km,
    horizon_radius_km: Math.round((horizonRadiusM / 1000) * 10000) / 10000,
    edge_inset_m: Math.round(edgeInsetM * 1000) / 1000,
    sampling_step_m: Math.round(samplingStepM * 1000) / 1000,
    grid_size: data.grid.size,
    grid_spacing_m: spacing,
    eye_height_m: eyeHeightM,
    azimuth_step_deg: azStepDeg,
    azimuths_deg: azimuths,
    elevations_deg: elevations,
    ray_coverage_percent: coverage,
    max_obstacle_range_km: ranges,
    mean_coverage_percent: Math.round((coverage.reduce((a, b) => a + b, 0) / coverage.length) * 100) / 100,
    synthetic: data.synthetic,
    source: data.source,
    model: 'Ray-marched DEM grid horizon in the landing tangent frame; spherical curvature included. A conservative edge inset keeps bilinear stencils inside the analysis disk. NoData rays are reported, never filled.',
    frame_note: 'Verify the DEM lunar_reference_frame matches the ephemeris body frame before using this mask for mission visibility.',
  };
}
