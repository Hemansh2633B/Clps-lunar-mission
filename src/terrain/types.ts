export type TerrainQuality = 'low' | 'medium' | 'high';
export type TerrainMode = 'real' | 'synthetic';

export interface TerrainSource {
  filename: string;
  crs_name?: string;
  crs_wkt?: string;
  lunar_radius_m: number;
  elevation_reference_radius_m: number;
  latitude_convention?: string;
  elevation_reference: string;
  vertical_unit?: string;
  lunar_reference_frame?: string;
  value_kind?: string;
  scale?: number;
  offset?: number;
  source_resolution?: number[];
  source_resolution_unit?: string;
  width?: number;
  height?: number;
  synthetic: boolean;
  warning?: string;
}

export interface TerrainData {
  mode: TerrainMode;
  synthetic: boolean;
  latitude: number;
  longitude: number;
  radius_km: number;
  grid: {
    size: number;
    spacing_m: number;
    order: string;
    elevations_m: (number | null)[];
  };
  landing_elevation_m: number;
  statistics: {
    minimum_m: number;
    maximum_m: number;
    range_m: number;
    coverage_percent: number;
  };
  source: TerrainSource;
}

export interface TerrainConfig {
  dem_ready: boolean;
  source: TerrainSource | null;
  dem_error: string | null;
  quality_grids: Record<TerrainQuality, number>;
  radius_limits_km: [number, number];
  latitude_convention: string;
  longitude_convention: string;
  synthetic_warning: string;
  render_coordinates: string;
  geometry_model: string;
}

export interface TerrainExample {
  label: string;
  latitude: number;
  longitude: number;
  radius_km: number;
  notes: string;
}

export interface HorizonMask {
  latitude: number;
  longitude: number;
  radius_km: number;
  /** Outer annulus excluded so bilinear stencils never cross the analysis-disk edge. */
  horizon_radius_km: number;
  edge_inset_m: number;
  sampling_step_m: number;
  grid_size: number;
  grid_spacing_m: number;
  eye_height_m: number;
  azimuth_step_deg: number;
  azimuths_deg: number[];
  elevations_deg: number[];
  ray_coverage_percent: number[];
  max_obstacle_range_km: number[];
  mean_coverage_percent: number;
  synthetic: boolean;
  source: TerrainSource;
  model: string;
  frame_note: string;
}

export interface SurfaceInspection {
  east_m: number;
  north_m: number;
  elevation_m: number;
  distance_m: number;
  latitude: number;
  longitude: number;
  pinned: boolean;
}

export interface SunPosition {
  azimuthDeg: number;
  elevationDeg: number;
  source: 'manual' | 'ephemeris';
}
