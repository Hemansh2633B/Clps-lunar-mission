/**
 * Valid ranges, steps, units and defaults for every numeric mission parameter.
 * Shared by the engine (defensive sanitization so invalid values never propagate into
 * a calculation) and the UI (input min/max/step + validation messages). Keeping one
 * source of truth prevents the form and the engine from disagreeing.
 */
import type { MissionConfig, RelayConfig, RelayModelKind } from '../types/mission';
import { clamp, wrap360 } from './constants';

export interface NumericLimit {
  min: number;
  max: number;
  step: number;
  unit: string;
  default: number;
  label: string;
  help: string;
}

export const MISSION_LIMITS = {
  durationDays: { min: 1, max: 90, step: 1, unit: 'days', default: 10, label: 'Mission duration', help: 'Length of the analyzed surface mission window.' },
  arrayAreaM2: { min: 0.1, max: 200, step: 0.5, unit: 'm²', default: 6, label: 'Array area', help: 'Total solar-array surface area. Illustrative, not a specific vehicle.' },
  cellEfficiency: { min: 0.05, max: 0.5, step: 0.01, unit: 'fraction', default: 0.28, label: 'Cell efficiency', help: 'Photovoltaic conversion efficiency (0–1). ~0.28 is a representative modern cell.' },
  systemDerate: { min: 0.3, max: 1, step: 0.01, unit: 'fraction', default: 0.85, label: 'System derate', help: 'Multiplier for wiring, temperature and pointing losses (0–1).' },
  fixedPanelAzimuthDeg: { min: 0, max: 360, step: 1, unit: '°', default: 0, label: 'Fixed panel azimuth', help: 'Compass direction a fixed vertical panel faces (used only in fixed-azimuth mode).' },
  loadW: { min: 0, max: 10000, step: 10, unit: 'W', default: 180, label: 'Surface load', help: 'Continuous electrical load drawn by the lander.' },
  batteryCapacityKWh: { min: 0.1, max: 1000, step: 1, unit: 'kWh', default: 20, label: 'Battery capacity', help: 'Usable stored energy capacity.' },
  initialSocPct: { min: 0, max: 100, step: 5, unit: '%', default: 80, label: 'Initial state of charge', help: 'Battery charge at mission start.' },
  commsMarginDeg: { min: 0, max: 10, step: 0.1, unit: '°', default: 0, label: 'DTE elevation margin', help: 'Extra elevation above the terrain horizon required for Earth line-of-sight.' },
  stepMinutes: { min: 1, max: 240, step: 5, unit: 'min', default: 15, label: 'Sample step', help: 'Requested telemetry sampling interval. Coarsened uniformly if the 20,000-sample cap is exceeded.' },
} satisfies Record<string, NumericLimit>;

export type NumericConfigKey = keyof typeof MISSION_LIMITS;

/**
 * Relay-state limits. Every value is clamped to a physically sensible range and
 * a state whose model is unrecognised is dropped entirely (never silently
 * coerced into a different orbit).
 */
export const RELAY_LIMITS = {
  altitudeKm: { min: 0, max: 200_000, step: 10, unit: 'km', default: 100, label: 'Orbit altitude', help: 'Circular lunar orbit altitude above the 1737.4 km sphere.' },
  inclinationDeg: { min: 0, max: 180, step: 1, unit: '°', default: 90, label: 'Inclination', help: 'Orbit-plane inclination to the J2000 equator. 90° is polar.' },
  raanDeg: { min: 0, max: 360, step: 1, unit: '°', default: 0, label: 'RAAN', help: 'Right ascension of the ascending node at epoch (J2000).' },
  phaseDeg: { min: 0, max: 360, step: 1, unit: '°', default: 0, label: 'Phase at epoch', help: 'Argument of latitude at the model epoch.' },
  periodMinutes: { min: 30, max: 60_000, step: 1, unit: 'min', default: 113, label: 'Period override', help: 'Optional. Default is the two-body Kepler period for the altitude.' },
  haloAmplitudeKm: { min: 0, max: 200_000, step: 500, unit: 'km', default: 15_000, label: 'Halo-plane radius', help: 'Idealised circular ring radius around L2, perpendicular to the Earth–Moon line.' },
  haloPeriodDays: { min: 1, max: 120, step: 0.5, unit: 'd', default: 14, label: 'Halo period', help: 'Parametric halo period. Not a fitted halo ephemeris.' },
  latitudeDeg: { min: -90, max: 90, step: 0.1, unit: '°', default: 0, label: 'Latitude', help: 'Fixed-body relay latitude (planetocentric).' },
  longitudeDeg: { min: -180, max: 360, step: 0.1, unit: '°', default: 0, label: 'Longitude', help: 'Fixed-body relay east longitude.' },
} satisfies Record<string, NumericLimit>;

const RELAY_MODELS: RelayModelKind[] = ['circular-lunar', 'earth-moon-l2-halo', 'fixed-body'];

function num(v: unknown, lim: NumericLimit): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, lim.min, lim.max) : lim.default;
}

/** Clamp/validate a relay state. Returns null for an unknown model — never a substitute orbit. */
export function sanitizeRelay(relay: RelayConfig | null | undefined): RelayConfig | null {
  if (!relay || typeof relay !== 'object') return null;
  if (!RELAY_MODELS.includes(relay.model)) return null;
  const text = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim().length > 0 && v.length <= 120 ? v : fallback);
  const out: RelayConfig = {
    id: text(relay.id, `relay-${relay.model}`),
    name: text(relay.name, 'Relay spacecraft'),
    model: relay.model,
    altitudeKm: num(relay.altitudeKm, RELAY_LIMITS.altitudeKm),
    inclinationDeg: num(relay.inclinationDeg, RELAY_LIMITS.inclinationDeg),
    raanDeg: wrap360(num(relay.raanDeg, RELAY_LIMITS.raanDeg)),
    phaseDeg: wrap360(num(relay.phaseDeg, RELAY_LIMITS.phaseDeg)),
    ...(relay.periodMinutes == null ? {} : { periodMinutes: num(relay.periodMinutes, RELAY_LIMITS.periodMinutes) }),
    haloAmplitudeKm: num(relay.haloAmplitudeKm, RELAY_LIMITS.haloAmplitudeKm),
    haloPeriodDays: num(relay.haloPeriodDays, RELAY_LIMITS.haloPeriodDays),
    haloPhaseDeg: wrap360(num(relay.haloPhaseDeg, RELAY_LIMITS.phaseDeg)),
    latitudeDeg: num(relay.latitudeDeg, RELAY_LIMITS.latitudeDeg),
    longitudeDeg: wrap360(num(relay.longitudeDeg, RELAY_LIMITS.longitudeDeg)),
    ...(typeof relay.epochMs === 'number' && Number.isFinite(relay.epochMs) ? { epochMs: relay.epochMs } : {}),
    ...(typeof relay.note === 'string' && relay.note.length <= 500 ? { note: relay.note } : {}),
  };
  return out;
}

/** Clamp every numeric field into its valid range; non-finite values fall back to the default. */
export function sanitizeConfig(config: MissionConfig): MissionConfig {
  const out = { ...config };
  for (const key of Object.keys(MISSION_LIMITS) as NumericConfigKey[]) {
    const lim = MISSION_LIMITS[key];
    const v = config[key];
    out[key] = Number.isFinite(v) ? clamp(v, lim.min, lim.max) : lim.default;
  }
  if (!['horizontal', 'vertical-tracking', 'vertical-fixed'].includes(out.arrayMode)) out.arrayMode = 'vertical-tracking';
  // A config that never mentioned a relay must keep the identical canonical
  // identity (undefined ≠ null once serialized); only an explicit state is set.
  if (config.relay == null) {
    if ('relay' in config) out.relay = null; else delete (out as { relay?: unknown }).relay;
  } else {
    out.relay = sanitizeRelay(config.relay);
  }
  return out;
}

export interface ConfigIssue { field: NumericConfigKey; message: string }

/** Human-readable validation issues for out-of-range / non-finite values (empty when valid). */
export function validateConfig(config: MissionConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const key of Object.keys(MISSION_LIMITS) as NumericConfigKey[]) {
    const lim = MISSION_LIMITS[key];
    const v = config[key];
    if (!Number.isFinite(v)) issues.push({ field: key, message: `${lim.label} must be a number (${lim.unit}).` });
    else if (v < lim.min || v > lim.max) issues.push({ field: key, message: `${lim.label} must be between ${lim.min} and ${lim.max} ${lim.unit}.` });
  }
  return issues;
}
