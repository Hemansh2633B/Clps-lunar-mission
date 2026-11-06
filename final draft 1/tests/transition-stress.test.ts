/**
 * Transition-detector reliability: the adaptive pruning bound must not miss crossings
 * that a brute-force fine scan finds (complex terrain, polar + low-latitude), budget
 * exhaustion must be disclosed with a safe fallback, and findNextTransition must use
 * the same adaptive method (not an hourly sign-change scan that skips short windows).
 */
import { describe, expect, it } from 'vitest';
import { computeEphemeris } from '../src/engine/ephemeris';
import {
  buildTerrainProfile, terrainElevationAt, findTransitions, findNextTransition,
  refineCrossing, clearanceRateBound, TRANSITION_MIN_STEP_MS,
} from '../src/engine/horizonPhysics';
import { evaluateAt, DEFAULT_CONFIG } from '../src/engine/simulation';
import { siteById } from '../src/data/landingSites';
import type { LandingSite, TerrainProfile } from '../src/types/mission';
import { HOUR_MS } from '../src/engine/constants';

const START = Date.parse('2026-09-01T00:00:00Z');

function clearance(site: LandingSite, t: number, body: 'sun' | 'earth' | 'combined', margin: number): number {
  const eph = computeEphemeris(site, t);
  const sun = eph.sun.elevationDeg - terrainElevationAt(site.terrain, eph.sun.azimuthDeg);
  const earth = eph.earth.elevationDeg - terrainElevationAt(site.terrain, eph.earth.azimuthDeg) - margin;
  return body === 'sun' ? sun : body === 'earth' ? earth : Math.min(sun, earth);
}

/** Brute-force reference: uniform fine scan + bisection of every sign change. */
function bruteCrossings(site: LandingSite, start: number, end: number, stepMs: number, body: 'sun' | 'earth'): number[] {
  const out: number[] = [];
  let pt = start, pc = clearance(site, pt, body, 0);
  for (let t = start + stepMs; t <= end; t += stepMs) {
    const c = clearance(site, t, body, 0);
    if ((pc >= 0) !== (c >= 0)) out.push(refineCrossing(site, DEFAULT_CONFIG, pt, t, body, c >= 0));
    pt = t; pc = c;
  }
  return out;
}

function jaggedProfile(periodDeg: number, lo: number, hi: number): TerrainProfile {
  const res = 0.25;
  const n = Math.round(360 / res);
  const elevations = Array.from({ length: n }, (_, i) => (Math.floor((i * res) / periodDeg) % 2 === 0 ? lo : hi));
  return { label: 'jagged stress mask', kind: 'custom', resolutionDeg: res, elevations, features: [], uncertaintyDeg: res / 2, eyeHeightM: 2 };
}

describe('adaptive detector vs brute force (bound validation)', () => {
  it('polar site with a jagged horizon: no crossing missed vs a 15 s brute scan', () => {
    const base = siteById('shackleton-rim')!;
    const site: LandingSite = { ...base, terrain: jaggedProfile(1.0, 0.2, 2.6) };
    const end = START + 12 * HOUR_MS;
    // Coarse 60-min samples feed the adaptive detector.
    const samples = [];
    for (let t = START; t <= end; t += HOUR_MS) samples.push(evaluateAt(site, t, DEFAULT_CONFIG));
    const { events, diagnostics } = findTransitions(site, DEFAULT_CONFIG, samples);
    const adaptiveSun = events.filter((e) => e.body === 'sun').map((e) => e.timeMs).sort((a, b) => a - b);
    const bruteSun = bruteCrossings(site, START, end, TRANSITION_MIN_STEP_MS, 'sun');
    // Every brute-force crossing must have an adaptive match within the resolution floor.
    for (const b of bruteSun) {
      expect(adaptiveSun.some((a) => Math.abs(a - b) <= TRANSITION_MIN_STEP_MS)).toBe(true);
    }
    // And the adaptive detector must not invent crossings the brute scan doesn't see.
    expect(adaptiveSun.length).toBeLessThanOrEqual(bruteSun.length + 1);
    expect(diagnostics.resolutionStatus).not.toBe('degraded');
  }, 120000);

  it('low-latitude site (Apollo 17): rise/set crossings match brute force', () => {
    const site = siteById('apollo-17')!;
    const end = START + 36 * HOUR_MS;
    const samples = [];
    for (let t = START; t <= end; t += 2 * HOUR_MS) samples.push(evaluateAt(site, t, DEFAULT_CONFIG));
    const { events } = findTransitions(site, DEFAULT_CONFIG, samples);
    const adaptiveSun = events.filter((e) => e.body === 'sun').map((e) => e.timeMs);
    const bruteSun = bruteCrossings(site, START, end, TRANSITION_MIN_STEP_MS, 'sun');
    for (const b of bruteSun) expect(adaptiveSun.some((a) => Math.abs(a - b) <= TRANSITION_MIN_STEP_MS)).toBe(true);
  }, 120000);

  it('rate bound grows with terrain gradient and is never capped below steep terrain', () => {
    const gentle = buildTerrainProfile('gentle', [], -0.08, 0, 'flat', 0);
    const steep = jaggedProfile(0.25, -1, 14);
    expect(clearanceRateBound(steep)).toBeGreaterThan(clearanceRateBound(gentle));
    expect(clearanceRateBound(steep)).toBeGreaterThan(40); // old cap would have under-bounded this
  });
});

describe('budget exhaustion is disclosed with a safe fallback', () => {
  it('a pathological single coarse interval triggers the fine-scan fallback and reports it', () => {
    const base = siteById('shackleton-rim')!;
    const site: LandingSite = { ...base, terrain: jaggedProfile(0.5, 0.2, 3.0) };
    // One giant coarse step hides many crossings -> adaptive budget exhausts -> fallback.
    const samples = [evaluateAt(site, START, DEFAULT_CONFIG), evaluateAt(site, START + 6 * HOUR_MS, DEFAULT_CONFIG)];
    const { events, diagnostics } = findTransitions(site, DEFAULT_CONFIG, samples);
    expect(diagnostics.budgetExhausted).toBe(true);
    expect(diagnostics.fallbackUsed).toBe(true);
    expect(['fallback-resolved', 'degraded']).toContain(diagnostics.resolutionStatus);
    expect(events.length).toBeGreaterThan(0);
    // If the fallback completed, no unresolved intervals remain.
    if (diagnostics.resolutionStatus === 'fallback-resolved') expect(diagnostics.unresolvedIntervals.length).toBe(0);
  }, 120000);

  it('normal windows report resolved diagnostics with the resolution floor disclosed', () => {
    const site = siteById('apollo-11')!;
    const samples = [];
    for (let t = START; t <= START + 2 * 24 * HOUR_MS; t += HOUR_MS) samples.push(evaluateAt(site, t, DEFAULT_CONFIG));
    const { diagnostics } = findTransitions(site, DEFAULT_CONFIG, samples);
    expect(diagnostics.minStepMs).toBe(TRANSITION_MIN_STEP_MS);
    expect(diagnostics.resolutionStatus).toBe('resolved');
    expect(diagnostics.budgetExhausted).toBe(false);
  }, 60000);
});

describe('findNextTransition uses the adaptive method', () => {
  it('finds the next sunrise consistent with the main detector', () => {
    const site = siteById('apollo-11')!;
    const next = findNextTransition(site, DEFAULT_CONFIG, START, 'sun', 40);
    expect(next).not.toBeNull();
    // Cross-check against the main detector over a forward window.
    const samples = [];
    for (let t = START; t <= START + 40 * 24 * HOUR_MS; t += 6 * HOUR_MS) samples.push(evaluateAt(site, t, DEFAULT_CONFIG));
    const { events } = findTransitions(site, DEFAULT_CONFIG, samples);
    const firstSun = events.filter((e) => e.body === 'sun' && e.timeMs > START).sort((a, b) => a.timeMs - b.timeMs)[0];
    expect(firstSun).toBeDefined();
    expect(Math.abs(next!.timeMs - firstSun.timeMs)).toBeLessThan(TRANSITION_MIN_STEP_MS * 2);
    expect(next!.visible).toBe(firstSun.visible);
  }, 120000);
});
