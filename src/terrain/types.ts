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
  /** Native backend (API 1.1+): which stored dataset answered, and its acquisition provenance. */
  dataset_id?: string;
  provenance?: Record<string, unknown>;
}

/** How the native engine resampled the source raster (API 1.1+). */
export interface TerrainProcessing {
  engine: string;
  resampling: string;
  kernel: string;
  kernel_scale: [number, number];
  transform: string;
  dataset_id?: string;
}

export interface StorageInfo { kind: string; persistent: boolean; }

export interface FrameClassificationInfo {
  recognized: boolean;
  transform: string | null;
  identifier: string | null;
  realization: string | null;
  note: string;
}

export interface DatasetEntry {
  id: string;
  kind: 'configured' | 'acquired';
  ready: boolean;
  source: TerrainSource | null;
  error: string | null;
  frame?: FrameClassificationInfo;
}

export interface AcquisitionProduct {
  id: string;
  url: string;
  product_page: string;
  /** Product-name nominal pixel scale; actual subset spacing is reported from the raster. */
  nominal_resolution_m?: string;
  /** Plain-language documented coverage; exact footprint is checked from GeoTIFF CRS/georeferencing. */
  coverage_note?: string;
  provider?: string;
}

export interface DatasetsResponse {
  datasets: DatasetEntry[];
  storage: StorageInfo;
  acquisition: { enabled: boolean; products: AcquisitionProduct[]; max_subset_pixels: number };
}

export interface DatasetMetadata {
  dataset_id: string;
  source: TerrainSource;
  raster: {
    width: number; height: number; bits_per_sample: number; sample_format: string; compression: string | number;
    predictor: number; layout: string; nodata: number | 'nan' | null; overviews: number; gdal_tags?: Record<string, string> | null;
  };
  georeferencing: {
    geotransform: number[];
    bounds: { left: number; bottom: number; right: number; top: number };
    unit: string; projection: string; geographic: boolean;
    footprint: { corner: string; x: number; y: number; latitude?: number; longitude?: number }[];
  };
  frame: FrameClassificationInfo;
  eligibility: { frame_recognized: boolean; synthetic: boolean; quantitative_candidate: boolean; note: string; notes: string[] };
  validated_frame_interval_utc: [string, string];
}

export interface AcquirePlan {
  latitude: number;
  longitude: number;
  analysis_radius_km: number;
  /** left, top, width, height in source pixels. */
  source_pixel_window: [number, number, number, number];
  pixels: number;
  estimated_download_bytes: number;
  source_blocks: number;
  source_width: number;
  source_height: number;
  native_resolution: number;
  native_resolution_unit: string;
}

export interface AcquireResponse {
  dry_run: boolean;
  plan: AcquirePlan;
  product: AcquisitionProduct;
  dataset?: DatasetEntry;
  sha256?: string;
  bytes?: number;
  storage?: StorageInfo;
}

export interface BackendCapabilities { datasets: boolean; sources: boolean; metadata: boolean; acquire: boolean; horizons: boolean; }

export interface SourcesResponse {
  schema_version: string;
  catalogue_date: string;
  runtime: { deployment: string; engine: string; horizons_enabled: boolean; acquisition_enabled: boolean; storage: StorageInfo };
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
  processing?: TerrainProcessing;
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
  /** Native backend (API 1.1+). Absent on the v1.11 contract. */
  engine?: string;
  api_version?: string;
  deployment?: string;
  capabilities?: BackendCapabilities;
  storage?: StorageInfo;
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
  /** Native backend (API 1.1+): resampling provenance. */
  processing?: TerrainProcessing;
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
