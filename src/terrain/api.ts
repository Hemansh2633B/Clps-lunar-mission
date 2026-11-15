import type {
  AcquireResponse, DatasetMetadata, DatasetsResponse, HorizonMask, SourcesResponse, TerrainConfig, TerrainData, TerrainExample, TerrainMode, TerrainQuality,
} from './types';
import type { HorizonsVerifyResponse } from '../verification/horizons';

/** A structured API failure: HTTP status, the backend's machine code (when present) and Retry-After seconds. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null, readonly retryAfterS: number | null = null) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The request never reached a CHANDRA backend (offline, static-only hosting, or a proxy answered with HTML). */
export class BackendUnavailableError extends Error {
  constructor(message = 'Terrain backend is unavailable. Start it with npm run dev:api, or use the built-in synthetic demo.') {
    super(message);
    this.name = 'BackendUnavailableError';
  }
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 120_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, { ...init, signal: controller.signal });
    // A static host may answer /api/* with its HTML shell and status 200. That is
    // not a backend: never treat a non-JSON body as an (empty) API result.
    if (!(response.headers.get('content-type') ?? '').includes('application/json')) {
      throw new BackendUnavailableError();
    }
    const body = await response.json().catch(() => null) as ({ error?: string; code?: string } & Record<string, unknown>) | null;
    if (body === null || typeof body !== 'object') throw new BackendUnavailableError();
    if (!response.ok) {
      const retry = Number(response.headers.get('retry-after'));
      throw new ApiError(body.error || `Request failed (${response.status})`, response.status, typeof body.code === 'string' ? body.code : null,
        Number.isFinite(retry) && retry > 0 ? retry : null);
    }
    return body as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw new Error('Terrain request timed out. Try a smaller radius or lower quality.');
    if (err instanceof TypeError) throw new BackendUnavailableError();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

interface TerrainRequest { latitude: number; longitude: number; radius_km: number; quality: TerrainQuality; mode: TerrainMode; dataset_id?: string }

export const terrainApi = {
  config: () => request<TerrainConfig>('/api/config'),
  examples: () => request<{ examples: TerrainExample[] }>('/api/examples'),
  terrain: (body: TerrainRequest) => request<TerrainData>('/api/terrain', post(body)),
  horizon: (body: TerrainRequest & { az_step_deg?: number; eye_height_m?: number }) => request<HorizonMask>('/api/horizon', post(body)),
  /** Data Hub catalogue plus what this deployment can actually do. */
  sources: () => request<SourcesResponse>('/api/sources', undefined, 20_000),
  /** Configured DEM and acquired subsets. */
  datasets: () => request<DatasetsResponse>('/api/datasets', undefined, 30_000),
  metadata: (datasetId: string) => request<DatasetMetadata>(`/api/terrain/metadata?dataset_id=${encodeURIComponent(datasetId)}`, undefined, 30_000),
  /** Plan (dry_run) or download a bounded LOLA subset. Product ids only — the backend never accepts a URL. */
  acquire: (body: { product_id: string; latitude: number; longitude: number; radius_km: number; dry_run: boolean }) =>
    request<AcquireResponse>('/api/terrain/acquire', post(body), 180_000),
  /** Independent JPL Horizons table for a MOON_ME site (see src/verification/horizons.ts). */
  verifyEphemeris: (body: unknown) => request<HorizonsVerifyResponse>('/api/ephemeris/verify', post(body), 60_000),
};
