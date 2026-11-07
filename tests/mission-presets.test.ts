/** Mission presets are illustrative, valid configurations (not NASA vehicle specs). */
import { describe, expect, it } from 'vitest';
import { MISSION_PRESETS, matchingPresetId, CUSTOM_PRESET_ID } from '../src/data/missionPresets';
import { validateConfig } from '../src/engine/configLimits';
import { DEFAULT_CONFIG } from '../src/engine/simulation';

describe('mission presets', () => {
  it('offers the three demonstration scenarios', () => {
    expect(MISSION_PRESETS.map((p) => p.id)).toEqual(['small-robotic', 'general-surface', 'extended-science']);
    for (const p of MISSION_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.toLowerCase()).toContain('illustrative');
    }
  });

  it('every preset is a valid configuration within the engine limits', () => {
    for (const p of MISSION_PRESETS) expect(validateConfig(p.config), p.id).toHaveLength(0);
  });

  it('matches a preset exactly and falls back to custom when modified', () => {
    for (const p of MISSION_PRESETS) expect(matchingPresetId(p.config)).toBe(p.id);
    expect(matchingPresetId({ ...MISSION_PRESETS[0].config, loadW: 999 })).toBe(CUSTOM_PRESET_ID);
    expect(matchingPresetId(DEFAULT_CONFIG)).toBe('general-surface');
  });
});
