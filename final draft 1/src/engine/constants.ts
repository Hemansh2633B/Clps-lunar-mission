export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
export const SYNODIC_DAYS = 29.530588853;
export const MOON_RADIUS_KM = 1737.4;
export const SOLAR_CONSTANT_WM2 = 1361;
export const AU_KM = 149_597_870.7;
export const LIGHT_SPEED_KMS = 299_792.458;
export const MJD_UNIX_EPOCH = 40587;
export const DEFAULT_EYE_HEIGHT_M = 2;

export const COLORS = {
  bg: '#090B0E',
  panel: '#12161F',
  border: '#1E2530',
  solar: '#F59E0B',
  earth: '#06B6D4',
  blocked: '#EF4444',
  nominal: '#10B981',
  text: '#E6EAF2',
  muted: '#8A94A6',
} as const;

export function mjd(timeMs: number): number {
  return timeMs / DAY_MS + MJD_UNIX_EPOCH;
}

export function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function wrap180(deg: number): number {
  const w = wrap360(deg);
  return w > 180 ? w - 360 : w;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours)) return '—';
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const d = Math.floor(totalMinutes / 1440);
  const h = Math.floor((totalMinutes % 1440) / 60);
  const m = totalMinutes % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

export function formatUTC(timeMs: number): string {
  return new Date(timeMs).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function formatDate(timeMs: number): string {
  return new Date(timeMs).toISOString().slice(0, 10);
}

export function formatCoord(lat: number, lon: number): string {
  const la = `${Math.abs(lat).toFixed(2)}°${lat < 0 ? 'S' : 'N'}`;
  const lo = `${Math.abs(wrap180(lon)).toFixed(2)}°${wrap180(lon) < 0 ? 'W' : 'E'}`;
  return `${la}, ${lo}`;
}
