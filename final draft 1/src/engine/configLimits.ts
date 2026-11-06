/**
 * Valid ranges, steps, units and defaults for every numeric mission parameter.
 * Shared by the engine (defensive sanitization so invalid values never propagate into
 * a calculation) and the UI (input min/max/step + validation messages). Keeping one
 * source of truth prevents the form and the engine from disagreeing.
 */
import type { MissionConfig } from '../types/mission';
import { clamp } from './constants';

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

/** Clamp every numeric field into its valid range; non-finite values fall back to the default. */
export function sanitizeConfig(config: MissionConfig): MissionConfig {
  const out = { ...config };
  for (const key of Object.keys(MISSION_LIMITS) as NumericConfigKey[]) {
    const lim = MISSION_LIMITS[key];
    const v = config[key];
    out[key] = Number.isFinite(v) ? clamp(v, lim.min, lim.max) : lim.default;
  }
  if (!['horizontal', 'vertical-tracking', 'vertical-fixed'].includes(out.arrayMode)) out.arrayMode = 'vertical-tracking';
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
