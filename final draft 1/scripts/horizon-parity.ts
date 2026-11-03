/** Verify the TypeScript and Python horizon ray-marchers agree on identical grids. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { syntheticTerrain } from '../src/terrain/synthetic';
import { horizonFromGrid } from '../src/terrain/horizon';

const python = ['.venv/bin/python', '.venv/Scripts/python.exe'].find((p) => existsSync(p)) ?? (process.platform === 'win32' ? 'python' : 'python3');

for (const [lat, lon, radius, quality, azStep, eye] of [
  [-89.5, 45, 5, 'medium', 2, 2],
  [-89.9, 0, 2, 'low', 5, 0],
  [-90, 45, 1, 'low', 15, 10],
] as const) {
  const data = syntheticTerrain(lat, lon, radius, quality);
  const ts = horizonFromGrid(data, azStep, eye);
  const py = JSON.parse(execFileSync(python, ['-c', `
import json, sys
from backend.synthetic import synthetic_terrain
from backend.horizon import horizon_from_grid
data = synthetic_terrain(${lat}, ${lon}, ${radius}, "${quality}")
print(json.dumps(horizon_from_grid(data, ${azStep}, ${eye})))
`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  assert.equal(ts.azimuths_deg.length, py.azimuths_deg.length);
  assert.equal(ts.mean_coverage_percent, py.mean_coverage_percent);
  assert.equal(ts.horizon_radius_km, py.horizon_radius_km);
  assert.equal(ts.edge_inset_m, py.edge_inset_m);
  for (let i = 0; i < ts.elevations_deg.length; i++) {
    assert(Math.abs(ts.elevations_deg[i] - py.elevations_deg[i]) < 1e-3, `az ${ts.azimuths_deg[i]}: TS ${ts.elevations_deg[i]} vs PY ${py.elevations_deg[i]}`);
    assert(Math.abs(ts.max_obstacle_range_km[i] - py.max_obstacle_range_km[i]) < 1e-3);
  }
}
console.log('Horizon parity passed: TypeScript and Python ray-marchers agree on synthetic grids, coverage, edge inset, and obstacle ranges.');
