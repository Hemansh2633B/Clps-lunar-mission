/**
 * Analysis identity for v1.10 exports.
 *
 * The fingerprint is SHA-256 over EXACTLY the `simulationKey()` string used by
 * useSimulation and the simulation cache — one source of truth, never a second
 * incompatible identity scheme. It covers site identity, coordinates, terrain
 * kind/resolution/frame/coverage/elevations, the UTC window (minute resolution,
 * with exact endpoints checked separately by the export guard) and every mission
 * configuration field.
 *
 * Callers pass the EFFECTIVE (engine-sanitized) configuration and the result's
 * actual window so the fingerprint describes what was calculated, not what was
 * requested. Web Crypto is available in browsers, workers and Node ≥ 19 (tests).
 */
import type { LandingSite, MissionConfig } from '../types/mission';
import { simulationKey } from '../engine/simulation';

export async function analysisFingerprint(site: LandingSite, startMs: number, endMs: number, config: MissionConfig): Promise<string> {
  const key = simulationKey(site, startMs, endMs, config);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compact 16-hex (64-bit) form for CSV columns; full digest lives in the JSON report. */
export function shortFingerprint(full: string): string {
  return full.slice(0, 16);
}
