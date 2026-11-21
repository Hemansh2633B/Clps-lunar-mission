/**
 * Lunar-body occultation and limb geometry.
 *
 * WHY THIS MODULE EXISTS
 * CHANDRA's original geometry test answered "is the target above the local
 * *horizontal plane*?" (`elevation >= 0`). That is not the same question as
 * "does the Moon's body block the line of sight?". For a spherical Moon the
 * two differ by the curvature dip: an observer at radius p sees the mean limb
 * at elevation
 *
 *     h_limb = asin(R_moon / p) − 90°            (≤ 0, magnitude = dip)
 *
 * so a target at elevation −0.5° can be *above* the visible limb (a summed
 * elevation of a few hundred metres buys ~0.4°) or *behind* it. Near the limb
 * the old test was optimistic by up to the dip angle. This module separates the
 * three physically distinct obstructions:
 *
 *   1. lunar-body occultation  — the Moon itself (this module);
 *   2. local terrain obstruction — the DEM horizon mask (horizonPhysics);
 *   3. geometric elevation      — the local horizontal plane (cosmetic/reference).
 *
 * FRAMES AND CONVENTIONS
 *   • Elevations are degrees above the site's local horizontal plane (IAU 2015
 *     lunar body-fixed frame, east-positive longitude, planetocentric latitude).
 *   • Azimuths are degrees clockwise from north toward east.
 *   • Distances and radii are kilometres.
 *   • No atmosphere exists on the Moon, so no refraction term is applied.
 *
 * TREATMENT OF THE VERTICAL DATUM
 * Elevations in CHANDRA are relative to the 1737.4 km reference sphere, so a
 * site can be *below* that datum (e.g. −1200 m). A point below a radius-R sphere
 * has every line of sight blocked by that sphere, which is a datum artefact, not
 * physics. The local surface is the physically meaningful horizon, so the
 * curvature dip is computed from max(h, 0): a site at or below the datum uses a
 * 0° limb floor and relies on its own terrain mask. This convention is stated in
 * every output (`datumClamped: true`) and documented in
 * docs/scientific-method.md §2.4.
 *
 * LIMITS
 * The Moon is modelled as a sphere of radius 1737.4 km. Real limb topography
 * (~±8 km) and the Moon's oblateness (f ≈ 1.2×10⁻³) change limb clearance by a
 * few tenths of a degree near the limb; that is disclosed, never hidden.
 */
import { EARTH_RADIUS_KM, MOON_RADIUS_KM, SUN_RADIUS_KM } from './constants';
import { clamp } from './constants';
import type { V3 } from './vectors';
import { add, dot, length, mul, sub } from './vectors';

const DEG = Math.PI / 180;

/** The Moon's apparent limb from one observer, in that observer's local horizontal frame. */
export interface LunarLimb {
  /** Observer distance from the Moon's centre, km. */
  observerRadiusKm: number;
  /** Elevation of the mean lunar limb in the local horizontal frame, degrees (≤ 0). */
  limbElevationDeg: number;
  /** Curvature dip = −limbElevationDeg, degrees (≥ 0). */
  dipDeg: number;
  /** Apparent angular radius of the Moon's disk from the observer, degrees. */
  moonAngularRadiusDeg: number;
  /** True when the published elevation is at/below the 1737.4 km datum and the dip was clamped to 0. */
  datumClamped: boolean;
  bodyRadiusKm: number;
}

export type OccultationState = 'clear' | 'partial' | 'occulted';

export interface Occultation {
  state: OccultationState;
  /** Target-centre elevation minus limb elevation, degrees (+ above the limb). */
  limbClearanceDeg: number;
  /** Fraction of the target's apparent disk hidden by the Moon's limb, 0…1. */
  occultedFraction: number;
  /** Target angular radius used for the disk test, degrees. */
  targetAngularRadiusDeg: number;
  /** Limb elevation used for the test, degrees. */
  limbElevationDeg: number;
  /** Which sphere did the blocking: the Moon (always, in this module). */
  blockedBy: 'lunar-body';
}

/** Curvature dip and limb elevation for an observer at `observerRadiusKm` from the Moon's centre. */
export function lunarLimb(observerRadiusKm: number, bodyRadiusKm = MOON_RADIUS_KM): LunarLimb {
  const finite = Number.isFinite(observerRadiusKm) ? observerRadiusKm : bodyRadiusKm;
  const datumClamped = finite <= bodyRadiusKm;
  // Below the reference sphere the datum is unphysical for occultation; use the
  // local surface (documented above) instead of returning NaN.
  const p = Math.max(finite, bodyRadiusKm);
  const moonAngularRadiusDeg = Math.asin(clamp(bodyRadiusKm / p, -1, 1)) / DEG;
  return {
    observerRadiusKm: finite,
    limbElevationDeg: moonAngularRadiusDeg - 90,
    dipDeg: 90 - moonAngularRadiusDeg,
    moonAngularRadiusDeg,
    datumClamped,
    bodyRadiusKm,
  };
}

/** Apparent angular radius (degrees) of a sphere of radius r seen from distance d. */
export function angularRadiusDeg(radiusKm: number, distanceKm: number): number {
  if (!(distanceKm > radiusKm) || !Number.isFinite(distanceKm)) return 90;
  return Math.asin(clamp(radiusKm / distanceKm, -1, 1)) / DEG;
}

/**
 * Occultation of a target disk (centre elevation `elevationDeg`, apparent radius
 * `targetAngularRadiusDeg`) by the lunar limb.
 *
 * The limb is a circle of angular radius `moonAngularRadiusDeg` centred on the
 * nadir; the target is a circle of radius ρ_t whose centre is at angular
 * distance (90° + elevation) from the nadir. The overlap fraction of two
 * circles is exact (lens area), which makes "partial" a measurable state rather
 * than a guess.
 */
export function bodyOccultation(
  limb: LunarLimb,
  elevationDeg: number,
  targetAngularRadiusDeg: number,
  bodyAngularRadiusDeg = limb.moonAngularRadiusDeg,
): Occultation {
  const el = Number.isFinite(elevationDeg) ? elevationDeg : -90;
  const rhoT = Math.max(0, Number.isFinite(targetAngularRadiusDeg) ? targetAngularRadiusDeg : 0);
  const clearance = el - limb.limbElevationDeg;
  const separation = 90 + el; // angular distance from the nadir to the target centre
  const bodyRadius = Math.max(0, bodyAngularRadiusDeg);
  const fraction = clamp(circleOverlapFraction(separation, bodyRadius, rhoT), 0, 1);
  const state: OccultationState = clearance >= rhoT ? 'clear' : clearance <= -rhoT ? 'occulted' : 'partial';
  return {
    state,
    limbClearanceDeg: clearance,
    occultedFraction: state === 'clear' ? 0 : state === 'occulted' ? 1 : fraction,
    targetAngularRadiusDeg: rhoT,
    limbElevationDeg: limb.limbElevationDeg,
    blockedBy: 'lunar-body',
  };
}

/** Area of a circle of radius r whose centre is `d` from another circle of radius R. */
function circleOverlapArea(R: number, r: number, d: number): number {
  if (d >= R + r) return 0;
  if (d <= Math.abs(R - r)) return Math.PI * Math.min(R, r) ** 2;
  const a = R * R * Math.acos(clamp((d * d + R * R - r * r) / (2 * d * R), -1, 1));
  const b = r * r * Math.acos(clamp((d * d + r * r - R * R) / (2 * d * r), -1, 1));
  const c = 0.5 * Math.sqrt(Math.max(0, (-d + R + r) * (d + R - r) * (d - R + r) * (d + R + r)));
  return a + b - c;
}

function circleOverlapFraction(d: number, R: number, r: number): number {
  if (r <= 0) return d >= R ? 0 : 1;
  return circleOverlapArea(R, r, d) / (Math.PI * r * r);
}

/** Angular radius of the Sun as seen from the Moon (≈0.266°). */
export const sunAngularRadiusDeg = (distanceKm: number): number => angularRadiusDeg(SUN_RADIUS_KM, distanceKm);
/** Angular radius of the Earth as seen from the Moon (≈0.95°). */
export const earthAngularRadiusDeg = (distanceKm: number): number => angularRadiusDeg(EARTH_RADIUS_KM, distanceKm);

export interface RayOcclusion {
  /** True when the Moon's mean sphere intersects the open segment. */
  occluded: boolean;
  /** Closest approach of the segment to the Moon's centre, km. */
  minCenterDistanceKm: number;
  /** minCenterDistance − effectiveBodyRadiusKm (negative when the ray passes inside the body). */
  clearanceKm: number;
  /** Parameter along the segment (0 at `from`, 1 at `to`) of the closest approach. */
  closestT: number;
  /** Sphere radius actually used. Clamped to the observer radius for sub-datum sites (see module notes). */
  effectiveBodyRadiusKm: number;
}

/**
 * Exact ray/sphere test used for relay links, where a site→spacecraft leg is a
 * finite 3-D segment rather than a fixed elevation. The sphere test is geometry
 * only: terrain is handled separately by the site's horizon mask.
 */
export function raySphereOcclusion(from: V3, to: V3, bodyRadiusKm = MOON_RADIUS_KM): RayOcclusion {
  const d = sub(to, from);
  const len = length(d);
  const fromRadius = length(from);
  // A sub-datum site (elevation below the 1737.4 km sphere) is inside the datum
  // sphere; clamping the sphere to the observer's own radius keeps the test
  // physical (the local surface is the horizon) instead of reporting every
  // direction as blocked.
  const effectiveBodyRadiusKm = Math.min(bodyRadiusKm, fromRadius);
  const t = len > 0 ? clamp(-dot(from, d) / (len * len), 0, 1) : 0;
  const minCenterDistanceKm = len > 0 ? length(add(from, mul(d, t))) : fromRadius;
  return {
    occluded: minCenterDistanceKm < effectiveBodyRadiusKm,
    minCenterDistanceKm,
    clearanceKm: minCenterDistanceKm - effectiveBodyRadiusKm,
    closestT: t,
    effectiveBodyRadiusKm,
  };
}
