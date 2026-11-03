import assert from 'node:assert/strict';
import * as THREE from 'three';
import { tangentPoint, sampleLonLat } from '../src/terrain/coordinates';
import { createTerrain, setExaggeration, disposeTerrain } from '../src/terrain/terrainMesh';
import { sunDirection } from '../src/terrain/lighting';
import { syntheticTerrain } from '../src/terrain/synthetic';
import { horizonFromGrid } from '../src/terrain/horizon';
import type { TerrainData } from '../src/terrain/types';

function close(actual: number, expected: number, tolerance = 1e-7) {
  assert(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);
}
const base = {
  latitude: -90, longitude: 45, radius_km: 20, landing_elevation_m: 0,
  source: { lunar_radius_m: 1737400, elevation_reference_radius_m: 1737400 },
} as unknown as TerrainData;

assert.deepEqual(tangentPoint(0, 0, 0, base), [0, 0, 0]);
for (const [e, n, h] of [[20000, 0, 0], [0, 5000, 100], [3000, 4000, -100]]) {
  const p = tangentPoint(e, n, h, base);
  const radialDistance = Math.hypot(p[0] * 1000, p[2] * 1000, p[1] * 1000 + 1737400);
  close(radialDistance, 1737400 + h, 1e-6);
}
close(tangentPoint(20000, 0, 0, base)[1] * 1000, -115.1135569, 0.001);
const north = sampleLonLat(0, 5000, base);
close(north.longitude, 45, 1e-6);
close(north.latitude, -89.8351105674, 1e-6);
const east = sampleLonLat(5000, 0, base);
close(east.longitude, 135, 1e-6);
for (const [az, el, expected] of [[0, 0, [0, 0, -1]], [90, 0, [1, 0, 0]], [180, 0, [0, 0, 1]], [270, 0, [-1, 0, 0]], [103, 90, [0, 1, 0]]] as const) {
  const dir = sunDirection(az, el);
  close(dir.length(), 1);
  dir.toArray().forEach((v, i) => close(v, expected[i]));
}
const data = { ...base, radius_km: 0.5, grid: { size: 3, spacing_m: 500, elevations_m: [null, 0, null, 0, 0, 10, null, 0, null] } } as unknown as TerrainData;
const mesh = createTerrain(data);
assert.equal(mesh.material.shadowSide, THREE.DoubleSide);
assert(mesh.castShadow && mesh.receiveShadow);
assert(mesh.geometry.index!.count > 0);
setExaggeration(mesh, 10);
assert.deepEqual(Array.from(mesh.geometry.attributes.position.array.slice(12, 15)), [0, 0, 0]);
assert.equal(data.grid.elevations_m[5], 10);
const index = mesh.geometry.index!;
for (let i = 0; i < index.count; i++) assert.notEqual(data.grid.elevations_m[index.array[i]], null);
disposeTerrain(mesh);

const synth = syntheticTerrain(-89.5, 45, 2, 'low');
assert.equal(synth.grid.size, 129);
assert.equal(synth.synthetic, true);
assert.equal(synth.statistics.coverage_percent, 100);
const mask = horizonFromGrid(synth, 10, 2);
assert.equal(mask.azimuths_deg.length, 36);
assert(mask.mean_coverage_percent > 95);
console.log('Geometry checks passed: spherical curvature, pole coordinates, Sun directions, exact center, shadow casting, NoData topology, synthetic demo, and horizon ray-marching.');
