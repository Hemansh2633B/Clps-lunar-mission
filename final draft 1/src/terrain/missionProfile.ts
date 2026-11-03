import type { TerrainProfile } from '../types/mission';
import type { HorizonMask } from './types';
import { classifyFrame, convertSite, rotateMaskAzimuths, frameResidualDeg } from '../engine/lunarFrame';

/**
 * Convert a ray-marched DEM horizon into a mission terrain profile WITHOUT
 * re-synthesizing it. The measured/sample elevations are preserved verbatim;
 * no illustrative ripple, base offset, or elevation clamp is applied.
 *
 * Frame compatibility is resolved here, at the boundary between the DEM source
 * frame and the IAU 2015 ephemeris frame. Recognized frames (MOON_ME / MOON_PA /
 * IAU) are rotated into the ephemeris frame with SPICE-verified constants and the
 * residual is disclosed. An unrecognized frame is marked FRAME UNVERIFIED and is
 * blocked from quantitative mission visibility by horizonImportBlocked (it remains
 * viewable in Terrain Lab). Frames are never combined silently.
 */
export function terrainProfileFromHorizon(mask: HorizonMask): TerrainProfile {
  if (mask.azimuths_deg.length !== mask.elevations_deg.length || mask.elevations_deg.length === 0) {
    throw new Error('Horizon mask has inconsistent azimuth/elevation arrays.');
  }
  if (360 % mask.azimuth_step_deg !== 0 || mask.elevations_deg.length !== 360 / mask.azimuth_step_deg) {
    throw new Error('Horizon mask azimuth step does not match its sample count.');
  }
  const cls = classifyFrame(mask.source.lunar_reference_frame);
  let elevations = [...mask.elevations_deg];
  let azimuthOffsetDeg = 0;
  let frameVerified: boolean;
  let frameNote: string;
  let frameTransform: TerrainProfile['frameTransform'] = null;
  let frameResidual = 0;

  if (mask.synthetic) {
    // Procedural demo: no real reference frame applies. Allowed as a labeled demo,
    // never upgraded to a measured/scientific result downstream.
    frameVerified = true;
    frameNote = 'Synthetic demo horizon — procedural, no real lunar reference frame. Not for scientific use.';
  } else if (cls.recognized && cls.transform) {
    const conv = convertSite(mask.latitude, mask.longitude, cls.transform);
    azimuthOffsetDeg = conv.azimuthOffsetDeg;
    elevations = rotateMaskAzimuths(elevations, mask.azimuth_step_deg, azimuthOffsetDeg);
    frameVerified = true;
    frameTransform = cls.transform;
    frameResidual = frameResidualDeg(cls.transform);
    frameNote = cls.note;
  } else {
    frameVerified = false;
    frameNote = cls.note;
  }

  const kindLabel = mask.synthetic ? 'Synthetic demo horizon' : 'DEM-derived horizon';
  return {
    label: `${kindLabel} · ${mask.source.filename}`,
    kind: 'dem',
    resolutionDeg: mask.azimuth_step_deg,
    elevations,
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
    frameVerified,
    frameTransform,
    frameNote,
    frameResidualDeg: frameResidual,
    azimuthOffsetDeg,
    analysisScale: 'local',
    effectiveResolutionM: mask.grid_spacing_m,
  };
}

/**
 * Gate quantitative mission use of an imported horizon. Synthetic demos are
 * allowed (clearly labeled everywhere). A real DEM with an unrecognized frame is
 * FRAME UNVERIFIED: viewable in Terrain Lab, but blocked from mission visibility.
 * Incomplete ray coverage or NoData rays also block import (never invent elevations).
 */
export function horizonImportBlocked(mask: HorizonMask): string | null {
  if (mask.synthetic) return null; // allowed, but clearly labeled as a demo everywhere downstream
  const cls = classifyFrame(mask.source.lunar_reference_frame);
  if (!cls.recognized) {
    return `FRAME UNVERIFIED — ${cls.note} This horizon can be viewed in Terrain Lab but cannot be used for quantitative mission visibility until its reference frame is confirmed compatible with the IAU 2015 ephemeris frame.`;
  }
  if (mask.mean_coverage_percent < 100) {
    return 'Real DEM horizon has incomplete ray coverage. Download a wider crop or choose a covered location before using it in the mission planner.';
  }
  if (mask.elevations_deg.some((h) => h <= -89.9)) {
    return 'One or more rays found no valid terrain sample. The mask cannot be used as a complete mission horizon.';
  }
  return null;
}
