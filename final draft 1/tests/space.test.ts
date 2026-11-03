import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildVehicle, disposeVehicle, VEHICLE_SPECS, type VehicleId } from '../src/three/vehicles';
import { latLonToVec3 } from '../src/three/geo';

describe('fleet vehicle models', () => {
  const ids: VehicleId[] = ['starship-stack', 'starship-hls', 'clps-lander'];

  it('exposes three specs with positive dimensions', () => {
    expect(VEHICLE_SPECS).toHaveLength(3);
    for (const s of VEHICLE_SPECS) {
      expect(s.heightM).toBeGreaterThan(0);
      expect(s.diameterM).toBeGreaterThan(0);
      expect(s.name.length).toBeGreaterThan(0);
    }
  });

  for (const id of ids) {
    it(`builds ${id} with named parts, plume anchors and finite bounds`, () => {
      const v = buildVehicle(id);
      expect(v.group).toBeInstanceOf(THREE.Group);
      expect(v.parts.length).toBeGreaterThan(1);
      expect(v.height).toBeGreaterThan(0);
      expect(v.plumeAnchors.length).toBeGreaterThan(0);
      for (const p of v.parts) {
        expect(p.name.length).toBeGreaterThan(0);
        expect(p.role.length).toBeGreaterThan(0);
        expect(p.object).toBeInstanceOf(THREE.Object3D);
      }
      const box = new THREE.Box3().setFromObject(v.group);
      expect(Number.isFinite(box.min.y)).toBe(true);
      expect(Number.isFinite(box.max.y)).toBe(true);
      expect(box.max.y - box.min.y).toBeGreaterThan(0);
      // every mesh carries a part tag for raycaster callouts
      let meshes = 0;
      v.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { meshes++; expect(o.userData.partName).toBeTruthy(); } });
      expect(meshes).toBeGreaterThan(0);
      expect(() => disposeVehicle(v)).not.toThrow();
    });
  }

  it('only the full stack has a separable upper stage + booster', () => {
    const stack = buildVehicle('starship-stack');
    expect(stack.upperStage).not.toBeNull();
    expect(stack.booster).not.toBeNull();
    for (const id of ['starship-hls', 'clps-lander'] as VehicleId[]) {
      const v = buildVehicle(id);
      expect(v.upperStage).toBeNull();
      expect(v.booster).toBeNull();
    }
  });

  it('HLS has landing legs but the stack does not', () => {
    const hls = buildVehicle('starship-hls');
    expect(hls.parts.some((p) => /leg/i.test(p.name))).toBe(true);
    const stack = buildVehicle('starship-stack');
    expect(stack.parts.some((p) => /leg/i.test(p.name))).toBe(false);
  });
});

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
