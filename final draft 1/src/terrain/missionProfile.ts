import type { TerrainProfile } from '../types/mission';
import type { HorizonMask } from './types';

/**
 * Convert a ray-marched DEM horizon into a mission terrain profile WITHOUT
 * re-synthesizing it. The measured/sample elevations are preserved verbatim;
 * no illustrative ripple, base offset, or elevation clamp is applied.
 */
export function terrainProfileFromHorizon(mask: HorizonMask): TerrainProfile {
  if (mask.azimuths_deg.length !== mask.elevations_deg.length || mask.elevations_deg.length === 0) {
    throw new Error('Horizon mask has inconsistent azimuth/elevation arrays.');
  }
  if (360 % mask.azimuth_step_deg !== 0 || mask.elevations_deg.length !== 360 / mask.azimuth_step_deg) {
    throw new Error('Horizon mask azimuth step does not match its sample count.');
  }
  const kindLabel = mask.synthetic ? 'Synthetic demo horizon' : 'DEM-derived horizon';
  return {
    label: `${kindLabel} · ${mask.source.filename}`,
    kind: 'dem',
    resolutionDeg: mask.azimuth_step_deg,
    elevations: [...mask.elevations_deg],
    features: [],
    uncertaintyDeg: mask.azimuth_step_deg / 2,
    eyeHeightM: mask.eye_height_m,
    sourceFrame: mask.source.lunar_reference_frame,
    sourceFile: mask.source.filename,
    synthetic: mask.synthetic,
    coveragePercent: mask.mean_coverage_percent,
    radiusKm: mask.radius_km,
    horizonRadiusKm: mask.horizon_radius_km,
    gridSize: mask.grid_size,
    samplingDeg: mask.azimuth_step_deg,
    accuracyNote: 'Azimuth sampling half-width is shown; vertical accuracy is not provided by the DEM metadata and is not certified.',
  };
}

export function horizonImportBlocked(mask: HorizonMask): string | null {
  if (mask.synthetic) return null; // allowed, but clearly labeled as a demo everywhere downstream
  if (mask.mean_coverage_percent < 100) {
    return 'Real DEM horizon has incomplete ray coverage. Download a wider crop or choose a covered location before using it in the mission planner.';
  }
  if (mask.elevations_deg.some((h) => h <= -89.9)) {
    return 'One or more rays found no valid terrain sample. The mask cannot be used as a complete mission horizon.';
  }
  return null;
}
