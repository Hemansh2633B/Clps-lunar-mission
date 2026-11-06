/**
 * Illustrative mission-configuration presets for common demonstration scenarios.
 * These are NOT claims about actual NASA vehicle specifications — they are reasonable
 * engineering starting points so a first-time user can explore without tuning every
 * parameter. Every assumption is explained. "Custom" leaves the current configuration.
 */
import type { MissionConfig } from '../types/mission';
import { DEFAULT_CONFIG } from '../engine/simulation';

export interface MissionPreset {
  id: string;
  label: string;
  tagline: string;
  description: string;
  config: MissionConfig;
}

export const MISSION_PRESETS: MissionPreset[] = [
  {
    id: 'small-robotic',
    label: 'Small robotic lander',
    tagline: 'Low power, short surface stay',
    description: 'A compact static lander: small vertical-tracking array, modest continuous load and a small battery. Illustrative of a brief technology-demonstration surface mission.',
    config: { ...DEFAULT_CONFIG, arrayMode: 'vertical-tracking', arrayAreaM2: 2, cellEfficiency: 0.28, systemDerate: 0.85, loadW: 60, batteryCapacityKWh: 5, initialSocPct: 90, durationDays: 7, stepMinutes: 15 },
  },
  {
    id: 'general-surface',
    label: 'General-purpose surface lander',
    tagline: 'Balanced power and storage',
    description: 'A mid-size lander with a balanced array, load and battery. An illustrative default for exploring how illumination and Earth visibility drive a typical surface mission.',
    config: { ...DEFAULT_CONFIG, arrayMode: 'vertical-tracking', arrayAreaM2: 6, cellEfficiency: 0.28, systemDerate: 0.85, loadW: 180, batteryCapacityKWh: 20, initialSocPct: 80, durationDays: 10, stepMinutes: 15 },
  },
  {
    id: 'extended-science',
    label: 'Extended scientific mission',
    tagline: 'Larger array, longer stay',
    description: 'Illustrative of a longer, more capable surface mission: larger array and battery to ride through eclipses, higher instrument load, and a 30-day window to sample a full lunar day/night cycle.',
    config: { ...DEFAULT_CONFIG, arrayMode: 'vertical-tracking', arrayAreaM2: 12, cellEfficiency: 0.30, systemDerate: 0.85, loadW: 350, batteryCapacityKWh: 50, initialSocPct: 85, durationDays: 30, stepMinutes: 30 },
  },
];

export const CUSTOM_PRESET_ID = 'custom';

/** Which preset (if any) exactly matches a configuration — used to highlight the active preset. */
export function matchingPresetId(config: MissionConfig): string {
  for (const p of MISSION_PRESETS) {
    const keys: (keyof MissionConfig)[] = ['arrayMode', 'arrayAreaM2', 'cellEfficiency', 'systemDerate', 'loadW', 'batteryCapacityKWh', 'initialSocPct', 'durationDays'];
    if (keys.every((k) => p.config[k] === config[k])) return p.id;
  }
  return CUSTOM_PRESET_ID;
}
