import {
  ME_TO_IAU, PA_TO_IAU, ME_IAU_MAX_RESIDUAL_DEG, PA_IAU_MAX_RESIDUAL_DEG,
  ME_IAU_MEAN_ANGLE_DEG, PA_IAU_MEAN_ANGLE_DEG, FRAME_REFERENCE_EPOCH,
} from './lunarFrameData';

/**
 * Lunar reference-frame compatibility between DEM source frames and the mission
 * ephemeris frame.
 *
 * The ephemeris (`ephemeris.ts`) uses the IAU 2015 Moon rotation. NASA LOLA
 * south-polar DEMs are MOON_ME (DE421). These are distinct body-fixed realizations.
 * SPICE verification (backend/lunar_frame.py, scripts/generate-frame-constants.py)
 * shows the IAU 2015 frame is close to MOON_ME (mean offset ~0.0017 deg) and that a
 * constant rotation removes the mean bias with a verified residual <= 0.0039 deg
 * over 2020-2035. That residual is disclosed as a frame-model uncertainty.
 *
 * Frames are NEVER combined silently: an unrecognized frame is classified
 * unverified and blocked from quantitative mission-visibility use.
 */

export const EPHEMERIS_FRAME = 'IAU 2015 Moon (astronomy-engine RotationAxis)';
export const FRAME_REFERENCE = FRAME_REFERENCE_EPOCH;

export type FrameTransform = 'me' | 'pa' | 'iau';

export interface FrameClassification {
  recognized: boolean;
  transform: FrameTransform | null;
  note: string;
  /** Normalized allowlisted identifier that matched (null when unrecognized). */
  identifier?: string | null;
  /** Ephemeris / report realization the identifier is validated against. */
  realization?: string | null;
}

/**
 * Explicit supported-frame allowlist (normalized: uppercase, alphanumeric only).
 *
 * A frame is accepted ONLY when its leading identifier exactly matches one of these
 * validated realizations — never because the text merely *contains* "IAU", "MOONME"
 * or "MOONPA". This rejects unfamiliar realizations such as MOON_ME_DE440 (a different
 * ephemeris) or NOT_MOON_ME / WEIRD_IAU_FRAME (substring traps) until their
 * transformations have been independently validated. Bare MOON_ME / MOON_PA are
 * interpreted as the standard DE421 realization (the one SPICE-verified here); any
 * explicitly different ephemeris is rejected.
 */
const ME_ALLOW = new Set(['MOONME', 'MOONMEDE421', 'MOONMEJPLDE421', 'ME', 'MEDE421']);
const PA_ALLOW = new Set(['MOONPA', 'MOONPADE421', 'MOONPAJPLDE421', 'PA', 'PADE421']);
const IAU_ALLOW = new Set(['IAUMOON', 'IAU2015MOON', 'IAUMOON2015', 'IAU2015']);

/** Strip a trailing free-text description, keeping the frame identifier + ephemeris qualifier.
 * Real product strings look like "MOON_ME (DE421) — third-party downsample; …"; the frame
 * identifier uses underscores, so em-dash / semicolon / comma / spaced-hyphen separators
 * safely delimit the descriptive tail without touching the identifier itself. */
function frameHead(frame: string): string {
  return frame.split(/\s*[—;,]\s*|\s+-{1,2}\s+/)[0].trim();
}

function normalize(frame?: string): string {
  if (!frame) return '';
  return frameHead(frame).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Classify a declared lunar body-fixed frame against the explicit allowlist. The
 * identifier (with any parenthetical ephemeris qualifier) is extracted from the head
 * of the string, normalized, and matched EXACTLY. Unknown frames / realizations are
 * left UNVERIFIED and blocked from quantitative mission visibility.
 */
export function classifyFrame(frame?: string): FrameClassification {
  const n = normalize(frame);
  if (ME_ALLOW.has(n)) {
    return { recognized: true, transform: 'me', identifier: n, realization: 'DE421', note: 'MOON_ME (DE421): compatible with the IAU 2015 ephemeris frame after a verified constant correction (residual ≤0.0039°, validated 2020–2035).' };
  }
  if (PA_ALLOW.has(n)) {
    return { recognized: true, transform: 'pa', identifier: n, realization: 'DE421', note: 'MOON_PA (DE421): converted to the IAU 2015 ephemeris frame via the fixed 0.0288° PA→ME rotation plus a verified residual ≤0.0039° (validated 2020–2035).' };
  }
  if (IAU_ALLOW.has(n)) {
    return { recognized: true, transform: 'iau', identifier: n, realization: 'IAU 2015', note: 'Declared IAU Moon frame: no rotation applied. Confirm the report version matches IAU 2015.' };
  }
  return { recognized: false, transform: null, identifier: null, realization: null, note: `Unrecognized lunar reference frame "${frame || '(unspecified)'}". It is not on the supported-frame allowlist (validated realizations: MOON_ME/MOON_PA with DE421, IAU 2015 Moon). Compatibility with the IAU 2015 ephemeris frame cannot be verified; blocked from quantitative mission visibility (viewable in Terrain Lab only).` };
}

/**
 * The constant ME/PA→IAU corrections are SPICE-validated over 2020-01 … 2035-12.
 * Outside that interval the residual is NOT validated and must never be extrapolated
 * silently. Quantitative use of a frame-corrected DEM outside this range is blocked.
 */
export const FRAME_VALIDATED_START_MS = Date.parse('2020-01-01T00:00:00Z');
export const FRAME_VALIDATED_END_MS = Date.parse('2035-12-31T23:59:59Z');
export const FRAME_VALIDATED_RANGE_LABEL = '2020-01-01 … 2035-12-31 (UTC)';

export function frameEpochInRange(timeMs: number): boolean {
  return Number.isFinite(timeMs) && timeMs >= FRAME_VALIDATED_START_MS && timeMs <= FRAME_VALIDATED_END_MS;
}

/** Whether a whole mission interval lies inside the validated frame-correction range. */
export function frameIntervalValidated(startMs: number, endMs: number): boolean {
  return frameEpochInRange(startMs) && frameEpochInRange(endMs);
}

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function rotationFor(transform: FrameTransform | null): readonly number[] | null {
  if (transform === 'me') return ME_TO_IAU;
  if (transform === 'pa') return PA_TO_IAU;
  if (transform === 'iau') return IDENTITY;
  return null;
}

/** Disclosed frame-model residual (degrees) for a recognized transform. */
export function frameResidualDeg(transform: FrameTransform | null): number {
  if (transform === 'me') return ME_IAU_MAX_RESIDUAL_DEG;
  if (transform === 'pa') return PA_IAU_MAX_RESIDUAL_DEG;
  return 0;
}

export function frameMeanAngleDeg(transform: FrameTransform | null): number {
  if (transform === 'me') return ME_IAU_MEAN_ANGLE_DEG;
  if (transform === 'pa') return PA_IAU_MEAN_ANGLE_DEG;
  return 0;
}

function applyR(R: readonly number[], v: [number, number, number]): [number, number, number] {
  return [
    R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
    R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
    R[6] * v[0] + R[7] * v[1] + R[8] * v[2],
  ];
}
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const unit = (a: number[]): [number, number, number] => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export interface ConvertedSite {
  latitude: number;
  longitude: number;
  azimuthOffsetDeg: number;
}

/**
 * Rotate a body-fixed site (lat/lon, east-positive) and its local north into the
 * ephemeris IAU frame. `azimuthOffsetDeg` is added to source-frame azimuths so the
 * terrain mask aligns with IAU-frame azimuths measured from local north.
 */
export function convertSite(latitude: number, longitude: number, transform: FrameTransform | null): ConvertedSite {
  const R = rotationFor(transform);
  if (!R) return { latitude, longitude, azimuthOffsetDeg: 0 };
  const lat = (latitude * Math.PI) / 180;
  const lon = (longitude * Math.PI) / 180;
  const cl = Math.cos(lat), sl = Math.sin(lat), co = Math.cos(lon), so = Math.sin(lon);
  const up: [number, number, number] = [cl * co, cl * so, sl];
  const north: [number, number, number] = [-sl * co, -sl * so, cl];
  const up2 = unit(applyR(R, up));
  const north2 = applyR(R, north);
  const lat2 = (Math.asin(Math.max(-1, Math.min(1, up2[2]))) * 180) / Math.PI;
  const lon2 = (Math.atan2(up2[1], up2[0]) * 180) / Math.PI;
  // Project rotated source-north onto the tangent plane at the new point.
  const d = dot(north2, up2);
  const northProj = unit([north2[0] - up2[0] * d, north2[1] - up2[1] * d, north2[2] - up2[2] * d]);
  const lat2r = (lat2 * Math.PI) / 180, lon2r = (lon2 * Math.PI) / 180;
  const northIau = [-Math.sin(lat2r) * Math.cos(lon2r), -Math.sin(lat2r) * Math.sin(lon2r), Math.cos(lat2r)];
  const eastIau = [-Math.sin(lon2r), Math.cos(lon2r), 0];
  const azOffset = (Math.atan2(dot(northProj, eastIau), dot(northProj, northIau)) * 180) / Math.PI;
  return { latitude: lat2, longitude: lon2, azimuthOffsetDeg: azOffset };
}

/** Rotate a whole azimuthal horizon mask (deg elevations sampled every resolutionDeg). */
export function rotateMaskAzimuths(elevations: number[], resolutionDeg: number, azimuthOffsetDeg: number): number[] {
  if (Math.abs(azimuthOffsetDeg) < 1e-9 || elevations.length === 0) return elevations;
  const n = elevations.length;
  const shiftBins = azimuthOffsetDeg / resolutionDeg;
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    // Source azimuth a maps to IAU azimuth a + offset; invert to sample source.
    const src = ((i - shiftBins) % n + n) % n;
    const i0 = Math.floor(src) % n;
    const i1 = (i0 + 1) % n;
    const f = src - Math.floor(src);
    out[i] = elevations[i0] * (1 - f) + elevations[i1] * f;
  }
  return out;
}

export { ME_IAU_MAX_RESIDUAL_DEG, PA_IAU_MAX_RESIDUAL_DEG };
