/**
 * Shared geometric result types. They live outside the engine modules so the
 * mission result types and the engine can both depend on them without a
 * circular *runtime* import (all of these are type-only).
 *
 * Frames: every 3-vector here is expressed in the J2000 mean equator/equinox
 * frame (EQJ) used by astronomy-engine, unless a field name says otherwise.
 * Distances are kilometres, angles degrees, times UTC milliseconds.
 */
import type { LocalFrame, V3 } from '../engine/vectors';
import type { LunarLimb, Occultation } from '../engine/occultation';

/** IAU 2015 lunar body-fixed basis expressed in EQJ. */
export interface BodyFrame {
  x: V3;
  y: V3;
  z: V3;
}

/** Everything the occultation / incidence / relay models need from one epoch. */
export interface SiteGeometry {
  /** Moon centre → site, km, EQJ. */
  sitePositionEqjKm: V3;
  /** Earth → Moon, km, EQJ. */
  moonPositionEqjKm: V3;
  /** Moon → Earth, km, EQJ. */
  earthFromMoonEqjKm: V3;
  /** Site distance from the Moon's centre, km (published elevation on the 1737.4 km datum). */
  observerRadiusKm: number;
  /** Local east/north/up triad in EQJ. */
  local: LocalFrame;
  /** IAU 2015 body-fixed basis in EQJ. */
  bodyFrame: BodyFrame;
  /** Mean lunar limb as seen from the site (curvature dip included). */
  limb: LunarLimb;
  /** Sun occultation by the lunar body, finite solar disk considered. */
  sunOccultation: Occultation;
  /** Earth occultation by the lunar body, finite Earth disk considered. */
  earthOccultation: Occultation;
  sunAngularRadiusDeg: number;
  earthAngularRadiusDeg: number;
}
