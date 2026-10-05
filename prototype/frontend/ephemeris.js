// Replace this provider with a SPICE-backed implementation later. Sun vectors
// must be converted from the verified DEM body frame to local east/north/up.
export class ManualEphemerisProvider {
  getSunPosition(latitude, longitude, datetime, manual) {
    const azimuthDeg = Number(manual.azimuthDeg);
    const elevationDeg = Number(manual.elevationDeg);
    if (!Number.isFinite(azimuthDeg) || azimuthDeg < 0 || azimuthDeg > 360
      || !Number.isFinite(elevationDeg) || elevationDeg < -10 || elevationDeg > 90) {
      throw new Error('Manual Sun azimuth must be 0–360° and elevation −10–90°.');
    }
    return { azimuthDeg, elevationDeg, source: 'manual', datetimeUsed: false };
  }

  getEarthPosition(latitude, longitude, datetime) {
    // No invented Earth position, ephemeris, or visibility result.
    throw new Error('Earth ephemeris is not implemented. Connect a verified SPICE provider and terrain line-of-sight solver.');
  }
}

export function getSunPosition(latitude, longitude, datetime, manualValues, provider = new ManualEphemerisProvider()) {
  return provider.getSunPosition(latitude, longitude, datetime, manualValues);
}

export function getEarthPosition(latitude, longitude, datetime, provider = new ManualEphemerisProvider()) {
  return provider.getEarthPosition(latitude, longitude, datetime);
}
