/**
 * Typed view of the Lunar Data Hub catalogue. The JSON file is the single source
 * of truth: the native backend embeds the same bytes (backend/catalog) and serves
 * them at /api/sources, and the frontend bundles them so the hub works offline
 * and on a static deployment with no backend.
 *
 * Unknown values are `null` and are rendered as "Not confirmed" — never as a
 * guess, zero or "none".
 */
import raw from '../../backend/catalog/catalogue.json';
import type { MapLayerSpec } from '../map/polarProjection';

export type SourceCategory = 'imagery' | 'dem' | 'terrain' | 'lighting' | 'ephemeris' | 'mission' | 'provenance';
export type SourceAvailability = 'bundled' | 'link-out' | 'live-backend' | 'live-remote' | 'remote-range';
export type SourceIntegration = 'acquire' | 'engine' | 'link-out' | 'polar-map-layer' | 'site-catalogue' | 'tests' | 'verification';

export interface CatalogueSource {
  id: string;
  category: SourceCategory;
  provider: string;
  product_name: string;
  product_id: string | null;
  version: string | null;
  spatial_resolution: string | null;
  coverage: string | null;
  coordinate_system: string | null;
  reference_frame: string | null;
  vertical_datum: string | null;
  publication_date: string | null;
  retrieval_date: string | null;
  attribution: string | null;
  usage_terms: string | null;
  documentation_url: string | null;
  access_url: string | null;
  availability: SourceAvailability;
  data_kind: string;
  integration: SourceIntegration;
  verification: string | null;
  notes: string | null;
  file_size?: string | null;
  layer?: MapLayerSpec;
}

export interface CsaReference {
  id: string;
  title: string;
  url: string;
  summary: string;
  topic: string;
  provider: string;
  publication_date: string | null;
  retrieval_date: string | null;
  classification: string;
  verification: string;
}

export interface Catalogue {
  schema_version: string;
  catalogue_date: string;
  disclaimer: string;
  categories: { id: SourceCategory; title: string; description: string }[];
  csa_notice: string;
  csa_landing: { url: string; retrieval_date: string; latest_listed_news: { date: string; title: string } };
  sources: CatalogueSource[];
  csa: CsaReference[];
}

export const CATALOGUE = raw as unknown as Catalogue;

export const BUNDLED_BASEMAP_ID = 'lroc-wac-south-pole-400m';

/** Sources that can be drawn on the Polar Map, bundled imagery first. */
export const MAP_LAYER_SOURCES: (CatalogueSource & { layer: MapLayerSpec })[] = CATALOGUE.sources
  .filter((s): s is CatalogueSource & { layer: MapLayerSpec } => s.integration === 'polar-map-layer' && !!s.layer);

export function sourceById(id: string): CatalogueSource | undefined {
  return CATALOGUE.sources.find((s) => s.id === id);
}

export const AVAILABILITY_LABEL: Record<SourceAvailability, string> = {
  bundled: 'Bundled · works offline',
  'link-out': 'External link',
  'live-backend': 'Live via CHANDRA backend',
  'live-remote': 'Live from provider (browser)',
  'remote-range': 'Bounded subset via backend',
};

export const INTEGRATION_LABEL: Record<SourceIntegration, string> = {
  acquire: 'Terrain Lab acquisition',
  engine: 'Simulation engine',
  'link-out': 'Reference link',
  'polar-map-layer': 'Polar Map layer',
  'site-catalogue': 'Site catalogue',
  tests: 'Test evidence',
  verification: 'Verification workspace',
};

/** Free-text search across the fields a user would reasonably type. */
export function matchesSource(s: CatalogueSource, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [s.product_name, s.provider, s.product_id, s.coverage, s.spatial_resolution, s.reference_frame, s.notes, s.data_kind]
    .some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
}

/** Search/filter keys for a display position: decimal degrees, east-positive, both longitude ranges. */
export function coordinateText(latitude: number, longitude: number): string {
  const east = ((longitude % 360) + 360) % 360;
  const signed = east > 180 ? east - 360 : east;
  return `${latitude.toFixed(4)}, ${signed.toFixed(4)} (lat, lon east-positive; ${east.toFixed(4)}°E)`;
}

/** External viewers. Neither documents a stable deep-link API, so these open the tool and the coordinates are copied separately. */
export const EXTERNAL_VIEWERS = {
  quickmap: { label: 'LROC QuickMap', url: 'https://quickmap.lroc.asu.edu/', sourceId: 'lroc-quickmap' },
  moonTrek: { label: 'NASA Moon Trek', url: 'https://trek.nasa.gov/moon/', sourceId: 'moon-trek-portal' },
} as const;
