/**
 * South-polar stereographic map geometry (Moon 2000 sphere, R = 1,737,400 m,
 * true scale at the pole, central meridian 0°):
 *
 *   X = ρ·sin λ   (toward 90°E)        ρ = 2R·tan(colatitude / 2)
 *   Y = ρ·cos λ   (toward 0°)
 *
 * On screen +X is right and +Y is UP, so the 0° meridian points up and 90°E
 * points right. This is the orientation of the bundled LROC WAC basemap
 * (verified against permanently-shadowed crater floors — see
 * backend/catalog/orientation_test.go) and of NASA Moon Trek south-polar tiles
 * and the IAU2000:30120 WMS projection, so one transform registers all of them.
 *
 * v1.11 and earlier drew the 0° meridian DOWN, which mirrored markers, the
 * lighting overlay and the Earth vector north–south against the imagery.
 */
export const MOON_RADIUS_M = 1_737_400;
const DEG = Math.PI / 180;

export interface XY { x: number; y: number; }
export interface LatLon { lat: number; lon: number; }

export function rhoForColatitude(colatDeg: number): number {
  return 2 * MOON_RADIUS_M * Math.tan((colatDeg / 2) * DEG);
}

/** Selenographic (lat °, east lon °) → projected metres. */
export function forward(lat: number, lon: number): XY {
  const rho = rhoForColatitude(90 + lat);
  return { x: rho * Math.sin(lon * DEG), y: rho * Math.cos(lon * DEG) };
}

/** Projected metres → selenographic (lat °, east lon ° in [0, 360)). */
export function inverse(x: number, y: number): LatLon {
  const rho = Math.hypot(x, y);
  const colat = (2 * Math.atan(rho / (2 * MOON_RADIUS_M))) / DEG;
  const lon = rho === 0 ? 0 : Math.atan2(x, y) / DEG;
  return { lat: colat - 90, lon: ((lon % 360) + 360) % 360 };
}

/** A circular viewport: `halfWidthM` metres map to `radiusPx` pixels around the centre. */
export interface PolarView {
  centerX: number;
  centerY: number;
  halfWidthM: number;
  sizePx: number;
  radiusPx: number;
}

export const ZOOM_EXTENTS_DEG = [10, 5, 2.5, 1.25, 0.625] as const;

/** View showing `extentDeg` of colatitude from the centre to the rim. */
export function viewFor(extentDeg: number, sizePx: number, radiusPx: number, center?: LatLon | null): PolarView {
  const c = center ? forward(center.lat, center.lon) : { x: 0, y: 0 };
  return { centerX: c.x, centerY: c.y, halfWidthM: rhoForColatitude(extentDeg), sizePx, radiusPx };
}

export function metresPerPixel(view: PolarView): number {
  return view.halfWidthM / view.radiusPx;
}

export function worldToScreen(view: PolarView, x: number, y: number): XY {
  const c = view.sizePx / 2;
  const k = view.radiusPx / view.halfWidthM;
  return { x: c + (x - view.centerX) * k, y: c - (y - view.centerY) * k };
}

export function screenToWorld(view: PolarView, sx: number, sy: number): XY {
  const c = view.sizePx / 2;
  const k = view.halfWidthM / view.radiusPx;
  return { x: view.centerX + (sx - c) * k, y: view.centerY - (sy - c) * k };
}

/** Screen position of a site, or null when it falls outside the circular viewport. */
export function project(view: PolarView, lat: number, lon: number, marginPx = 0): XY | null {
  const w = forward(lat, lon);
  const p = worldToScreen(view, w.x, w.y);
  const c = view.sizePx / 2;
  return Math.hypot(p.x - c, p.y - c) <= view.radiusPx + marginPx ? p : null;
}

/** Selenographic position under a screen pixel, or null outside the viewport. */
export function unproject(view: PolarView, sx: number, sy: number): LatLon | null {
  const c = view.sizePx / 2;
  if (Math.hypot(sx - c, sy - c) > view.radiusPx) return null;
  const w = screenToWorld(view, sx, sy);
  return inverse(w.x, w.y);
}

/**
 * Screen unit vector for a local azimuth (° clockwise from local north) at a
 * site of east longitude `lon`. The projection is conformal and its meridians
 * are straight radial lines, so local north is "radially away from the pole"
 * and angles are preserved exactly: map direction = (sin(λ+az), cos(λ+az)) in
 * (X right, Y up), i.e. dy is negated for screen coordinates.
 */
export function azimuthToScreen(lon: number, azimuthDeg: number): XY {
  const a = (lon + azimuthDeg) * DEG;
  return { x: Math.sin(a), y: -Math.cos(a) };
}

// ------------------------------------------------------------------ remote layers

export interface WmtsLayer {
  type: 'wmts';
  url_template: string;
  style: string;
  matrix_set: string;
  format: string;
  tile_size: number;
  top_left: [number, number];
  scale_denominator_0: number;
  min_level: number;
  max_level: number;
  bbox: [number, number, number, number];
}

export interface WmsLayer {
  type: 'wms';
  endpoint: string;
  version: string;
  layers: string;
  srs: string;
  format: string;
  max_size: number;
}

export interface BundledLayer { type: 'bundled'; url: string; half_extent_deg: number; }
export type MapLayerSpec = WmtsLayer | WmsLayer | BundledLayer;

export interface TilePlacement {
  key: string;
  url: string;
  level: number;
  row: number;
  col: number;
  /** Screen rectangle in view pixels. */
  left: number;
  top: number;
  size: number;
}

/** OGC "standardized rendering pixel size": 0.28 mm. */
const PIXEL_M = 0.00028;

/** Ground width of one tile at `level`. Level 0 is a single tile (Trek default028mm polar sets). */
export function wmtsTileSpan(layer: WmtsLayer, level: number): number {
  return (layer.scale_denominator_0 * PIXEL_M * layer.tile_size) / 2 ** level;
}

/** Coarsest level whose pixels are no larger than a screen pixel, clamped to the layer's range. */
export function wmtsLevel(layer: WmtsLayer, view: PolarView): number {
  const pixel0 = wmtsTileSpan(layer, 0) / layer.tile_size;
  const wanted = Math.ceil(Math.log2(pixel0 / metresPerPixel(view)) - 1e-9);
  return Math.min(layer.max_level, Math.max(layer.min_level, wanted));
}

/**
 * Tiles that intersect both the view and the layer's published bounding box.
 * Requests never leave the bbox, so a failed tile means the service (not the
 * coverage) is the problem. `truncated` reports when `maxTiles` capped the set.
 */
export function wmtsTiles(layer: WmtsLayer, view: PolarView, maxTiles = 64): { level: number; tiles: TilePlacement[]; truncated: boolean } {
  let level = wmtsLevel(layer, view);
  const minX = Math.max(view.centerX - view.halfWidthM, layer.bbox[0]);
  const maxX = Math.min(view.centerX + view.halfWidthM, layer.bbox[2]);
  const minY = Math.max(view.centerY - view.halfWidthM, layer.bbox[1]);
  const maxY = Math.min(view.centerY + view.halfWidthM, layer.bbox[3]);
  if (minX >= maxX || minY >= maxY) return { level, tiles: [], truncated: false };
  let truncated = false;
  for (;;) {
    const span = wmtsTileSpan(layer, level);
    const n = 2 ** level;
    const col0 = Math.max(0, Math.floor((minX - layer.top_left[0]) / span));
    const col1 = Math.min(n - 1, Math.ceil((maxX - layer.top_left[0]) / span) - 1);
    const row0 = Math.max(0, Math.floor((layer.top_left[1] - maxY) / span));
    const row1 = Math.min(n - 1, Math.ceil((layer.top_left[1] - minY) / span) - 1);
    const count = Math.max(0, col1 - col0 + 1) * Math.max(0, row1 - row0 + 1);
    if (count > maxTiles && level > layer.min_level) { level--; truncated = true; continue; }
    const tiles: TilePlacement[] = [];
    const k = view.radiusPx / view.halfWidthM;
    for (let row = row0; row <= row1; row++) {
      for (let col = col0; col <= col1; col++) {
        const p = worldToScreen(view, layer.top_left[0] + col * span, layer.top_left[1] - row * span);
        tiles.push({
          key: `${level}/${row}/${col}`,
          url: layer.url_template.replace('{style}', layer.style).replace('{matrixSet}', layer.matrix_set)
            .replace('{z}', String(level)).replace('{row}', String(row)).replace('{col}', String(col)),
          level, row, col, left: p.x, top: p.y, size: span * k,
        });
      }
    }
    return { level, tiles, truncated };
  }
}

/** WMS 1.1.1 GetMap URL for the square that bounds the view (axis order is always x,y in 1.1.1). */
export function wmsUrl(layer: WmsLayer, view: PolarView, requestedPx: number): string {
  const px = Math.max(64, Math.min(layer.max_size, Math.round(requestedPx)));
  const bbox = [view.centerX - view.halfWidthM, view.centerY - view.halfWidthM, view.centerX + view.halfWidthM, view.centerY + view.halfWidthM]
    .map((v) => v.toFixed(1)).join(',');
  const q = new URLSearchParams({
    SERVICE: 'WMS', VERSION: layer.version, REQUEST: 'GetMap', LAYERS: layer.layers, STYLES: '',
    SRS: layer.srs, BBOX: bbox, WIDTH: String(px), HEIGHT: String(px), FORMAT: layer.format,
  });
  return `${layer.endpoint}?${q.toString()}`;
}

/** Screen rectangle of the bundled square image whose edge midpoints sit at `halfExtentDeg` colatitude. */
export function bundledImageRect(view: PolarView, halfExtentDeg: number): { left: number; top: number; size: number } {
  const rho = rhoForColatitude(halfExtentDeg);
  const p = worldToScreen(view, -rho, rho);
  return { left: p.x, top: p.y, size: (2 * rho * view.radiusPx) / view.halfWidthM };
}

export type LayerStatus = 'bundled' | 'idle' | 'loading' | 'ready' | 'partial' | 'unavailable' | 'no-coverage';

/** Honest status from tile outcomes: never "ready" unless every requested tile arrived. */
export function layerStatus(requested: number, loaded: number, failed: number): LayerStatus {
  if (requested === 0) return 'no-coverage';
  if (loaded + failed < requested) return 'loading';
  if (failed === 0) return 'ready';
  return loaded === 0 ? 'unavailable' : 'partial';
}
