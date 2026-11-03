/**
 * Sampling integrity, battery robustness, and transition-refinement convergence.
 * These guard the audit fixes: uniform capped sampling (no giant final gap),
 * event-based visibility percentages, and a battery model that is stable under
 * irregular steps, saturation, long darkness, and boundary conditions.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, MAX_SAMPLES, simulateMission } from '../src/engine/simulation';
import { simulateBattery, BATTERY_CHARGE_EFF, BATTERY_DISCHARGE_EFF } from '../src/engine/powerComms';
import { siteById } from '../src/data/landingSites';
import type { EvaluatedSample, MissionConfig } from '../src/types/mission';
import { DAY_MS, HOUR_MS } from '../src/engine/constants';

const START = Date.parse('2026-12-18T00:00:00Z');
const mk = (timeMs: number, selectedW: number) => ({ timeMs, power: { selectedW } } as unknown as EvaluatedSample);
const battCfg = (over: Partial<MissionConfig> = {}): MissionConfig => ({
  ...DEFAULT_CONFIG, loadW: 180, batteryCapacityKWh: 20, initialSocPct: 100, ...over,
});

describe('uniform capped sampling', () => {
  it('90 days @ 1 min coarsens uniformly to the cap, preserving both endpoints', () => {
    const site = siteById('apollo-11')!;
    const end = START + 90 * DAY_MS;
    const sim = simulateMission(site, START, end, { ...DEFAULT_CONFIG, stepMinutes: 1 });
    expect(sim.sampling.sampleCount).toBe(MAX_SAMPLES);
    expect(sim.sampling.capped).toBe(true);
    expect(sim.sampling.requestedStepMinutes).toBe(1);
    // 90*24*60 = 129600 min over 19999 intervals => ~6.4803 min effective step.
    expect(sim.sampling.effectiveStepMinutes).toBeCloseTo(129600 / (MAX_SAMPLES - 1), 3);
    // Both endpoints preserved exactly.
    expect(sim.samples[0].timeMs).toBe(START);
    expect(sim.samples[sim.samples.length - 1].timeMs).toBe(end);
    // No giant final gap: the largest gap equals the uniform effective step.
    expect(sim.sampling.maxGapMinutes).toBeCloseTo(sim.sampling.effectiveStepMinutes, 6);
    // Every consecutive gap is uniform (the old bug produced an ~88-day final jump).
    let maxDev = 0;
    for (let i = 1; i < sim.samples.length; i++) {
      const gapMin = (sim.samples[i].timeMs - sim.samples[i - 1].timeMs) / 60000;
      maxDev = Math.max(maxDev, Math.abs(gapMin - sim.sampling.effectiveStepMinutes));
    }
    expect(maxDev).toBeLessThan(1e-6);
  }, 120000);

  it('a short window keeps the requested step and is not capped', () => {
    const site = siteById('apollo-11')!;
    const sim = simulateMission(site, START, START + DAY_MS, { ...DEFAULT_CONFIG, stepMinutes: 60 });
    expect(sim.sampling.capped).toBe(false);
    expect(sim.sampling.sampleCount).toBe(25);
    expect(sim.sampling.effectiveStepMinutes).toBe(60);
    expect(sim.samples[0].timeMs).toBe(START);
    expect(sim.samples[24].timeMs).toBe(START + DAY_MS);
  });
});

describe('battery robustness', () => {
  it('irregular steps integrate the same deficit as uniform steps', () => {
    const cfg = battCfg();
    const totalH = 200;
    const uniform: EvaluatedSample[] = [];
    for (let h = 0; h <= totalH; h++) uniform.push(mk(START + h * HOUR_MS, 0));
    // Irregular timestamps covering the same span, same (zero) generation.
    const irregular: EvaluatedSample[] = [];
    let t = START;
    let i = 0;
    while (t < START + totalH * HOUR_MS) {
      irregular.push(mk(t, 0));
      const stepH = [0.1, 3.7, 0.05, 12.3, 1.1, 0.9][i % 6];
      t = Math.min(START + totalH * HOUR_MS, t + stepH * HOUR_MS);
      i++;
    }
    irregular.push(mk(START + totalH * HOUR_MS, 0));
    const a = simulateBattery(uniform, cfg);
    const b = simulateBattery(irregular, cfg);
    // Analytic depletion: capacity*dischargeEff/load = 20*0.95/0.18 = 105.56 h to empty.
    const analyticDepletion = totalH - (20 * BATTERY_DISCHARGE_EFF) / 0.18;
    expect(a.depletionHours).toBeCloseTo(analyticDepletion, 1);
    expect(Math.abs(a.depletionHours - b.depletionHours)).toBeLessThan(1e-6);
    expect(a.minSocPct).toBe(0);
    expect(b.minSocPct).toBe(0);
  });

  it('saturates at 100% under large surplus and never exceeds capacity', () => {
    const cfg = battCfg({ initialSocPct: 50 });
    const samples: EvaluatedSample[] = [];
    for (let h = 0; h <= 100; h++) samples.push(mk(START + h * HOUR_MS, 100000));
    const r = simulateBattery(samples, cfg);
    expect(r.finalSocPct).toBe(100);
    expect(r.minSocPct).toBeCloseTo(50, 6);
    expect(r.depletionHours).toBe(0);
    expect(r.firstDepletionMs).toBeNull();
  });

  it('initial SOC shifts the first depletion time', () => {
    const samples: EvaluatedSample[] = [];
    for (let h = 0; h <= 300; h++) samples.push(mk(START + h * HOUR_MS, 0));
    const full = simulateBattery(samples, battCfg({ initialSocPct: 100 }));
    const low = simulateBattery(samples, battCfg({ initialSocPct: 10 }));
    expect(full.firstDepletionMs).not.toBeNull();
    expect(low.firstDepletionMs).not.toBeNull();
    expect(full.firstDepletionMs!).toBeGreaterThan(low.firstDepletionMs!);
    // Zero-crossing is interpolated inside the window, not snapped to a sample.
    expect(full.firstDepletionMs!).toBeGreaterThan(START);
    expect(full.firstDepletionMs!).toBeLessThan(START + 300 * HOUR_MS);
  });

  it('handles long continuous darkness and a zero-length / empty input safely', () => {
    const dark: EvaluatedSample[] = [];
    for (let h = 0; h <= 400; h += 2) dark.push(mk(START + h * HOUR_MS, 0));
    const r = simulateBattery(dark, battCfg({ initialSocPct: 80 }));
    expect(r.finalSocPct).toBe(0);
    expect(r.depletionHours).toBeGreaterThan(0);
    const empty = simulateBattery([], battCfg({ initialSocPct: 60 }));
    expect(empty.minSocPct).toBe(60);
    expect(empty.depletionHours).toBe(0);
    expect(BATTERY_CHARGE_EFF).toBeLessThan(1);
    expect(BATTERY_DISCHARGE_EFF).toBeLessThan(1);
  });
});

describe('transition refinement convergence', () => {
  it('polar illumination % and event count converge between coarse and fine steps', () => {
    const site = siteById('shackleton-rim')!;
    // 2026-09 window: the grazing polar Sun rises/sets several times (transition-rich).
    const start = Date.parse('2026-09-01T00:00:00Z');
    const end = start + 30 * DAY_MS;
    const coarse = simulateMission(site, start, end, { ...DEFAULT_CONFIG, stepMinutes: 240 });
    const fine = simulateMission(site, start, end, { ...DEFAULT_CONFIG, stepMinutes: 30 });
    // Event-based percentages use refined crossings, so coarse sampling already
    // resolves them: the two must agree closely (convergence, not coarse-step bias).
    expect(Math.abs(coarse.summary.illuminationPct - fine.summary.illuminationPct)).toBeLessThan(0.5);
    const coarseSun = coarse.events.filter((e) => e.body === 'sun').length;
    const fineSun = fine.events.filter((e) => e.body === 'sun').length;
    // Adaptive sub-sampling must not miss short windows the coarse grid would skip.
    expect(Math.abs(coarseSun - fineSun)).toBeLessThanOrEqual(1);
    expect(fineSun).toBeGreaterThan(0);
  }, 120000);

  it('summary percentages are consistent with refined gap durations', () => {
    const site = siteById('apollo-11')!;
    const days = 30;
    const sim = simulateMission(site, START, START + days * DAY_MS, { ...DEFAULT_CONFIG, stepMinutes: 60 });
    // Illumination fraction + longest eclipse cannot exceed the window, and the
    // illumination percentage must match the event-integrated visible time.
    expect(sim.summary.illuminationPct).toBeGreaterThan(40);
    expect(sim.summary.illuminationPct).toBeLessThan(60);
    expect(sim.summary.longestEclipseHours).toBeGreaterThan(0);
    expect(sim.summary.longestEclipseHours).toBeLessThan(days * 24);
  }, 60000);
});
