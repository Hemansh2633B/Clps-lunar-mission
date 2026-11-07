/**
 * Accessibility descriptions that respect the scientific gates.
 *
 * Screen-reader text must never be MORE certain than the visual instruments:
 * when terrain visibility is blocked (unverified frame, incomplete coverage,
 * out-of-range epoch), descriptions report sky POSITIONS only — never visibility
 * states, never clearance values. Pure functions so the wording is unit-tested.
 */
import type { AnalysisAssessment, EvaluatedSample, LandingSite, MissionSummary } from '../types/mission';

/** role="img" description for the horizon panorama. */
export function panoramaDescription(current: EvaluatedSample, blocked: boolean): string {
  const sunPos = `Sun sky position: ${current.sun.azimuthDeg.toFixed(0)} degrees azimuth, ${current.sun.elevationDeg.toFixed(1)} degrees elevation.`;
  const earthPos = `Earth sky position: ${current.earth.azimuthDeg.toFixed(0)} degrees azimuth, ${current.earth.elevationDeg.toFixed(1)} degrees elevation.`;
  if (blocked) {
    return `Local horizon panorama. Terrain visibility is BLOCKED at this epoch — no Sun or Earth visibility or clearance is claimed against this mask. ${sunPos} ${earthPos} Sky positions come from the ephemeris and remain valid. A numeric horizon table is available from the site brief.`;
  }
  return `Local horizon panorama. Sun at ${current.sun.azimuthDeg.toFixed(0)} degrees azimuth and ${current.sun.elevationDeg.toFixed(1)} degrees elevation, ${current.sunVisibility.visible ? 'visible' : 'below the horizon or terrain-occulted'}. Earth at ${current.earth.azimuthDeg.toFixed(0)} degrees azimuth and ${current.earth.elevationDeg.toFixed(1)} degrees elevation, ${current.earthVisibility.visible ? 'visible, direct-to-Earth open' : 'not visible'}. A numeric horizon table is available from the site brief.`;
}

export interface DemFooterStatus {
  tone: 'ok' | 'warn' | 'blocked' | 'dim';
  text: string;
}

/**
 * Status-aware DEM provenance footer. Mirrors AnalysisAssessment exactly — when
 * the assessment is blocked its own reason/resolution is quoted, so the footer
 * can never contradict the telemetry notice. Verified frames say verified (with
 * the constant-rotation residual disclosed); epochs outside the validated range
 * are named; coverage is always stated for DEM horizons.
 */
export function demFooterStatus(site: LandingSite, analysis: AnalysisAssessment | null, instantBlocked: boolean): DemFooterStatus {
  const t = site.terrain;
  if (t.kind === 'dem') {
    if (t.synthetic) {
      return { tone: 'warn', text: 'Synthetic demo horizon from Terrain Lab — NOT real lunar data. Labeled as a demo wherever it appears; never a scientific result.' };
    }
    const frame = t.sourceFrame ?? 'unspecified';
    const coverage = `Coverage ${t.coveragePercent?.toFixed(1) ?? 'unknown'}%`;
    if (analysis && !analysis.demoEligible) {
      return { tone: 'blocked', text: `${analysis.status}: ${analysis.reason} ${analysis.resolution}` };
    }
    if (instantBlocked) {
      return { tone: 'blocked', text: `Frame ${frame} is allowlisted, but the constant frame correction is NOT validated at the current epoch — instantaneous terrain visibility is blocked here. ${coverage}. Scrub into the validated 2020–2035 range.` };
    }
    if (t.frameVerified) {
      const residual = t.frameResidualDeg != null ? ` Residual ≤ ${t.frameResidualDeg.toFixed(4)}° disclosed.` : '';
      return { tone: 'ok', text: `Frame ${frame} verified against the allowlist; mask rotated to IAU 2015 via a constant ${String(t.frameTransform ?? '?').toUpperCase()} rotation (not time-dependent).${residual} ${coverage}. LOCAL horizon only — obstructions beyond the crop radius are not captured.` };
    }
    return { tone: 'blocked', text: `Frame ${frame} is NOT verified against the allowlist — quantitative mission visibility is blocked until the frame is confirmed compatible with IAU 2015. ${coverage}.` };
  }
  if (t.kind === 'custom') {
    return { tone: 'warn', text: `User-edited 8-sector horizon (±${t.uncertaintyDeg.toFixed(2)}°). ${t.accuracyNote ?? 'Sector values are exact at the eight edited azimuths; not a measured DEM.'}` };
  }
  if (t.sourceFrame) {
    return { tone: 'warn', text: `DEM-derived horizon · source frame ${t.sourceFrame}. Verify frame alignment with the IAU 2015 ephemeris before operational use (±${t.uncertaintyDeg.toFixed(2)}°).` };
  }
  return { tone: 'dim', text: `Terrain mask is LOLA-inspired and illustrative (±${t.uncertaintyDeg.toFixed(2)}°). Coordinates are real; elevations are representative. Not for flight certification.` };
}

/** role="img" description for the mission timeline tracks. */
export function timelineDescription(summary: MissionSummary | null, analysis: AnalysisAssessment | null): string {
  if (analysis && !analysis.demoEligible) {
    return `Mission timeline. The window analysis is BLOCKED (${analysis.status}) — no quantitative sunlight, communications or viability tracks are shown. ${analysis.reason}`;
  }
  if (summary) {
    return `Mission window: ${summary.illuminationPct.toFixed(0)} percent sunlit, ${summary.dtePct.toFixed(0)} percent Earth line-of-sight, ${summary.combinedPct.toFixed(0)} percent both at once. Longest eclipse ${summary.longestEclipseHours.toFixed(1)} hours; longest communications gap ${summary.longestDteGapHours.toFixed(1)} hours. Verdict ${summary.verdict}. Use the time scrubber slider below to move through the window.`;
  }
  return 'Mission timeline with three tracks: sunlight and power, direct-to-Earth communications, and combined mission viability. The window is still computing — no results claimed yet.';
}

/** Canvas-map description addendum when the Earth vector must not imply LOS. */
export function polarMapDescription(siteName: string, latitude: number, longitude: number, blocked: boolean): string {
  const base = `Stereographic map of the lunar south pole. Selected site ${siteName} at ${latitude.toFixed(2)} degrees latitude, ${longitude.toFixed(1)} degrees longitude. Choose a named site from the catalogue, or click the map to drop a custom site.`;
  return blocked
    ? `${base} The Earth direction vector shows sky azimuth only — line-of-sight status is unverified at this epoch.`
    : base;
}
