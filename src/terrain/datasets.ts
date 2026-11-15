/**
 * Pure helpers for the Terrain Lab dataset workflow: which dataset a request
 * should use, how to phrase the eligibility of the model on screen, and byte
 * formatting. Kept free of React so the rules are unit-tested.
 */
import { classifyFrame } from '../engine/lunarFrame';
import type { DatasetEntry, DatasetsResponse, TerrainData } from './types';

export const CONFIGURED_DATASET = 'configured';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

/** The dataset a real-mode request should use: the current choice if it is ready, else the first ready one. */
export function pickDataset(response: DatasetsResponse | null, current: string): DatasetEntry | null {
  const list = response?.datasets ?? [];
  return list.find((d) => d.id === current && d.ready) ?? list.find((d) => d.ready) ?? null;
}

/** `dataset_id` to send, or undefined for the configured DEM (keeps the v1.11 request shape). */
export function datasetParam(id: string | null | undefined): string | undefined {
  return id && id !== CONFIGURED_DATASET ? id : undefined;
}

export interface ModelEligibility {
  level: 'none' | 'demo' | 'eligible' | 'partial' | 'blocked';
  title: string;
  detail: string;
}

/**
 * What the terrain model currently on screen may be used for. This mirrors the
 * gates the mission engine enforces (src/terrain/missionProfile.ts); it only
 * explains them — it never grants eligibility.
 */
export function modelEligibility(data: TerrainData | null): ModelEligibility {
  if (!data) return { level: 'none', title: 'No terrain model', detail: 'Build terrain to see what it can be used for.' };
  if (data.synthetic || data.source.synthetic) {
    return { level: 'demo', title: 'Demonstration only', detail: 'Synthetic or fixture terrain: useful for learning the workflow, never a scientific result.' };
  }
  const frame = classifyFrame(data.source.lunar_reference_frame);
  const coverage = data.statistics.coverage_percent;
  if (!frame.recognized) {
    return {
      level: 'blocked', title: 'View only — frame not validated',
      detail: `The DEM's reference frame (${data.source.lunar_reference_frame || 'not declared'}) is not on the validated list, so a horizon from it is blocked from mission visibility.`,
    };
  }
  if (coverage < 100) {
    return {
      level: 'partial', title: `Partial coverage · ${coverage.toFixed(1)} % of the grid`,
      detail: 'Part of the analysis square has no data. Compute the horizon to see whether every ray is covered: a horizon with incomplete ray coverage is blocked from the mission planner, and no elevation is ever invented.',
    };
  }
  return {
    level: 'eligible', title: 'Candidate for quantitative analysis',
    detail: `Measured DEM, validated frame (${frame.identifier ?? data.source.lunar_reference_frame}), full grid coverage. A horizon computed from it can be sent to the mission planner if every ray is covered; the engine also checks the epoch against the validated frame interval.`,
  };
}

/** TIFF tag 259 codes the native reader can meet, named for people. Unknown codes are shown as codes, never guessed. */
export function tiffCompressionLabel(code: number | string): string {
  const names: Record<string, string> = { 1: 'none', 5: 'LZW', 8: 'Deflate', 32946: 'Deflate (legacy code)', 32773: 'PackBits' };
  return names[String(code)] ?? `TIFF code ${code}`;
}

/** TIFF tag 317 (predictor) codes. */
export function tiffPredictorLabel(code: number | string): string {
  const names: Record<string, string> = { 1: 'none', 2: 'horizontal differencing', 3: 'floating-point' };
  return names[String(code)] ?? `TIFF code ${code}`;
}
