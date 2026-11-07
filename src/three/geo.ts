import * as THREE from 'three';

/**
 * Selenographic lat/lon → three.js direction for an equirectangular map whose
 * centre is 0° longitude. Matches three.js SphereGeometry UVs:
 *   lon 0° → +X, lon 90°E → −Z, north pole → +Y.
 * Verified against the moon_1024.jpg texture orientation in tests.
 */
export function latLonToVec3(lat: number, lon: number, r: number): THREE.Vector3 {
  const phi = (lat * Math.PI) / 180;
  const lam = (lon * Math.PI) / 180;
  return new THREE.Vector3(
    r * Math.cos(phi) * Math.cos(lam),
    r * Math.sin(phi),
    -r * Math.cos(phi) * Math.sin(lam),
  );
}
