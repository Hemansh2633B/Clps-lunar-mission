// The guided six-step mission-planning workflow. Pure definitions + navigation so the
// ordering and bounds are unit-testable independently of the React component.

export const WORKFLOW_STEPS = [
  {
    id: 'region',
    title: 'Select a region',
    action: 'Browse regions',
    description: 'Choose a lunar south-pole landing region from the catalogue. Each entry shows its position, program, data confidence and terrain source.',
  },
  {
    id: 'date',
    title: 'Set the UTC start date',
    action: 'Set date',
    description: 'Pick the mission start in UTC — never your local timezone — plus duration and launch delay. All ephemeris and exports use UTC.',
  },
  {
    id: 'preset',
    title: 'Choose a mission preset',
    action: 'Choose preset',
    description: 'Pick an illustrative power and battery profile, or tune your own. Presets are transparent teaching assumptions, not NASA vehicle specifications.',
  },
  {
    id: 'results',
    title: 'Read the plain-language results',
    action: 'View results',
    description: 'See when the Sun and Earth are visible, how much solar power you make, and whether the battery survives — explained in plain language beside the numbers.',
  },
  {
    id: 'compare',
    title: 'Compare scenarios',
    action: 'Pin & compare',
    description: 'Pin this scenario and add others to compare sites, dates and presets side by side. Incompatible data is flagged, never ranked together silently.',
  },
  {
    id: 'report',
    title: 'Export your report',
    action: 'Export report',
    description: 'Download a reproducible JSON report with full provenance, sampling disclosure and analysis status. Blocked analyses cannot be exported.',
  },
] as const;

export type WorkflowStepId = (typeof WORKFLOW_STEPS)[number]['id'];
export const WORKFLOW_STEP_COUNT = WORKFLOW_STEPS.length;

export function clampWorkflowStep(i: number): number {
  if (!Number.isFinite(i)) return 0;
  return Math.max(0, Math.min(WORKFLOW_STEP_COUNT - 1, Math.floor(i)));
}
export function isLastWorkflowStep(i: number): boolean {
  return clampWorkflowStep(i) === WORKFLOW_STEP_COUNT - 1;
}
export function isFirstWorkflowStep(i: number): boolean {
  return clampWorkflowStep(i) === 0;
}
