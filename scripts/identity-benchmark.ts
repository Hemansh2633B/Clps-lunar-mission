/**
 * Sanity benchmark for the exact canonical simulation key (v1.11). Not a CI
 * gate and not a performance guarantee: hardware/JIT variance is real. It uses
 * the maximum 3,601-bin horizon on a catalogue site and reports key size plus
 * median/p95 construction time over 1,000 calls after warm-up.
 */
import { performance } from 'node:perf_hooks';
import { LANDING_SITES } from '../src/data/landingSites';
import { DEFAULT_CONFIG, simulationKey } from '../src/engine/simulation';

const base = LANDING_SITES[0];
const site = {
  ...base,
  terrain: {
    ...base.terrain,
    resolutionDeg: 0.1,
    elevations: Array.from({ length: 3601 }, (_, i) => 1 + 0.0001 * (i % 17)),
  },
};
const startMs = Date.parse('2026-12-18T00:00:00Z');
const endMs = startMs + 30 * 86400000;
for (let i = 0; i < 100; i++) simulationKey(site, startMs, endMs, DEFAULT_CONFIG);
const times: number[] = [];
let length = 0;
for (let i = 0; i < 1000; i++) {
  const t0 = performance.now();
  const key = simulationKey(site, startMs + i, endMs + i, DEFAULT_CONFIG);
  times.push(performance.now() - t0);
  length = key.length;
}
times.sort((a, b) => a - b);
const median = times[Math.floor(times.length * 0.5)];
const p95 = times[Math.floor(times.length * 0.95)];
console.log(JSON.stringify({
  node: process.version,
  calls: times.length,
  elevationBins: site.terrain.elevations.length,
  keyLengthChars: length,
  medianMs: Number(median.toFixed(4)),
  p95Ms: Number(p95.toFixed(4)),
  lruEntries: 36,
  approximateKeyStorageMiB: Number((length * 2 * 36 / 1024 / 1024).toFixed(2)),
}, null, 2));
