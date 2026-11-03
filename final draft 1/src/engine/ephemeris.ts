import * as A from 'astronomy-engine';
import type { EphemerisSample, LandingSite, SkyPosition } from '../types/mission';
import { AU_KM, MOON_RADIUS_KM, wrap180, wrap360 } from './constants';

type V3 = { x: number; y: number; z: number };

const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm = (a: V3): V3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return mul(a, 1 / l);
};

export interface BodyFrame {
  x: V3;
  y: V3;
  z: V3;
}

export interface LocalFrame {
  east: V3;
  north: V3;
  up: V3;
}

/** IAU 2015 Moon body-fixed frame expressed in J2000 mean equator (EQJ). */
export function moonBodyFrame(time: A.AstroTime): BodyFrame {
  const axis = A.RotationAxis(A.Body.Moon, time);
  const z = norm(axis.north);
  const node = norm({ x: -z.y, y: z.x, z: 0 });
  const w = (axis.spin * Math.PI) / 180;
  const x = norm(add(mul(node, Math.cos(w)), mul(cross(z, node), Math.sin(w))));
  const y = norm(cross(z, x));
  return { x, y, z };
}

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
  const distanceKm = Math.hypot(topocentric.x, topocentric.y, topocentric.z) * AU_KM;
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
 */
export function computeEphemeris(site: LandingSite, timeMs: number): EphemerisSample {
  const time = new A.AstroTime(new Date(timeMs));
  const frame = moonBodyFrame(time);
  const local = localFrame(site, frame);
  const radiusAU = (MOON_RADIUS_KM + site.elevationM / 1000) / AU_KM;
  const observer = mul(local.up, radiusAU);

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

  const earthFromMoon = mul(A.GeoVector(A.Body.Moon, time, false), -1);
  const earthTopo = sub(earthFromMoon, observer);
  const earth = toSky(earthTopo, local);

  const subsolar = bodyLatLon(toBody(sunDirection, frame));
  const subEarth = bodyLatLon(toBody(earthTopo, frame));
  const lib = A.Libration(time);

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
  };
}
