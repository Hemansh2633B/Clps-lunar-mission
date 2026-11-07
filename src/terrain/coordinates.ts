import type { TerrainData } from './types';

/** Local AEQD east/north arc distances → curved landing tangent frame (km). */
export function tangentPoint(eastM: number, northM: number, elevationM: number, data: TerrainData, exaggeration = 1): [number, number, number] {
  const distance = Math.hypot(eastM, northM);
  if (distance === 0) return [0, ((elevationM - data.landing_elevation_m) * exaggeration) / 1000, 0];
  const angle = distance / data.source.lunar_radius_m;
  const datumRadius = data.source.elevation_reference_radius_m;
  const radialHeight = datumRadius + elevationM;
  const scale = radialHeight * Math.sin(angle) / distance;
  const displayedHeight = datumRadius + data.landing_elevation_m + (elevationM - data.landing_elevation_m) * exaggeration;
  return [
    (eastM * scale) / 1000,
    (displayedHeight * Math.cos(angle) - (datumRadius + data.landing_elevation_m)) / 1000,
    (-northM * scale) / 1000,
  ];
}

/** Forward great-circle solution; stable at ±90° latitude. */
export function sampleLonLat(eastM: number, northM: number, data: TerrainData): { latitude: number; longitude: number } {
  const phi = (data.latitude * Math.PI) / 180;
  const lambda = (data.longitude * Math.PI) / 180;
  const distance = Math.hypot(eastM, northM);
  if (distance === 0) return { latitude: data.latitude, longitude: data.longitude };
  const delta = distance / data.source.lunar_radius_m;
  const u = eastM / distance;
  const v = northM / distance;
  const x = Math.cos(phi) * Math.cos(lambda) * Math.cos(delta)
    + (-u * Math.sin(lambda) - v * Math.sin(phi) * Math.cos(lambda)) * Math.sin(delta);
  const y = Math.cos(phi) * Math.sin(lambda) * Math.cos(delta)
    + (u * Math.cos(lambda) - v * Math.sin(phi) * Math.sin(lambda)) * Math.sin(delta);
  const z = Math.sin(phi) * Math.cos(delta) + v * Math.cos(phi) * Math.sin(delta);
  const latitude = Math.atan2(z, Math.hypot(x, y));
  const longitude = Math.atan2(y, x);
  return { latitude: (latitude * 180) / Math.PI, longitude: (((longitude * 180) / Math.PI + 540) % 360) - 180 };
}
