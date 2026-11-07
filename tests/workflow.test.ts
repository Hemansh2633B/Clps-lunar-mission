import { describe, it, expect } from 'vitest';
import { WORKFLOW_STEPS, WORKFLOW_STEP_COUNT, clampWorkflowStep, isFirstWorkflowStep, isLastWorkflowStep } from '../src/utils/workflow';

describe('guided six-step workflow', () => {
  it('has the six required steps in the required order', () => {
    expect(WORKFLOW_STEPS.map((s) => s.id)).toEqual(['region', 'date', 'preset', 'results', 'compare', 'report']);
    expect(WORKFLOW_STEP_COUNT).toBe(6);
  });

  it('gives every step a title, action and description', () => {
    for (const s of WORKFLOW_STEPS) {
      expect(s.title.length, s.id).toBeGreaterThan(0);
      expect(s.action.length, s.id).toBeGreaterThan(0);
      expect(s.description.length, s.id).toBeGreaterThan(0);
    }
  });

  it('keeps the UTC and preset steps explicit about their assumptions', () => {
    const date = WORKFLOW_STEPS.find((s) => s.id === 'date')!;
    expect(date.description.toLowerCase()).toContain('utc');
    const preset = WORKFLOW_STEPS.find((s) => s.id === 'preset')!;
    expect(preset.description.toLowerCase()).toContain('not nasa');
  });

  it('clamps navigation to valid bounds', () => {
    expect(clampWorkflowStep(-5)).toBe(0);
    expect(clampWorkflowStep(99)).toBe(5);
    expect(clampWorkflowStep(2.9)).toBe(2);
    expect(clampWorkflowStep(NaN)).toBe(0);
  });

  it('identifies the first and last steps', () => {
    expect(isFirstWorkflowStep(0)).toBe(true);
    expect(isFirstWorkflowStep(1)).toBe(false);
    expect(isLastWorkflowStep(5)).toBe(true);
    expect(isLastWorkflowStep(4)).toBe(false);
  });
});
