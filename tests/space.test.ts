import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { latLonToVec3 } from '../src/three/geo';

describe('selenographic → three.js mapping (equirectangular alignment)', () => {
  const near = (v: THREE.Vector3, x: number, y: number, z: number) => {
    expect(v.x).toBeCloseTo(x, 6); expect(v.y).toBeCloseTo(y, 6); expect(v.z).toBeCloseTo(z, 6);
  };
  it('lon 0° → +X (map centre / near side)', () => near(latLonToVec3(0, 0, 1), 1, 0, 0));
  it('lon 90°E → −Z', () => near(latLonToVec3(0, 90, 1), 0, 0, -1));
  it('lon 90°W → +Z', () => near(latLonToVec3(0, -90, 1), 0, 0, 1));
  it('north pole → +Y, south pole → −Y', () => {
    near(latLonToVec3(90, 0, 1), 0, 1, 0);
    near(latLonToVec3(-90, 0, 1), 0, -1, 0);
  });
  it('preserves radius for arbitrary lat/lon', () => {
    for (const [lat, lon] of [[-89.5, 45], [12.3, -170.2], [0, 180], [66.5, 90]]) {
      expect(latLonToVec3(lat, lon, 1.012).length()).toBeCloseTo(1.012, 6);
    }
  });
});
