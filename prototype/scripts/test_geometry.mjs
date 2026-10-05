import assert from 'node:assert/strict';
import * as THREE from 'three';
import { tangentPoint, sampleLonLat } from '../frontend/coordinates.js';
import { createTerrain, setExaggeration, disposeTerrain } from '../frontend/terrain.js';
import { sunDirection } from '../frontend/lighting.js';
import { getSunPosition, getEarthPosition } from '../frontend/ephemeris.js';

function close(actual, expected, tolerance = 1e-7) { assert(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`); }
const base = { latitude: -90, longitude: 45, radius_km: 20, landing_elevation_m: 0,
  source: { lunar_radius_m: 1737400, elevation_reference_radius_m: 1737400 } };
assert.deepEqual(tangentPoint(0, 0, 0, base), [0, 0, 0]);
for (const [e, n, h] of [[20000, 0, 0], [0, 5000, 100], [3000, 4000, -100]]) {
  const p = tangentPoint(e, n, h, base);
  // The displayed point must lie on the expected physical lunar sphere.
  const radialDistance = Math.hypot(p[0] * 1000, p[2] * 1000, p[1] * 1000 + 1737400);
  close(radialDistance, 1737400 + h, 1e-6);
}
close(tangentPoint(20000, 0, 0, base)[1] * 1000, -115.1135569, 0.001);
const north = sampleLonLat(0, 5000, base);
close(north.longitude, 45, 1e-6);
close(north.latitude, -89.8351105674, 1e-6);
const east = sampleLonLat(5000, 0, base);
close(east.longitude, 135, 1e-6);
for (const [az, el, expected] of [[0, 0, [0, 0, -1]], [90, 0, [1, 0, 0]], [180, 0, [0, 0, 1]], [270, 0, [-1, 0, 0]], [103, 90, [0, 1, 0]]]) {
  const dir = sunDirection(az, el);
  close(dir.length(), 1);
  dir.toArray().forEach((v, i) => close(v, expected[i]));
}
assert.equal(getSunPosition(-89.5, 45, '2030-01-01', { azimuthDeg: 103, elevationDeg: 2.5 }).source, 'manual');
assert.throws(() => getSunPosition(0, 0, null, { azimuthDeg: 500, elevationDeg: 2 }), /Sun azimuth/);
assert.throws(() => getEarthPosition(-89.5, 45, '2030-01-01'), /not implemented/);
const data = { ...base, radius_km: 0.5, grid: { size: 3, spacing_m: 500, elevations_m: [null, 0, null, 0, 0, 10, null, 0, null] } };
const mesh = createTerrain(data);
assert.equal(mesh.material.shadowSide, THREE.DoubleSide); // Open terrain must cast from either side.
assert(mesh.castShadow && mesh.receiveShadow);
assert(mesh.geometry.index.count > 0);
setExaggeration(mesh, 10);
assert.deepEqual(Array.from(mesh.geometry.attributes.position.array.slice(12, 15)), [0, 0, 0]);
assert.equal(data.grid.elevations_m[5], 10);
const index = mesh.geometry.index;
for (let i = 0; i < index.count; i++) assert.notEqual(data.grid.elevations_m[index.array[i]], null);
disposeTerrain(mesh);
console.log('Geometry checks passed: spherical curvature, pole coordinates, Sun directions, exact center, shadow casting, NoData topology, and explicit ephemeris hooks.');
