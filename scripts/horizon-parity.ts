/**
 * Verify the TypeScript twins (synthetic terrain + horizon ray-marcher) agree with
 * the native Go backend on identical requests. Replaces the former
 * TypeScript/Python parity check; the Go engine itself is held to the Python
 * golden outputs by `npm run test:go`.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { syntheticTerrain } from '../src/terrain/synthetic';
import { horizonFromGrid } from '../src/terrain/horizon';
// @ts-expect-error plain ESM helper without type declarations
import { buildCommand } from './go-bin.mjs';

const binary: string = buildCommand('chandra-horizon');

for (const [lat, lon, radius, quality, azStep, eye] of [
  [-89.5, 45, 5, 'medium', 2, 2],
  [-89.9, 0, 2, 'low', 5, 0],
  [-90, 45, 1, 'low', 15, 10],
] as const) {
  const data = syntheticTerrain(lat, lon, radius, quality);
  const ts = horizonFromGrid(data, azStep, eye);
  const native = JSON.parse(execFileSync(binary, [], {
    input: JSON.stringify({ latitude: lat, longitude: lon, radius_km: radius, quality, mode: 'synthetic', az_step_deg: azStep, eye_height_m: eye }),
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  }));
  const go = native.horizon;
  // Synthetic grids must match cell-for-cell (3-dp outputs; one rounding step of slack).
  assert.equal(data.grid.elevations_m.length, native.terrain.grid.elevations_m.length);
  for (let i = 0; i < data.grid.elevations_m.length; i++) {
    const a = data.grid.elevations_m[i];
    const b = native.terrain.grid.elevations_m[i];
    assert.equal(a === null, b === null, `grid cell ${i} mask`);
    if (a !== null) assert(Math.abs(a - b) <= 0.0010000001, `grid cell ${i}: TS ${a} vs Go ${b}`);
  }
  assert.equal(native.terrain.synthetic, true);
  assert.equal(ts.azimuths_deg.length, go.azimuths_deg.length);
  assert.equal(ts.mean_coverage_percent, go.mean_coverage_percent);
  assert.equal(ts.horizon_radius_km, go.horizon_radius_km);
  assert.equal(ts.edge_inset_m, go.edge_inset_m);
  for (let i = 0; i < ts.elevations_deg.length; i++) {
    assert(Math.abs(ts.elevations_deg[i] - go.elevations_deg[i]) < 1e-3, `az ${ts.azimuths_deg[i]}: TS ${ts.elevations_deg[i]} vs Go ${go.elevations_deg[i]}`);
    assert(Math.abs(ts.max_obstacle_range_km[i] - go.max_obstacle_range_km[i]) < 1e-3);
  }
}
console.log('Horizon parity passed: TypeScript and native Go agree on synthetic grids, ray-marched masks, coverage, edge inset and obstacle ranges.');
