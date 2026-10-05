import * as THREE from 'three';
import { tangentPoint } from './coordinates.js';

export function createTerrain(data) {
  const n = data.grid.size;
  const positions = new Float32Array(n * n * 3);
  const samples = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  const valid = new Uint8Array(n * n);
  const indices = [];
  const radius = data.radius_km * 1000;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col;
      const h = data.grid.elevations_m[i];
      const east = -radius + col * data.grid.spacing_m;
      const north = radius - row * data.grid.spacing_m;
      positions.set(tangentPoint(east, north, h ?? data.landing_elevation_m, data), i * 3);
      samples.set([east, north, h ?? 0], i * 3);
      uv.set([col / (n - 1), 1 - row / (n - 1)], i * 2);
      valid[i] = h !== null ? 1 : 0;
    }
  }
  for (let row = 0; row < n - 1; row++) {
    for (let col = 0; col < n - 1; col++) {
      const a = row * n + col, b = a + 1, c = a + n, d = c + 1;
      if (valid[a] && valid[c] && valid[b]) indices.push(a, c, b);
      if (valid[b] && valid[c] && valid[d]) indices.push(b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('sample', new THREE.BufferAttribute(samples, 3));
  // UVs address the extracted local grid. Future imagery must be reprojected
  // onto this same grid before setting material.map.
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x858991, roughness: 1, metalness: 0, shadowSide: THREE.DoubleSide }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.data = data;
  return mesh;
}

export function setExaggeration(mesh, factor) {
  const data = mesh.userData.data;
  const position = mesh.geometry.attributes.position;
  const samples = mesh.geometry.attributes.sample;
  for (let i = 0; i < position.count; i++) {
    if (data.grid.elevations_m[i] === null) continue;
    const point = tangentPoint(samples.getX(i), samples.getY(i), data.grid.elevations_m[i], data, factor);
    position.setY(i, point[1]);
  }
  position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingSphere();
  mesh.geometry.computeBoundingBox();
}

export function interpolateSample(hit) {
  const mesh = hit.object;
  const local = mesh.worldToLocal(hit.point.clone());
  const positions = mesh.geometry.attributes.position;
  const sample = mesh.geometry.attributes.sample;
  const { a, b, c } = hit.face;
  const bary = THREE.Triangle.getBarycoord(local,
    new THREE.Vector3().fromBufferAttribute(positions, a),
    new THREE.Vector3().fromBufferAttribute(positions, b),
    new THREE.Vector3().fromBufferAttribute(positions, c), new THREE.Vector3());
  const value = new THREE.Vector3().fromBufferAttribute(sample, a).multiplyScalar(bary.x)
    .addScaledVector(new THREE.Vector3().fromBufferAttribute(sample, b), bary.y)
    .addScaledVector(new THREE.Vector3().fromBufferAttribute(sample, c), bary.z);
  return { east_m: value.x, north_m: value.y, elevation_m: value.z, distance_m: Math.hypot(value.x, value.y) };
}

function sampleHeight(east, north, data) {
  const n = data.grid.size;
  const col = (east + data.radius_km * 1000) / data.grid.spacing_m;
  const row = (data.radius_km * 1000 - north) / data.grid.spacing_m;
  const c = Math.floor(col), r = Math.floor(row);
  if (c < 0 || r < 0 || c >= n - 1 || r >= n - 1) return null;
  const heights = [r * n + c, r * n + c + 1, (r + 1) * n + c, (r + 1) * n + c + 1].map(i => data.grid.elevations_m[i]);
  if (heights.some(h => h === null)) return null;
  const u = col - c, v = row - r;
  return heights[0] * (1 - u) * (1 - v) + heights[1] * u * (1 - v) + heights[2] * (1 - u) * v + heights[3] * u * v;
}

export function createAnnotations(data, exaggeration) {
  const group = new THREE.Group();
  const radius = data.radius_km;
  const marker = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.012, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0xd5f29a, depthTest: false }));
  marker.position.set(0, 0, 0); // Exact center sample / requested landing coordinate.
  marker.renderOrder = 3;
  group.add(marker);
  const points = [];
  const count = 256;
  const sampleRadius = radius * 1000 - data.grid.spacing_m * 1.5;
  function edgePoint(i) {
    const angle = i / count * Math.PI * 2;
    const h = sampleHeight(sampleRadius * Math.sin(angle), sampleRadius * Math.cos(angle), data);
    if (h === null) return null;
    const p = tangentPoint(radius * 1000 * Math.sin(angle), radius * 1000 * Math.cos(angle), h, data, exaggeration);
    p[1] += radius * 0.007;
    return p;
  }
  for (let i = 0; i < count; i++) {
    const a = edgePoint(i), b = edgePoint(i + 1);
    if (a && b) points.push(...a, ...b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xb8d985, transparent: true, opacity: 0.85, depthTest: false })));
  return group;
}

export function disposeAnnotations(group) {
  group.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
}

export function disposeTerrain(mesh) {
  mesh.geometry.dispose();
  mesh.material.map?.dispose();
  mesh.material.dispose();
}
