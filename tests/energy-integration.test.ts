/**
 * Event-aware energy + battery integration (Section 7). Visibility percentages use
 * refined crossings; energy/battery must use the SAME temporal model, not a coarse
 * trapezoid that smears the array on/off discontinuity. These tests check convergence
 * across sampling resolutions, agreement with an independent fine-grid reference,
 * battery/energy consistency, and reported numerical uncertainty.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, simulateMission, evaluateAt } from '../src/engine/simulation';
import { integrateMissionEnergy } from '../src/engine/integration';
import { BATTERY_DISCHARGE_EFF } from '../src/engine/powerComms';
import { siteById } from '../src/data/landingSites';
import { DAY_MS } from '../src/engine/constants';

const POLAR_START = Date.parse('2026-09-01T00:00:00Z'); // transition-rich polar window

describe('event-aware energy convergence', () => {
  it('coarse / medium / fine sampling give the same energy (integration is sampling-independent)', () => {
    const site = siteById('shackleton-rim')!;
    const end = POLAR_START + 30 * DAY_MS;
    const coarse = simulateMission(site, POLAR_START, end, { ...DEFAULT_CONFIG, stepMinutes: 240 });
    const medium = simulateMission(site, POLAR_START, end, { ...DEFAULT_CONFIG, stepMinutes: 60 });
    const fine = simulateMission(site, POLAR_START, end, { ...DEFAULT_CONFIG, stepMinutes: 15 });
    // The quadrature partitions at refined transitions and adapts internally, so the
    // display sampling must not change the energy result beyond quadrature tolerance.
    expect(Math.abs(coarse.summary!.selectedEnergyKWh - fine.summary!.selectedEnergyKWh)).toBeLessThan(0.1);
    expect(Math.abs(medium.summary!.selectedEnergyKWh - fine.summary!.selectedEnergyKWh)).toBeLessThan(0.1);
    expect(Math.abs(coarse.summary!.minBatterySocPct - fine.summary!.minBatterySocPct)).toBeLessThan(0.5);
    expect(Math.abs(coarse.summary!.depletionHours - fine.summary!.depletionHours)).toBeLessThan(0.5);
  }, 180000);

  it('matches an independent 1-min fine-grid reference (discontinuity handled, not smeared)', () => {
    const site = siteById('shackleton-rim')!;
    const end = POLAR_START + 5 * DAY_MS;
    const sim = simulateMission(site, POLAR_START, end, { ...DEFAULT_CONFIG, stepMinutes: 120 });
    let refWh = 0;
    let prev = evaluateAt(site, POLAR_START, DEFAULT_CONFIG).power.selectedW;
    for (let t = POLAR_START + 60_000; t <= end; t += 60_000) {
      const w = evaluateAt(site, t, DEFAULT_CONFIG).power.selectedW;
      refWh += ((w + prev) / 2) * (1 / 60);
      prev = w;
    }
    const refKWh = refWh / 1000;
    const relErr = Math.abs(sim.summary!.selectedEnergyKWh - refKWh) / Math.max(refKWh, 1e-9);
    expect(relErr).toBeLessThan(0.01);
  }, 120000);

  it('reports integration resolution + a small numerical uncertainty', () => {
    const site = siteById('shackleton-rim')!;
    const sim = simulateMission(site, POLAR_START, POLAR_START + 10 * DAY_MS, DEFAULT_CONFIG);
    const d = sim.summary!.integrationDiagnostics;
    expect(d).toBeDefined();
    expect(d!.method).toContain('adaptive Simpson');
    expect(d!.quadratureEvaluations).toBeGreaterThan(0);
    expect(['converged', 'adequate']).toContain(d!.resolutionStatus);
    expect(d!.relativeEnergyError).toBeLessThan(1e-2);
  }, 120000);
});

describe('battery uses the same generation timeline', () => {
  it('continuous polar darkness depletes at the analytic rate', () => {
    const site = siteById('shackleton-rim')!;
    // 2027-03 polar winter: 0% sunlit for this site (no generation).
    const start = Date.parse('2027-03-01T00:00:00Z');
    const days = 30;
    const config = { ...DEFAULT_CONFIG, loadW: 180, batteryCapacityKWh: 20, initialSocPct: 100 };
    const sim = simulateMission(site, start, start + days * DAY_MS, config);
    expect(sim.summary!.illuminationPct).toBeLessThan(0.5);
    // Analytic: capacity*dischargeEff/load = 20*0.95/0.18 = 105.56 h to empty.
    const analytic = days * 24 - (20 * BATTERY_DISCHARGE_EFF) / 0.18;
    expect(sim.summary!.depletionHours).toBeCloseTo(analytic, 0);
    expect(sim.summary!.minBatterySocPct).toBe(0);
    expect(sim.summary!.selectedEnergyKWh).toBeLessThan(0.01);
  }, 120000);

  it('selected energy and battery are consistent for a surplus window (no depletion, charges to cap)', () => {
    const site = siteById('apollo-11')!;
    const start = Date.parse('2026-12-18T00:00:00Z');
    // Large array, tiny load: generation always exceeds load while sunlit.
    const config = { ...DEFAULT_CONFIG, arrayAreaM2: 50, loadW: 10, batteryCapacityKWh: 5, initialSocPct: 20 };
    const integration = integrateMissionEnergy(site, config, [], start, start + 2 * DAY_MS);
    expect(integration.selectedEnergyKWh).toBeGreaterThan(0);
    expect(integration.battery.depletionHours).toBe(0);
    expect(integration.battery.finalSocPct).toBeGreaterThan(20);
    expect(integration.battery.finalSocPct).toBeLessThanOrEqual(100);
  }, 60000);

  it('empty / zero-length window is safe', () => {
    const site = siteById('apollo-11')!;
    const r = integrateMissionEnergy(site, DEFAULT_CONFIG, [], POLAR_START, POLAR_START);
    expect(r.selectedEnergyKWh).toBe(0);
    expect(r.battery.depletionHours).toBe(0);
    expect(r.battery.minSocPct).toBeCloseTo(DEFAULT_CONFIG.initialSocPct, 6);
  });
});
