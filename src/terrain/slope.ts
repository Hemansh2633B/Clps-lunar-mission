/**
 * Local surface slope and aspect from a terrain grid.
 *
 * The backend returns a square grid in a site-centred azimuthal-equidistant
 * projection with a single metric spacing, ordered "row-major; rows
 * north-to-south, columns west-to-east". Slope is computed with Horn's 3×3
 * kernel at the landing point (grid centre) — the standard GIS estimator, and
 * the same one used to judge lander tilt.
 *
 * Units: elevations metres, spacing metres, slope degrees, aspect degrees
 * clockwise from north (downslope direction). NoData cells are never treated as
 * zero: a 3×3 window containing one is refused, and the nearest fully valid
 * window within a small search radius is used instead (reported), otherwise the
 * result is null and the caller must show "slope unavailable".
 */
import type { TerrainData } from './types';
import type { SlopeSpec } from '../engine/incidence';
import { wrap360 } from '../engine/constants';

export interface TerrainSlope extends SlopeSpec {
  /** Downslope azimuth, degrees clockwise from north. */
  aspectDeg: number;
  /** Grid spacing used for the gradient, metres. */
  spacingM: number;
  /** Gradient magnitude (dimensionless rise/run). */
  gradient: number;
  /** ASCII-grid-like Horn estimator. */
  method: 'horn-3x3';
  /** True when the centre 3×3 window had NoData and a nearby valid window was used. */
  offsetFromCentre: boolean;
  /** Cell offset (row, column) from the grid centre for the window actually used. */
  offsetCells: [number, number];
  /** Mean and maximum slope over all fully valid 3×3 windows, degrees (landscape context). */
  meanSlopeDeg: number;
  maxSlopeDeg: number;
  /** Fraction of the grid covered by fully valid 3×3 slope windows, %. */
  slopeCoveragePct: number;
}

const RAD = 180 / Math.PI;

function cellAt(data: TerrainData, row: number, col: number): number | null {
  const n = data.grid.size;
  if (row < 0 || col < 0 || row >= n || col >= n) return null;
  const v = data.grid.elevations_m[row * n + col];
  return v == null || !Number.isFinite(v) ? null : v;
}

interface Kernel { gx: number; gy: number }

/** Horn's derivative at (row, col); null when any neighbour is NoData. */
function hornAt(data: TerrainData, row: number, col: number, spacingM: number): Kernel | null {
  const z = (dr: number, dc: number) => cellAt(data, row + dr, col + dc);
  const nw = z(-1, -1), n0 = z(-1, 0), ne = z(-1, 1);
  const w0 = z(0, -1), e0 = z(0, 1);
  const sw = z(1, -1), s0 = z(1, 0), se = z(1, 1);
  if ([nw, n0, ne, w0, e0, sw, s0, se].some((v) => v === null)) return null;
  const gx = ((ne as number) + 2 * (e0 as number) + (se as number) - ((nw as number) + 2 * (w0 as number) + (sw as number))) / (8 * spacingM);
  // Rows run north → south, so the north derivative is (north − south) / 8Δ.
  const gy = ((nw as number) + 2 * (n0 as number) + (ne as number) - ((sw as number) + 2 * (s0 as number) + (se as number))) / (8 * spacingM);
  return { gx, gy };
}

/** Slope and aspect at one cell from a Horn kernel. */
export function slopeFromKernel(k: Kernel): { slopeDeg: number; aspectDeg: number; gradient: number } {
  const gradient = Math.hypot(k.gx, k.gy);
  const slopeDeg = Math.atan(gradient) * RAD;
  // Downslope is the negative gradient; azimuth clockwise from north.
  const aspectDeg = wrap360(Math.atan2(-k.gx, -k.gy) * RAD);
  return { slopeDeg, aspectDeg, gradient };
}

/**
 * Slope/aspect at the landing point (grid centre), with a bounded search for a
 * fully valid window. Returns null when no window is valid: slope is never
 * invented.
 */
export function slopeAtLandingPoint(data: TerrainData): TerrainSlope | null {
  const n = data.grid.size;
  const spacingM = data.grid.spacing_m;
  if (!(n >= 3) || !(spacingM > 0)) return null;
  const centre = Math.floor((n - 1) / 2);
  let chosen: { k: Kernel; row: number; col: number } | null = null;
  const maxOffset = Math.min(4, Math.floor((n - 3) / 2));
  for (let r = 1; r <= maxOffset && !chosen; r++) {
    for (let dr = -r; dr <= r && !chosen; dr++) {
      for (let dc = -r; dc <= r && !chosen; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== r) continue;
        const k = hornAt(data, centre + dr, centre + dc, spacingM);
        if (k) chosen = { k, row: centre + dr, col: centre + dc };
      }
    }
  }
  if (!chosen) return null;
  const local = slopeFromKernel(chosen.k);

  // Landscape context: every fully valid window (one pass, O(n²)).
  let sum = 0, max = 0, valid = 0, windows = 0;
  for (let row = 1; row < n - 1; row++) {
    for (let col = 1; col < n - 1; col++) {
      windows++;
      const k = hornAt(data, row, col, spacingM);
      if (!k) continue;
      valid++;
      const s = Math.atan(Math.hypot(k.gx, k.gy)) * RAD;
      sum += s;
      if (s > max) max = s;
    }
  }
  return {
    slopeDeg: local.slopeDeg,
    aspectDeg: local.aspectDeg,
    source: data.synthetic ? 'custom' : 'dem',
    gradient: local.gradient,
    spacingM,
    method: 'horn-3x3',
    offsetFromCentre: chosen.row !== centre || chosen.col !== centre,
    offsetCells: [chosen.row - centre, chosen.col - centre],
    meanSlopeDeg: valid > 0 ? sum / valid : 0,
    maxSlopeDeg: max,
    slopeCoveragePct: windows > 0 ? (valid / windows) * 100 : 0,
  };
}

/** Slope spec for the mission engine, or null when the grid cannot supply one. */
export function missionSlope(data: TerrainData): SlopeSpec | null {
  const s = slopeAtLandingPoint(data);
  if (!s) return null;
  return { slopeDeg: s.slopeDeg, aspectDeg: s.aspectDeg, source: s.source };
}
