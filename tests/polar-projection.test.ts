import { describe, expect, it } from 'vitest';
import catalogue from '../backend/catalog/catalogue.json';
import {
  MOON_RADIUS_M, azimuthToScreen, bundledImageRect, forward, inverse, layerStatus, project, unproject,
  viewFor, wmsUrl, wmtsLevel, wmtsTileSpan, wmtsTiles, type WmsLayer, type WmtsLayer,
} from '../src/map/polarProjection';
import { computeEphemeris } from '../src/engine/ephemeris';
import { LANDING_SITES } from '../src/data/landingSites';

const SIZE = 560;
const R = 254;
const layerOf = <T,>(id: string) => (catalogue.sources.find((s) => s.id === id) as unknown as { layer: T }).layer;

describe('south-polar stereographic projection', () => {
  it('puts the 0° meridian up and 90°E right (orientation of the bundled LROC basemap and Trek tiles)', () => {
    const view = viewFor(10, SIZE, R);
    const c = SIZE / 2;
    const up = project(view, -85, 0)!;
    const right = project(view, -85, 90)!;
    const down = project(view, -85, 180)!;
    const left = project(view, -85, 270)!;
    expect(up.x).toBeCloseTo(c, 9); expect(up.y).toBeLessThan(c);
    expect(right.y).toBeCloseTo(c, 9); expect(right.x).toBeGreaterThan(c);
    expect(down.x).toBeCloseTo(c, 9); expect(down.y).toBeGreaterThan(c);
    expect(left.y).toBeCloseTo(c, 9); expect(left.x).toBeLessThan(c);
    // The rim of the default view is exactly 80°S.
    expect(Math.hypot(project(view, -80, 37)!.x - c, project(view, -80, 37)!.y - c)).toBeCloseTo(R, 9);
    expect(project(view, -79.9, 37)).toBeNull();
  });

  it('matches the closed-form Moon 2000 south polar stereographic metres', () => {
    // ρ = 2R·tan(colat/2): 87.5°S is the 75.84 km edge of the Trek LOLA 5 m product.
    const p = forward(-87.5, 90);
    expect(p.x).toBeCloseTo(2 * MOON_RADIUS_M * Math.tan((1.25 * Math.PI) / 180), 6);
    expect(p.x).toBeGreaterThan(75_800); expect(p.x).toBeLessThan(75_850);
    expect(p.y).toBeCloseTo(0, 6);
    expect(Math.hypot(forward(-90, 123).x, forward(-90, 123).y)).toBe(0);
  });

  it('round-trips forward/inverse and screen/world everywhere in the cap', () => {
    for (const extent of [10, 2.5, 0.625]) {
      for (const center of [null, { lat: -88.2, lon: 211 }]) {
        const view = viewFor(extent, SIZE, R, center);
        for (let i = 0; i < 200; i++) {
          const sx = 30 + ((i * 97) % 500);
          const sy = 30 + ((i * 53) % 500);
          const ll = unproject(view, sx, sy);
          if (!ll) continue;
          const back = project(view, ll.lat, ll.lon, 1e-6)!;
          expect(back.x).toBeCloseTo(sx, 6);
          expect(back.y).toBeCloseTo(sy, 6);
        }
      }
    }
    const ll = inverse(forward(-84.3, 301.25).x, forward(-84.3, 301.25).y);
    expect(ll.lat).toBeCloseTo(-84.3, 10);
    expect(ll.lon).toBeCloseTo(301.25, 10);
  });

  it('centres a site-centred view on the site', () => {
    const view = viewFor(1.25, SIZE, R, { lat: -85.5, lon: 222 });
    const p = project(view, -85.5, 222)!;
    expect(p.x).toBeCloseTo(SIZE / 2, 9);
    expect(p.y).toBeCloseTo(SIZE / 2, 9);
  });

  it('draws local azimuths conformally: north is radially away from the pole, east is clockwise', () => {
    const view = viewFor(10, SIZE, R);
    for (const lon of [0, 45, 90, 200, 315]) {
      const here = project(view, -86, lon)!;
      const north = project(view, -85.9, lon)!;
      const east = project(view, -86, lon + 0.5)!;
      const n = azimuthToScreen(lon, 0);
      const e = azimuthToScreen(lon, 90);
      const unit = (a: { x: number; y: number }, b: { x: number; y: number }) => { const d = Math.hypot(b.x - a.x, b.y - a.y); return { x: (b.x - a.x) / d, y: (b.y - a.y) / d }; };
      expect(n.x).toBeCloseTo(unit(here, north).x, 6);
      expect(n.y).toBeCloseTo(unit(here, north).y, 6);
      expect(e.x).toBeCloseTo(unit(here, east).x, 2);
      expect(e.y).toBeCloseTo(unit(here, east).y, 2);
    }
  });

  it('points the Earth vector at the near side (top of the map) for every polar catalogue site', () => {
    // Physical sanity check that is independent of the drawing code: the Earth sits
    // near (0°N, 0°E) within libration, so from any south-polar site its direction
    // on a 0°-up map must be within a few degrees of "up".
    const t = Date.UTC(2026, 11, 18);
    const polar = LANDING_SITES.filter((s) => s.latitude <= -84);
    expect(polar.length).toBeGreaterThan(3);
    for (const site of polar) {
      const eph = computeEphemeris(site, t);
      const v = azimuthToScreen(site.longitude, eph.earth.azimuthDeg);
      expect(v.y, site.id).toBeLessThan(-0.97);
      expect(Math.abs(v.x), site.id).toBeLessThan(0.25);
    }
  });
});

describe('bundled basemap registration', () => {
  it('fills the default view exactly and scales about the pole when zoomed', () => {
    const full = bundledImageRect(viewFor(10, SIZE, R), 10);
    expect(full.left).toBeCloseTo(SIZE / 2 - R, 9);
    expect(full.top).toBeCloseTo(SIZE / 2 - R, 9);
    expect(full.size).toBeCloseTo(2 * R, 9);
    const zoomed = bundledImageRect(viewFor(5, SIZE, R), 10);
    // tan(5°)/tan(2.5°): the image must grow with the zoom (v1.11 left it unscaled).
    expect(zoomed.size / full.size).toBeCloseTo(Math.tan((5 * Math.PI) / 180) / Math.tan((2.5 * Math.PI) / 180), 9);
    expect(zoomed.left + zoomed.size / 2).toBeCloseTo(SIZE / 2, 9);
  });
});

describe('Moon Trek WMTS tiling', () => {
  const shade = layerOf<WmtsLayer>('trek-lola-shade-spole875-5m');
  const illum = layerOf<WmtsLayer>('trek-wac-pole-illumination-south-100m');

  it('uses the capabilities matrix: one level-0 tile of 2,191,860 m anchored at (-1095930, 1095930)', () => {
    expect(wmtsTileSpan(shade, 0)).toBeCloseTo(2_191_860, 0);
    expect(shade.top_left).toEqual([-1095930, 1095930]);
    expect(wmtsTileSpan(shade, 0) / 2).toBeCloseTo(-shade.top_left[0], 0);
    expect(wmtsTileSpan(shade, 3)).toBeCloseTo(2_191_860 / 8, 0);
  });

  it('selects a level whose pixels are not coarser than the screen and stays inside the layer range', () => {
    expect(wmtsLevel(shade, viewFor(10, SIZE, R))).toBe(3);
    expect(wmtsLevel(shade, viewFor(2.5, SIZE, R))).toBe(5);
    expect(wmtsLevel(shade, viewFor(0.625, SIZE, R))).toBe(7);
    expect(wmtsLevel(illum, viewFor(0.625, SIZE, R))).toBe(6); // clamped to the product's deepest level
  });

  it('requests only tiles that intersect the published bounding box, placed on the pole', () => {
    const view = viewFor(10, SIZE, R);
    const { level, tiles, truncated } = wmtsTiles(shade, view);
    expect(level).toBe(3);
    expect(truncated).toBe(false);
    // ±75.84 km straddles the pole, which is the shared corner of the four central tiles.
    expect(tiles.map((t) => t.key).sort()).toEqual(['3/3/3', '3/3/4', '3/4/3', '3/4/4']);
    const corner = tiles.find((t) => t.key === '3/4/4')!;
    expect(corner.left).toBeCloseTo(SIZE / 2, 6);
    expect(corner.top).toBeCloseTo(SIZE / 2, 6);
    // One tile spans 273,982.5 m; the view radius is 2R·tan(5°) = 304.0 km over 254 px.
    expect(corner.size).toBeCloseTo((2_191_860 / 8) * (R / (2 * MOON_RADIUS_M * Math.tan((5 * Math.PI) / 180))), 3);
    expect(corner.url).toBe('https://trek.nasa.gov/tiles/Moon/SP/LRO_LOLA_Shade_SPole875_5mp_v04/1.0.0/default/default028mm/3/4/4.png');
  });

  it('places every tile so that its ground corner projects to its screen corner', () => {
    const view = viewFor(1.25, SIZE, R, { lat: -89.2, lon: 140 });
    const { tiles, level } = wmtsTiles(shade, view);
    expect(tiles.length).toBeGreaterThan(0);
    const span = wmtsTileSpan(shade, level);
    for (const t of tiles) {
      const gx = shade.top_left[0] + t.col * span;
      const gy = shade.top_left[1] - t.row * span;
      const ll = inverse(gx, gy);
      const w = forward(ll.lat, ll.lon);
      expect(w.x).toBeCloseTo(gx, 4);
      const k = view.radiusPx / view.halfWidthM;
      expect(t.left).toBeCloseTo(SIZE / 2 + (gx - view.centerX) * k, 6);
      expect(t.top).toBeCloseTo(SIZE / 2 - (gy - view.centerY) * k, 6);
    }
  });

  it('returns no tiles outside coverage and caps runaway requests', () => {
    const away = viewFor(0.625, SIZE, R, { lat: -84, lon: 90 });
    expect(wmtsTiles(shade, away).tiles).toHaveLength(0);
    const capped = wmtsTiles(shade, viewFor(2.5, SIZE, R), 4);
    expect(capped.tiles.length).toBeLessThanOrEqual(4);
    expect(capped.truncated).toBe(true);
  });
});

describe('LROC Lunaserv WMS request', () => {
  it('asks for the view square in IAU2000:30120 metres with x,y axis order', () => {
    const wms = layerOf<WmsLayer>('lroc-lunaserv-wms-wac-global');
    const url = new URL(wmsUrl(wms, viewFor(10, SIZE, R), 2000));
    expect(url.origin + url.pathname).toBe('https://wms.im-ldi.com/');
    expect(url.searchParams.get('SRS')).toBe('IAU2000:30120');
    expect(url.searchParams.get('REQUEST')).toBe('GetMap');
    expect(url.searchParams.get('WIDTH')).toBe('1024'); // clamped to max_size
    const [minx, miny, maxx, maxy] = url.searchParams.get('BBOX')!.split(',').map(Number);
    const half = 2 * MOON_RADIUS_M * Math.tan((5 * Math.PI) / 180);
    expect(minx).toBeCloseTo(-half, 0); expect(miny).toBeCloseTo(-half, 0);
    expect(maxx).toBeCloseTo(half, 0); expect(maxy).toBeCloseTo(half, 0);
  });
});

describe('layer status is never optimistic', () => {
  it('reports ready only when every requested tile loaded', () => {
    expect(layerStatus(0, 0, 0)).toBe('no-coverage');
    expect(layerStatus(4, 1, 0)).toBe('loading');
    expect(layerStatus(4, 4, 0)).toBe('ready');
    expect(layerStatus(4, 3, 1)).toBe('partial');
    expect(layerStatus(4, 0, 4)).toBe('unavailable');
  });
});
