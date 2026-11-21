/**
 * Minimal 3-vector algebra shared by the ephemeris, occultation and relay
 * geometry. All vectors are plain objects so results stay JSON-safe and
 * comparable; nothing here depends on a graphics library or a coordinate frame
 * convention — the caller always states which frame its vectors are in
 * (EQJ = J2000 mean equator/equinox for every inertial use in CHANDRA).
 */
export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });

export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const length = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const norm = (a: V3): V3 => {
  const l = length(a) || 1;
  return mul(a, 1 / l);
};
export const distance = (a: V3, b: V3): number => length(sub(a, b));

/** True when every component is a finite number (guards against NaN propagation). */
export const isFiniteV3 = (a: V3): boolean =>
  Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);

/** Local topocentric (east, north, up) triad expressed in the parent inertial frame. */
export interface LocalFrame {
  east: V3;
  north: V3;
  up: V3;
}

/** Unit vector for a topocentric direction: azimuth clockwise from north, elevation above the horizon. */
export function directionFromAzEl(azimuthDeg: number, elevationDeg: number, local: LocalFrame): V3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const horizontal = Math.cos(el);
  return norm(add(
    add(mul(local.north, horizontal * Math.cos(az)), mul(local.east, horizontal * Math.sin(az))),
    mul(local.up, Math.sin(el)),
  ));
}

/** Azimuth (clockwise from north) and elevation of a topocentric vector. */
export function azElFromVector(v: V3, local: LocalFrame): { azimuthDeg: number; elevationDeg: number } {
  const east = dot(v, local.east);
  const north = dot(v, local.north);
  const up = dot(v, local.up);
  const horizontal = Math.hypot(east, north);
  return {
    azimuthDeg: wrap360((Math.atan2(east, north) * 180) / Math.PI),
    elevationDeg: (Math.atan2(up, horizontal) * 180) / Math.PI,
  };
}

export function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function wrap180(deg: number): number {
  const w = wrap360(deg);
  return w > 180 ? w - 360 : w;
}
