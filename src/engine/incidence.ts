/**
 * Solar incidence on the local terrain surface.
 *
 * Incidence is a property of the SURFACE, not of the Sun alone: on a slope of
 * angle s whose downslope azimuth is a, a Sun at elevation e and azimuth z
 * strikes the ground at
 *
 *     cos(i) = n̂ · ŝ
 *     n̂ = (−sin s·sin a, −sin s·cos a, cos s)      (east, north, up)
 *     ŝ = ( cos e·sin z,  cos e·cos z,  sin e )
 *
 * so a level surface gives cos i = sin e (the familiar case) and a slope tilted
 * toward the Sun can exceed it. On the Moon the Sun's angular radius (~0.27°)
 * softens the terminator; that is not modelled here (the geometric direction is
 * used, consistently with the rest of the engine).
 *
 * ASPECT CONVENTION: aspect is the azimuth of the DOWNslope direction, degrees
 * clockwise from north — the same convention used by GIS tools. A missing slope
 * is never silently treated as a measured one: the caller passes
 * `source: 'assumed-flat'` and every consumer displays that.
 */
import { clamp } from './constants';
import type { SolarIncidence } from '../types/mission';

export type SlopeSource = SolarIncidence['source'];

export interface SlopeSpec {
  slopeDeg: number;
  aspectDeg: number;
  source: SlopeSource;
}

const DEG = Math.PI / 180;

/** Unit normal of the local terrain surface in (east, north, up). */
export function terrainNormal(slopeDeg: number, aspectDeg: number): { east: number; north: number; up: number } {
  const s = clamp(slopeDeg, 0, 90) * DEG;
  const a = aspectDeg * DEG;
  // With downslope aspect pointing in azimuth `a`, the outward surface normal
  // leans in that same horizontal direction (e.g. a south-facing slope has
  // aspect 180° and a south-tilted normal).
  return { east: Math.sin(s) * Math.sin(a), north: Math.sin(s) * Math.cos(a), up: Math.cos(s) };
}

/** Solar incidence for a Sun direction and a terrain slope. */
export function solarIncidence(sunAzimuthDeg: number, sunElevationDeg: number, slope: SlopeSpec): SolarIncidence {
  const n = terrainNormal(slope.slopeDeg, slope.aspectDeg);
  const e = clamp(sunElevationDeg, -90, 90) * DEG;
  const z = sunAzimuthDeg * DEG;
  const sx = Math.cos(e) * Math.sin(z);
  const sy = Math.cos(e) * Math.cos(z);
  const sz = Math.sin(e);
  const cosIncidence = n.east * sx + n.north * sy + n.up * sz;
  return {
    slopeDeg: slope.slopeDeg,
    aspectDeg: slope.aspectDeg,
    // Geometric incidence is reported in [0°, 180°]. A value >90° means the
    // surface faces away from the Sun; its direct-beam projection is clipped to 0.
    incidenceDeg: Math.acos(clamp(cosIncidence, -1, 1)) / DEG,
    cosIncidence: Math.max(0, cosIncidence),
    source: slope.source,
  };
}

/**
 * Direct-beam power on a terrain facet: flux × area × efficiency × derate × cos i.
 * This is the facet-scale counterpart of the flat-deck ("horizontal") array and
 * is only meaningful when a measured or user-supplied slope exists.
 */
export function facetPowerW(fluxWm2: number, areaM2: number, cosIncidence: number, efficiency: number, derate: number): number {
  return fluxWm2 * areaM2 * efficiency * derate * clamp(cosIncidence, 0, 1);
}

/** Mean incidence angle (degrees) over samples that carry an incidence value. */
export function meanIncidenceDeg(values: Array<{ incidenceDeg: number; cosIncidence: number }>): number | null {
  const lit = values.filter((v) => v.cosIncidence > 0);
  if (lit.length === 0) return null;
  return lit.reduce((sum, v) => sum + v.incidenceDeg, 0) / lit.length;
}
