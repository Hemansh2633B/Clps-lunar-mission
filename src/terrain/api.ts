import type { HorizonMask, TerrainConfig, TerrainData, TerrainExample, TerrainMode, TerrainQuality } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(path, { ...init, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((body as { error?: string }).error || `Request failed (${response.status})`);
    return body as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw new Error('Terrain request timed out. Try a smaller radius or lower quality.');
    if (err instanceof TypeError) throw new Error('Local terrain backend is unavailable. Start it with npm run dev:api, or use the built-in synthetic demo.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const terrainApi = {
  config: () => request<TerrainConfig>('/api/config'),
  examples: () => request<{ examples: TerrainExample[] }>('/api/examples'),
  terrain: (body: { latitude: number; longitude: number; radius_km: number; quality: TerrainQuality; mode: TerrainMode }) =>
    request<TerrainData>('/api/terrain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  horizon: (body: { latitude: number; longitude: number; radius_km: number; quality: TerrainQuality; mode: TerrainMode; az_step_deg?: number; eye_height_m?: number }) =>
    request<HorizonMask>('/api/horizon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
};
