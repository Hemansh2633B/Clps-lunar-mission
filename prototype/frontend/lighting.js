import * as THREE from 'three';
import { getSunPosition } from './ephemeris.js';

// Input bearing: clockwise from true local north. Scene: +X east, +Y up, -Z north.
export function sunDirection(azimuthDeg, elevationDeg) {
  const az = THREE.MathUtils.degToRad(azimuthDeg), el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

export class LightingController {
  constructor(scene, renderer) {
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
    this.position = null;
  }

  update(mesh, data, manual, shadows) {
    this.applySunPosition(mesh, data, getSunPosition(data.latitude, data.longitude, null, manual), shadows);
  }

  // A future async SPICE client can await its ephemeris, then call this method.
  // Lighting geometry is independent of how the verified angles are obtained.
  applySunPosition(mesh, data, position, shadows) {
    if (!Number.isFinite(position.azimuthDeg) || !Number.isFinite(position.elevationDeg)) {
      throw new Error('Sun provider must return finite local azimuth and elevation in degrees.');
    }
    this.position = position;
    const direction = sunDirection(this.position.azimuthDeg, this.position.elevationDeg);
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
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
    const points = [];
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
