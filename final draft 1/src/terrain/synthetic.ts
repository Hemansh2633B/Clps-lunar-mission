import type { TerrainData, TerrainQuality } from './types';

export const QUALITY_GRIDS: Record<TerrainQuality, number> = { low: 129, medium: 257, high: 513 };
export const SYNTHETIC_WARNING = 'SYNTHETIC TERRAIN — NOT REAL LUNAR DATA';

/** Built-in offline demo matching backend/synthetic.py. Never used for real mode. */
export function syntheticTerrain(latitude: number, longitude: number, radiusKm: number, quality: TerrainQuality = 'medium'): TerrainData {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error('Latitude must be between -90 and +90 degrees.');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 360) throw new Error('Longitude must be in -180…180 or 0…360 degrees.');
  if (!Number.isFinite(radiusKm) || radiusKm < 0.5 || radiusKm > 20) throw new Error('Radius must be between 0.5 and 20 km.');
  const size = QUALITY_GRIDS[quality];
  if (!size) throw new Error('Unknown terrain quality.');
  const lon = ((longitude + 180) % 360 + 360) % 360 - 180;
  const radiusM = radiusKm * 1000;
  const spacing = (2 * radiusM) / (size - 1);
  const elevations: (number | null)[] = new Array(size * size).fill(null);
  let min = Infinity;
  let max = -Infinity;
  let validCount = 0;
  let diskCount = 0;
  let landing = 0;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const east = -radiusM + col * spacing;
      const north = radiusM - row * spacing;
      if (Math.hypot(east, north) > radiusM + 1e-6) continue;
      diskCount++;
      const x = east / radiusM;
      const y = north / radiusM;
      const d = Math.hypot(x - 0.23, y + 0.12);
      const h = -1850 + 230 * Math.exp(-(((d - 0.43) / 0.075) ** 2))
        - 320 * Math.exp(-((d / 0.29) ** 4))
        + 110 * Math.exp(-(((x + 0.6 + y * 0.3) / 0.11) ** 2))
        + 25 * Math.sin(8 * x) * Math.cos(6 * y);
      const rounded = Math.round(h * 1000) / 1000;
      elevations[row * size + col] = rounded;
      min = Math.min(min, rounded);
      max = Math.max(max, rounded);
      validCount++;
      if (row === Math.floor(size / 2) && col === Math.floor(size / 2)) landing = rounded;
    }
  }
  return {
    mode: 'synthetic',
    synthetic: true,
    latitude,
    longitude: lon,
    radius_km: radiusKm,
    grid: { size, spacing_m: spacing, order: 'row-major; rows north-to-south, columns west-to-east', elevations_m: elevations },
    landing_elevation_m: landing,
    statistics: { minimum_m: min, maximum_m: max, range_m: max - min, coverage_percent: Math.round((100 * validCount) / diskCount * 100) / 100 },
    source: {
      filename: 'Built-in synthetic demo',
      lunar_radius_m: 1737400,
      elevation_reference_radius_m: 1737400,
      elevation_reference: 'Artificial test elevations; no scientific datum',
      lunar_reference_frame: 'Artificial demo frame',
      synthetic: true,
      warning: SYNTHETIC_WARNING,
    },
  };
}
