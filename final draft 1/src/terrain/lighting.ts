import * as THREE from 'three';
import type { SunPosition, TerrainData } from './types';
import type { TerrainMesh } from './terrainMesh';

export function sunDirection(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

export class LightingController {
  readonly sun: THREE.DirectionalLight;
  readonly fill: THREE.AmbientLight;
  position: SunPosition | null = null;
  private renderer: THREE.WebGLRenderer;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.sun = new THREE.DirectionalLight(0xfff3df, 3.0);
    this.sun.castShadow = true;
    this.fill = new THREE.AmbientLight(0xb2bdd0, 0.16); // Display fill, not physical lunar sky light.
    scene.add(this.sun, this.sun.target, this.fill);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    this.sun.shadow.autoUpdate = false;
    this.sun.shadow.bias = -0.00001;
    this.sun.shadow.radius = 1;
  }

  applySunPosition(mesh: TerrainMesh, data: TerrainData, position: SunPosition, shadows: boolean) {
    if (!Number.isFinite(position.azimuthDeg) || !Number.isFinite(position.elevationDeg)) {
      throw new Error('Sun provider must return finite local azimuth and elevation in degrees.');
    }
    this.position = position;
    const direction = sunDirection(position.azimuthDeg, position.elevationDeg);
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    const center = box.getCenter(new THREE.Vector3());
    const extent = box.getSize(new THREE.Vector3());
    const distance = extent.length() * 2 + 1;
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(direction, distance);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    const camera = this.sun.shadow.camera;
    camera.position.copy(this.sun.position);
    camera.up.set(0, 1, 0);
    if (Math.abs(direction.y) > 0.999) camera.up.set(0, 0, -1);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    const points: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      points.push(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
    }
    const lightBounds = new THREE.Box3().setFromPoints(points);
    const margin = Math.max(data.radius_km * 0.05, 0.02);
    camera.left = lightBounds.min.x - margin;
    camera.right = lightBounds.max.x + margin;
    camera.bottom = lightBounds.min.y - margin;
    camera.top = lightBounds.max.y + margin;
    camera.near = Math.max(0.01, -lightBounds.max.z - margin);
    camera.far = -lightBounds.min.z + margin;
    camera.updateProjectionMatrix();
    this.sun.shadow.normalBias = data.radius_km * 0.00003;
    const mapSize = data.grid.size <= 129 ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(mapSize, mapSize);
    }
    const changed = this.renderer.shadowMap.enabled !== shadows;
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    if (changed) mesh.material.needsUpdate = true;
    this.renderer.shadowMap.needsUpdate = true;
    this.sun.shadow.needsUpdate = true;
  }
}
