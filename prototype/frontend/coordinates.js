// Local AEQD samples use east/north arc distances on the DEM's CRS sphere.
// Rendering converts radial elevations to the landing site's tangent frame.
export function tangentPoint(eastM, northM, elevationM, data, exaggeration = 1) {
  const distance = Math.hypot(eastM, northM);
  if (distance === 0) return [0, (elevationM - data.landing_elevation_m) * exaggeration / 1000, 0];
  const angle = distance / data.source.lunar_radius_m;
  const datumRadius = data.source.elevation_reference_radius_m;
  const radialHeight = datumRadius + elevationM;
  const scale = distance > 0 ? radialHeight * Math.sin(angle) / distance : 1;
  const displayedHeight = datumRadius + data.landing_elevation_m + (elevationM - data.landing_elevation_m) * exaggeration;
  return [eastM * scale / 1000,
    (displayedHeight * Math.cos(angle) - (datumRadius + data.landing_elevation_m)) / 1000,
    -northM * scale / 1000];
}

export function sampleLonLat(eastM, northM, data) {
  // Forward great-circle solution. Longitude defines the local meridian at a pole.
  const phi = data.latitude * Math.PI / 180;
  const lambda = data.longitude * Math.PI / 180;
  const delta = Math.hypot(eastM, northM) / data.source.lunar_radius_m;
  const distance = Math.hypot(eastM, northM);
  if (distance === 0) return { latitude: data.latitude, longitude: data.longitude };
  // A vector basis remains well conditioned at ±90°, unlike the usual
  // longitude formula with a near-zero denominator at the poles.
  const u = eastM / distance, v = northM / distance;
  const x = Math.cos(phi) * Math.cos(lambda) * Math.cos(delta)
    + (-u * Math.sin(lambda) - v * Math.sin(phi) * Math.cos(lambda)) * Math.sin(delta);
  const y = Math.cos(phi) * Math.sin(lambda) * Math.cos(delta)
    + (u * Math.cos(lambda) - v * Math.sin(phi) * Math.sin(lambda)) * Math.sin(delta);
  const z = Math.sin(phi) * Math.cos(delta) + v * Math.cos(phi) * Math.sin(delta);
  const latitude = Math.atan2(z, Math.hypot(x, y));
  const longitude = Math.atan2(y, x);
  return { latitude: latitude * 180 / Math.PI, longitude: ((longitude * 180 / Math.PI + 540) % 360) - 180 };
}
