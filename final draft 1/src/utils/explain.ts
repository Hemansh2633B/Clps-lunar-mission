/**
 * Plain-language explanations shown ALONGSIDE the technical values. They restate what a
 * number means without overstating certainty (geometric visibility ≠ RF link; battery
 * energy-balance ≠ thermal survival). Used by the telemetry rail and the Field Guide.
 */
import type { MissionSummary, VisibilityState } from '../types/mission';

export function explainClearance(body: 'Sun' | 'Earth', v: VisibilityState): string {
  const mag = Math.abs(v.clearanceDeg).toFixed(2);
  if (v.visible) {
    return `${body} is about ${mag}° above the local terrain horizon in this direction, so it is geometrically clear${body === 'Earth' ? ' for direct line-of-sight (not a guarantee of a radio link)' : ' and can illuminate the array'}.`;
  }
  if (v.reason === 'terrain') {
    return `${body} is above the flat horizon but a hill blocks it: it sits about ${mag}° below the terrain skyline here. ${body === 'Earth' ? 'Direct geometric line-of-sight is blocked.' : 'The array is in terrain shadow.'}`;
  }
  return `${body} is about ${mag}° below the horizon, so it is not visible right now.`;
}

export function explainIllumination(pct: number): string {
  return `The Sun is geometrically visible above the modeled terrain horizon for approximately ${pct.toFixed(0)}% of the selected mission interval.`;
}

export function explainEarthLos(pct: number, neverVisible: boolean): string {
  if (neverVisible) return 'Earth never clears the local terrain horizon in this window — the site needs a relay orbiter to communicate. This is geometric line-of-sight, not an RF link budget.';
  return `Earth clears the terrain for approximately ${pct.toFixed(0)}% of the window, so direct geometric line-of-sight is available then. This is not an RF link budget.`;
}

export function explainVerdict(summary: MissionSummary): string {
  switch (summary.verdict) {
    case 'ENERGY DEFICIT':
      return 'The modeled battery energy reaches zero under the current power-generation and load assumptions. More array area, a lower load, or a different window would help. This is an energy-balance result, not thermal survival.';
    case 'RELAY REQUIRED':
      return 'Earth never rises above the terrain here, so the lander cannot talk to Earth directly and would need a relay satellite.';
    case 'NOMINAL':
      return 'For most of the window the lander can both make solar power and see Earth, with a positive modeled energy margin.';
    case 'CONDITIONAL':
      return 'The window is workable with stored-energy management and scheduled Earth-visibility passes; review the longest combined gap.';
    default:
      return 'Less than half of the window has simultaneous solar power and geometric Earth line-of-sight; this window is challenging.';
  }
}
