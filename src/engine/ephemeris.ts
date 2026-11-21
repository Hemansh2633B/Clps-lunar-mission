import * as A from 'astronomy-engine';
import type { EphemerisSample, LandingSite, SkyPosition } from '../types/mission';
import { AU_KM, MOON_RADIUS_KM, wrap180, wrap360 } from './constants';
import type { V3 } from './vectors';
import { add, dot, length, mul, norm, sub } from './vectors';
import type { LocalFrame } from './vectors';
import { bodyOccultation, earthAngularRadiusDeg, lunarLimb, sunAngularRadiusDeg } from './occultation';
import type { BodyFrame, SiteGeometry } from '../types/geometry';

export type { LocalFrame } from './vectors';
export type { BodyFrame, SiteGeometry } from '../types/geometry';

/** IAU 2015 Moon body-fixed frame expressed in J2000 mean equator (EQJ). */
export function moonBodyFrame(time: A.AstroTime): BodyFrame {
  const axis = A.RotationAxis(A.Body.Moon, time);
  const z = norm(axis.north);
  const node = norm({ x: -z.y, y: z.x, z: 0 });
  const w = (axis.spin * Math.PI) / 180;
  const x = norm(add(mul(node, Math.cos(w)), mul(crossArr(z, node), Math.sin(w))));
  const y = norm(crossArr(z, x));
  return { x, y, z };
}

function crossArr(a: V3, b: V3): V3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

/**
 * Local east/north/up triad at a selenographic site, expressed in EQJ.
 * Latitude is planetocentric and longitude east-positive (IAU 2015).
 */
export function localFrame(site: Pick<LandingSite, 'latitude' | 'longitude' | 'elevationM'>, frame: BodyFrame): LocalFrame {
  const lat = (site.latitude * Math.PI) / 180;
  const lon = (wrap360(site.longitude) * Math.PI) / 180;
  const cl = Math.cos(lat);
  const sl = Math.sin(lat);
  const co = Math.cos(lon);
  const so = Math.sin(lon);
  const bodyUp = add(add(mul(frame.x, cl * co), mul(frame.y, cl * so)), mul(frame.z, sl));
  const bodyEast = add(mul(frame.x, -so), mul(frame.y, co));
  const bodyNorth = add(add(mul(frame.x, -sl * co), mul(frame.y, -sl * so)), mul(frame.z, cl));
  return { up: norm(bodyUp), east: norm(bodyEast), north: norm(bodyNorth) };
}

function toSky(topocentric: V3, local: LocalFrame): SkyPosition {
  const east = dot(topocentric, local.east);
  const north = dot(topocentric, local.north);
  const up = dot(topocentric, local.up);
  const horizontal = Math.hypot(east, north);
  const distanceKm = length(topocentric) * AU_KM;
  return {
    azimuthDeg: wrap360((Math.atan2(east, north) * 180) / Math.PI),
    elevationDeg: (Math.atan2(up, horizontal) * 180) / Math.PI,
    distanceKm,
  };
}

function toBody(v: V3, frame: BodyFrame): V3 {
  return { x: dot(v, frame.x), y: dot(v, frame.y), z: dot(v, frame.z) };
}

function bodyLatLon(v: V3): { lat: number; lon: number } {
  const n = norm(v);
  return {
    lat: (Math.asin(Math.max(-1, Math.min(1, n.z))) * 180) / Math.PI,
    lon: wrap360((Math.atan2(n.y, n.x) * 180) / Math.PI),
  };
}

function aberrate(direction: V3, beta: V3): V3 {
  const s = norm(direction);
  const perpendicular = sub(beta, mul(s, dot(s, beta)));
  return norm(add(s, perpendicular));
}

/**
 * Topocentric Sun and Earth directions for a selenographic site.
 * Sun: heliocentric Moon vector back-dated for light time, first-order aberration.
 * Earth: geocentric Moon vector (light-time corrected by astronomy-engine), geometric.
 * No atmospheric refraction is applied — the Moon has no appreciable atmosphere.
 *
 * The returned `geometry` block is additive: it makes lunar-body occultation
 * explicit (see occultation.ts) instead of leaving it implicit in the sign of an
 * elevation, and it carries the inertial vectors the relay model needs so that
 * geometry is never recomputed from a different source.
 */
export function computeEphemeris(site: LandingSite, timeMs: number): EphemerisSample {
  if (!Number.isFinite(site.latitude) || site.latitude < -90 || site.latitude > 90) throw new RangeError('Site latitude must be finite and within −90°…90°.');
  if (!Number.isFinite(site.longitude) || site.longitude < -180 || site.longitude > 360) throw new RangeError('Site longitude must be finite and within −180°…360° east-positive.');
  if (!Number.isFinite(site.elevationM) || site.elevationM < -20_000 || site.elevationM > 100_000) throw new RangeError('Site elevation must be a finite lunar datum height in metres.');
  if (!Number.isFinite(timeMs) || !Number.isFinite(new Date(timeMs).getTime())) throw new RangeError('Ephemeris epoch must be a valid UTC millisecond timestamp.');
  const time = new A.AstroTime(new Date(timeMs));
  const frame = moonBodyFrame(time);
  const local = localFrame(site, frame);
  const observerRadiusKm = MOON_RADIUS_KM + site.elevationM / 1000;
  const observer = mul(local.up, observerRadiusKm / AU_KM);

  const sunGeometric = mul(A.HelioVector(A.Body.Moon, time), -1);
  const sunLightCorrected = A.CorrectLightTravel((t) => {
    const v = A.HelioVector(A.Body.Moon, t);
    return new A.Vector(-v.x, -v.y, -v.z, t);
  }, time);
  const lightDays = Math.hypot(sunGeometric.x, sunGeometric.y, sunGeometric.z) / A.C_AUDAY;
  const moonState = A.HelioState(A.Body.Moon, time.AddDays(-lightDays));
  const beta = { x: moonState.vx / A.C_AUDAY, y: moonState.vy / A.C_AUDAY, z: moonState.vz / A.C_AUDAY };
  const sunDirection = aberrate(sunLightCorrected, beta);
  const sunTopo = sub(mul(sunDirection, sunLightCorrected.Length()), observer);
  const sun = toSky(sunTopo, local);

  const moonGeo = A.GeoVector(A.Body.Moon, time, false);
  const earthFromMoon = mul({ x: -moonGeo.x, y: -moonGeo.y, z: -moonGeo.z }, AU_KM);
  const earthTopo = sub(mul(earthFromMoon, 1 / AU_KM), observer);
  const earth = toSky(earthTopo, local);

  // Sub-solar and sub-Earth points are SELENOCENTRIC: the body-fixed points where
  // the Sun / Earth is at zenith. They are properties of the Moon-Sun / Moon-Earth
  // geometry and must NOT depend on the observer's site. (The topocentric `earthTopo`
  // is still used above for the Earth's apparent az/el in the site's sky, where the
  // ~0.26 deg lunar-radius parallax is physically correct.) Using earthTopo here
  // previously shifted the reported sub-Earth point by the observer parallax.
  const subsolar = bodyLatLon(toBody(sunDirection, frame));
  const subEarth = bodyLatLon(toBody(earthFromMoon, frame));
  const lib = A.Libration(time);

  const limb = lunarLimb(observerRadiusKm);
  const sunRadius = sunAngularRadiusDeg(sun.distanceKm);
  const earthRadius = earthAngularRadiusDeg(earth.distanceKm);
  const moonPositionEqjKm = mul({ x: moonGeo.x, y: moonGeo.y, z: moonGeo.z }, AU_KM);
  const geometry: SiteGeometry = {
    sitePositionEqjKm: add(moonPositionEqjKm, mul(local.up, observerRadiusKm)),
    moonPositionEqjKm,
    earthFromMoonEqjKm: earthFromMoon,
    observerRadiusKm,
    local,
    bodyFrame: frame,
    limb,
    sunOccultation: bodyOccultation(limb, sun.elevationDeg, sunRadius),
    earthOccultation: bodyOccultation(limb, earth.elevationDeg, earthRadius),
    sunAngularRadiusDeg: sunRadius,
    earthAngularRadiusDeg: earthRadius,
  };

  return {
    timeMs,
    sun,
    earth,
    libration: {
      subEarthLatitudeDeg: subEarth.lat,
      subEarthLongitudeDeg: wrap180(subEarth.lon),
      opticalLatitudeDeg: lib.elat,
      opticalLongitudeDeg: lib.elon,
    },
    subsolarLatitudeDeg: subsolar.lat,
    subsolarLongitudeDeg: subsolar.lon,
    geometry,
  };
}
