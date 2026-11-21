import { describe, expect, it } from 'vitest';
import { sanitizeConfig, sanitizeRelay } from '../src/engine/configLimits';
import { DEFAULT_CONFIG, simulationKey } from '../src/engine/simulation';
import { siteById } from '../src/data/landingSites';

describe('relay-state validation and analysis identity', () => {
  it('clamps configurable orbit parameters and does not add a period override when omitted', () => {
    const relay = sanitizeRelay({ id: 'relay', name: 'Relay', model: 'circular-lunar', altitudeKm: 999_999, inclinationDeg: 270 });
    expect(relay?.altitudeKm).toBe(200_000);
    expect(relay?.inclinationDeg).toBe(180);
    expect(relay).not.toHaveProperty('periodMinutes');
  });

  it('drops unsupported relay model identifiers rather than substituting a model', () => {
    const relay = sanitizeRelay({ id: 'relay', name: 'Relay', model: 'made-up' as never });
    expect(relay).toBeNull();
  });

  it('includes a configured orbit in the exact simulation/cache identity', () => {
    const site = siteById('change-4')!;
    const a = { ...DEFAULT_CONFIG, relay: { id: 'r', name: 'Relay', model: 'circular-lunar' as const, altitudeKm: 100 } };
    const b = { ...a, relay: { ...a.relay, altitudeKm: 200 } };
    expect(simulationKey(site, 1, 2, a)).not.toBe(simulationKey(site, 1, 2, b));
    expect(sanitizeConfig({ ...DEFAULT_CONFIG, relay: a.relay }).relay?.altitudeKm).toBe(100);
  });
});
