/**
 * Computation-boundary scientific validation. This is enforced INSIDE the engine
 * (simulateMission), independent of any UI import gate, so a terrain profile that
 * reached the engine through a bypassed path still cannot produce ordinary
 * quantitative mission conclusions. The result is a discriminated AnalysisAssessment.
 */
import type { AnalysisAssessment, LandingSite } from '../types/mission';
import type { IntegrationDiagnostics } from './integration';
import { frameIntervalValidated, FRAME_VALIDATED_RANGE_LABEL } from './lunarFrame';

/**
 * Assess the static (pre-computation) scientific eligibility of a site + interval.
 * Order matters: synthetic and illustrative terrain are allowed as labeled demos;
 * a real DEM must pass frame verification, complete coverage, and the frame-model
 * epoch range before it is quantitatively eligible.
 */
export function assessTerrainEligibility(site: LandingSite, startMs: number, endMs: number): AnalysisAssessment {
  const t = site.terrain;

  if (t.synthetic) {
    return {
      status: 'SYNTHETIC_DEMO', quantitativeEligible: false, demoEligible: true, dataConfidence: 'synthetic',
      note: 'Procedural synthetic terrain for interface exploration. Calculated demonstration only — never a measured scientific result.',
    };
  }

  if (t.kind !== 'dem') {
    const conf = site.dataConfidence === 'region-approximate' ? 'region-approximate' : 'illustrative';
    return {
      status: 'ILLUSTRATIVE', quantitativeEligible: false, demoEligible: true, dataConfidence: conf,
      note: conf === 'region-approximate'
        ? 'Approximate candidate-region center with illustrative relief. Indicative demonstration, not a surveyed landing point or measured terrain.'
        : 'Illustrative / user-edited horizon, not a measured flight DEM. Indicative demonstration only.',
    };
  }

  // Real DEM below: enforce frame, coverage and epoch at the computation boundary.
  if (!t.frameVerified) {
    return {
      status: 'FRAME_UNVERIFIED', quantitativeEligible: false, demoEligible: false,
      reason: `The DEM reference frame "${t.sourceFrame ?? 'unspecified'}" is not on the validated allowlist, so its alignment with the IAU 2015 ephemeris frame cannot be verified. Quantitative mission visibility is blocked.`,
      resolution: 'Confirm the DEM is MOON_ME / MOON_PA (DE421) or IAU 2015 Moon and re-import it, or view it in Terrain Lab without quantitative use.',
    };
  }
  if ((t.coveragePercent ?? 100) < 100 || t.elevations.some((h) => h <= -89.9)) {
    return {
      status: 'INCOMPLETE_COVERAGE', quantitativeEligible: false, demoEligible: false,
      reason: `The DEM horizon has incomplete ray coverage (${(t.coveragePercent ?? 0).toFixed(1)}%) or NoData rays. A complete horizon is required for quantitative visibility.`,
      resolution: 'Download a wider / fully covered DEM crop, or choose a location with complete coverage, then re-import.',
    };
  }
  if ((t.frameTransform === 'me' || t.frameTransform === 'pa') && !frameIntervalValidated(startMs, endMs)) {
    return {
      status: 'FRAME_MODEL_OUTSIDE_VALIDATED_RANGE', quantitativeEligible: false, demoEligible: false,
      reason: `The constant ${t.frameTransform.toUpperCase()}→IAU frame correction is only SPICE-validated over ${FRAME_VALIDATED_RANGE_LABEL}. This mission interval lies outside that range, so the correction must not be extrapolated.`,
      resolution: `Choose a mission interval within ${FRAME_VALIDATED_RANGE_LABEL}, or supply a DEM already in the IAU 2015 frame.`,
    };
  }

  return { status: 'VALID', quantitativeEligible: true, demoEligible: true, dataConfidence: 'measured' };
}

/** Post-computation numerical-resolution gate (transition detector could not fully resolve). */
export function numericalResolutionBlocked(unresolvedCount: number): AnalysisAssessment {
  return {
    status: 'NUMERICAL_RESOLUTION_INSUFFICIENT', quantitativeEligible: false, demoEligible: false,
    reason: `The adaptive transition detector could not fully resolve ${unresolvedCount} interval(s) even after the fine-scan fallback. Visibility/energy results would be incomplete.`,
    resolution: 'Shorten the mission window or use a finer sample step so every interval resolves, then re-run.',
  };
}

export function computationFailed(message: string): AnalysisAssessment {
  return {
    status: 'COMPUTATION_FAILED', quantitativeEligible: false, demoEligible: false,
    reason: `The mission computation failed: ${message}`,
    resolution: 'Check the mission dates and parameters, then retry. If it persists, reload the application.',
  };
}

/**
 * Non-blocking numerical-quality disclosure (v1.11). A coarse energy integral
 * remains exportable for research, but every consumer must show this warning.
 * It does not change terrain eligibility or data confidence, and the Richardson
 * estimate is not a statistical confidence interval or a thermal-survival model.
 */

export const ENERGY_RESOLUTION_COARSE = 'ENERGY_RESOLUTION_COARSE';

export function energyResolutionDisclosure(diagnostics: IntegrationDiagnostics | null | undefined): { code: typeof ENERGY_RESOLUTION_COARSE; message: string } | null {
  if (diagnostics?.resolutionStatus !== 'coarse') return null;
  const pct = (diagnostics.relativeEnergyError * 100).toFixed(2);
  const kwh = diagnostics.estimatedEnergyErrorKWh.toFixed(4);
  return {
    code: ENERGY_RESOLUTION_COARSE,
    message: `${ENERGY_RESOLUTION_COARSE}: estimated relative integration error is at least 1% (${pct}% here; Richardson estimate ${kwh} kWh, not a confidence interval). Energy totals, battery SOC and deficit hours may shift at this resolution. Treat the energy verdict as uncertain; compare shorter windows or alternative configurations and inspect the quadrature diagnostics. Export remains available with this warning. This does not model thermal/radiation survival.`,
  };
}
