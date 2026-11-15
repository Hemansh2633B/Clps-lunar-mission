import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Crosshair, Layers, Minus, Plus, RotateCcw, MapPin } from 'lucide-react';
import type { EvaluatedSample, LandingSite } from '../types/mission';
import { formatCoord } from '../engine/constants';
import { polarMapDescription } from '../utils/a11y';
import { BUNDLED_BASEMAP_ID, MAP_LAYER_SOURCES } from '../data/catalogue';
import {
  ZOOM_EXTENTS_DEG, azimuthToScreen, bundledImageRect, layerStatus, project, unproject, viewFor, wmsUrl, wmtsTiles,
  type LayerStatus, type PolarView, type TilePlacement,
} from '../map/polarProjection';

export interface MapLayers {
  grid: boolean;
  lighting: boolean;
  earthVector: boolean;
  /** Catalogue id of the imagery layer; the bundled LROC mosaic when omitted. */
  basemap?: string;
  /** Centre the view on the selected site instead of the pole. */
  centerOnSite?: boolean;
}

interface Props {
  sites: LandingSite[];
  selected: LandingSite;
  current: EvaluatedSample;
  onSelect: (id: string) => void;
  onPlaceCustom: (lat: number, lon: number) => void;
  layers: MapLayers;
  onLayers: (l: MapLayers) => void;
  visibilityBlocked?: boolean;
}

const SIZE = 560;
const C = SIZE / 2;
const R = C - 26;
const DEG = Math.PI / 180;
const LIGHT_PX = 220;

const STATUS_TEXT: Record<LayerStatus, string> = {
  bundled: 'Bundled · offline',
  idle: 'Not requested',
  loading: 'Loading…',
  ready: 'Live',
  partial: 'Partly loaded',
  unavailable: 'Unavailable — showing bundled imagery',
  'no-coverage': 'No coverage in this view — showing bundled imagery',
};
const STATUS_COLOR: Record<LayerStatus, string> = {
  bundled: 'var(--muted)', idle: 'var(--muted)', loading: 'var(--amber)', ready: 'var(--nominal)',
  partial: 'var(--amber)', unavailable: 'var(--crimson)', 'no-coverage': 'var(--muted)',
};

export function PolarMap({ sites, selected, current, onSelect, onPlaceCustom, layers, onLayers, visibilityBlocked }: Props) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const lightCache = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const [zoom, setZoom] = useState(0);
  const [hover, setHover] = useState<{ lat: number; lon: number } | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const [tileState, setTileState] = useState<{ key: string; loaded: number; failed: number }>({ key: '', loaded: 0, failed: 0 });

  const extent = ZOOM_EXTENTS_DEG[zoom];
  const centerOnSite = !!layers.centerOnSite;
  const view: PolarView = useMemo(
    () => viewFor(extent, SIZE, R, centerOnSite ? { lat: selected.latitude, lon: selected.longitude } : null),
    [extent, centerOnSite, selected.latitude, selected.longitude],
  );

  const activeSource = MAP_LAYER_SOURCES.find((s) => s.id === (layers.basemap ?? BUNDLED_BASEMAP_ID)) ?? MAP_LAYER_SOURCES[0];
  const bundled = MAP_LAYER_SOURCES.find((s) => s.id === BUNDLED_BASEMAP_ID);
  const bundledExtent = bundled && bundled.layer.type === 'bundled' ? bundled.layer.half_extent_deg : 10;

  /** Remote imagery is requested only after the user picks a remote layer. */
  const remote = useMemo((): { key: string; tiles: TilePlacement[]; truncated: boolean } => {
    const spec = activeSource.layer;
    if (spec.type === 'wmts') {
      const t = wmtsTiles(spec, view);
      return { key: `${activeSource.id}|${t.level}|${view.centerX.toFixed(0)}|${view.centerY.toFixed(0)}|${view.halfWidthM.toFixed(0)}`, tiles: t.tiles, truncated: t.truncated };
    }
    if (spec.type === 'wms') {
      const url = wmsUrl(spec, view, SIZE * 2);
      return { key: `${activeSource.id}|${url}`, tiles: [{ key: 'wms', url, level: 0, row: 0, col: 0, left: C - R, top: C - R, size: 2 * R }], truncated: false };
    }
    return { key: activeSource.id, tiles: [], truncated: false };
  }, [activeSource, view]);

  const counts = tileState.key === remote.key ? tileState : { key: remote.key, loaded: 0, failed: 0 };
  const status: LayerStatus = activeSource.layer.type === 'bundled' ? 'bundled' : layerStatus(remote.tiles.length, counts.loaded, counts.failed);
  const onTile = useCallback((key: string, ok: boolean) => {
    setTileState((prev) => {
      const base = prev.key === key ? prev : { key, loaded: 0, failed: 0 };
      return { key, loaded: base.loaded + (ok ? 1 : 0), failed: base.failed + (ok ? 0 : 1) };
    });
  }, []);

  useEffect(() => {
    const img = new Image();
    img.src = `${import.meta.env.BASE_URL}assets/lroc-south-pole.jpg`;
    img.onload = () => { imgRef.current = img; setImgReady(true); };
  }, []);

  const polarSites = useMemo(() => sites.filter((s) => s.category === 'polar' || s.latitude <= -80), [sites]);

  // Base layer: paper + the bundled mosaic, registered to the current view.
  useEffect(() => {
    const ctx = baseRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#f7f1e6';
    ctx.fillRect(0, 0, SIZE, SIZE);
    if (imgRef.current) {
      const rect = bundledImageRect(view, bundledExtent);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(imgRef.current, rect.left, rect.top, rect.size, rect.size);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(243,230,208,.58)';
      ctx.fillRect(0, 0, SIZE, SIZE);
    } else {
      const g = ctx.createRadialGradient(C, C, 10, C, C, R);
      g.addColorStop(0, '#f3e6d0');
      g.addColorStop(1, '#f7f1e6');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, SIZE, SIZE);
    }
    ctx.restore();
  }, [view, imgReady, bundledExtent]);

  // Overlay layer: lighting, graticule, Earth vector and site markers.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, R, 0, Math.PI * 2);
    ctx.clip();

    if (layers.lighting) {
      const key = `${current.subsolarLatitudeDeg.toFixed(1)}|${current.subsolarLongitudeDeg.toFixed(1)}|${view.centerX.toFixed(0)}|${view.centerY.toFixed(0)}|${view.halfWidthM.toFixed(0)}`;
      let lc = lightCache.current.get(key);
      if (!lc) {
        lc = document.createElement('canvas');
        lc.width = LIGHT_PX; lc.height = LIGHT_PX;
        const lctx = lc.getContext('2d')!;
        const data = lctx.createImageData(LIGHT_PX, LIGHT_PX);
        const slat = current.subsolarLatitudeDeg * DEG;
        const slon = current.subsolarLongitudeDeg * DEG;
        const sx = Math.cos(slat) * Math.cos(slon);
        const sy = Math.cos(slat) * Math.sin(slon);
        const sz = Math.sin(slat);
        for (let py = 0; py < LIGHT_PX; py++) {
          for (let px = 0; px < LIGHT_PX; px++) {
            const ll = unproject(view, (px / (LIGHT_PX - 1)) * SIZE, (py / (LIGHT_PX - 1)) * SIZE);
            const idx = (py * LIGHT_PX + px) * 4;
            if (!ll) { data.data[idx + 3] = 0; continue; }
            const lat = ll.lat * DEG;
            const lon = ll.lon * DEG;
            const dot = Math.cos(lat) * (sx * Math.cos(lon) + sy * Math.sin(lon)) + Math.sin(lat) * sz;
            if (dot < 0) { data.data[idx] = 60; data.data[idx + 1] = 45; data.data[idx + 2] = 30; data.data[idx + 3] = 120; }
            else { data.data[idx] = 224; data.data[idx + 1] = 154; data.data[idx + 2] = 43; data.data[idx + 3] = Math.round(22 * dot); }
          }
        }
        lctx.putImageData(data, 0, 0);
        lightCache.current.set(key, lc);
        if (lightCache.current.size > 40) { const first = lightCache.current.keys().next().value; if (first) lightCache.current.delete(first); }
      }
      ctx.drawImage(lc, 0, 0, SIZE, SIZE);
    }

    if (layers.grid) {
      ctx.strokeStyle = 'rgba(138,115,88,.45)';
      ctx.lineWidth = 1;
      ctx.font = '10px IBM Plex Mono, monospace';
      // Latitude rings: concentric about the POLE (which may be off-centre in a site-centred view).
      const pole = project(view, -90, 0, 1e9)!;
      const ringStep = extent >= 10 ? 5 : extent >= 5 ? 2 : extent >= 2.5 ? 1 : extent >= 1.25 ? 0.5 : 0.25;
      for (let colat = ringStep; colat <= 12; colat += ringStep) {
        const edge = project(view, colat - 90, 0, 1e9)!;
        const r = Math.hypot(edge.x - pole.x, edge.y - pole.y);
        if (r - Math.hypot(pole.x - C, pole.y - C) > R) break;
        ctx.beginPath(); ctx.arc(pole.x, pole.y, r, 0, Math.PI * 2); ctx.stroke();
        const label = project(view, colat - 90, 45);
        if (label) { ctx.fillStyle = '#8a7358'; ctx.fillText(`${(90 - colat).toFixed(ringStep < 1 ? 2 : 0)}°S`, label.x + 3, label.y - 3); }
      }
      // Meridians: straight lines from the pole, every 30°.
      for (let lon = 0; lon < 360; lon += 30) {
        const far = project(view, -78, lon, 1e9)!;
        ctx.beginPath(); ctx.moveTo(pole.x, pole.y); ctx.lineTo(far.x, far.y); ctx.stroke();
        if (!centerOnSite) {
          const d = azimuthToScreen(lon, 0);
          ctx.fillStyle = '#8a7358'; ctx.textAlign = 'center';
          ctx.fillText(`${lon}°`, C + d.x * (R - 14), C + d.y * (R - 14) + 4);
          ctx.textAlign = 'left';
        }
      }
      ctx.strokeStyle = 'rgba(28,36,48,.4)';
      ctx.beginPath(); ctx.moveTo(pole.x - 8, pole.y); ctx.lineTo(pole.x + 8, pole.y); ctx.moveTo(pole.x, pole.y - 8); ctx.lineTo(pole.x, pole.y + 8); ctx.stroke();
    }

    if (layers.earthVector) {
      const sp = project(view, selected.latitude, selected.longitude);
      if (sp) {
        // Local azimuth → map direction (conformal): see azimuthToScreen.
        const d = azimuthToScreen(selected.longitude, current.earth.azimuthDeg);
        const len = 46;
        const ex = sp.x + d.x * len;
        const ey = sp.y + d.y * len;
        // When terrain visibility is gated, the vector conveys sky azimuth ONLY —
        // neutral brass, never the green/red that would imply a LOS verdict.
        ctx.strokeStyle = visibilityBlocked ? '#8a7358' : current.earthVisibility.visible ? '#0e7490' : '#c23b32';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
        ctx.font = '9px IBM Plex Mono, monospace';
        ctx.fillText(visibilityBlocked ? `Earth az ${current.earth.azimuthDeg.toFixed(0)}° · LOS unverified` : `DTE ${current.earth.azimuthDeg.toFixed(0)}°`, ex + 6, ey + 3);
      }
    }

    for (const s of polarSites) {
      const p = project(view, s.latitude, s.longitude);
      if (!p) continue;
      const isSel = s.id === selected.id;
      ctx.beginPath();
      ctx.arc(p.x, p.y, isSel ? 6 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? s.accent : '#fffdf7';
      ctx.fill();
      ctx.strokeStyle = isSel ? '#fffaf2' : s.accent;
      ctx.lineWidth = isSel ? 1.5 : 1.2;
      ctx.stroke();
      if (isSel) {
        ctx.strokeStyle = s.accent;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x - 16, p.y); ctx.lineTo(p.x - 8, p.y); ctx.moveTo(p.x + 8, p.y); ctx.lineTo(p.x + 16, p.y); ctx.moveTo(p.x, p.y - 16); ctx.lineTo(p.x, p.y - 8); ctx.moveTo(p.x, p.y + 8); ctx.lineTo(p.x, p.y + 16); ctx.stroke();
      }
      const dx = p.x - C;
      const dy = p.y - C;
      const rr = Math.hypot(dx, dy);
      const fallback = azimuthToScreen(s.longitude, 0);
      const ux = rr > 1 ? dx / rr : fallback.x;
      const uy = rr > 1 ? dy / rr : fallback.y;
      const off = isSel ? 22 : 15;
      const lx = p.x + ux * off;
      const ly = p.y + uy * off;
      ctx.strokeStyle = 'rgba(28,36,48,.3)';
      ctx.lineWidth = 0.75;
      ctx.beginPath(); ctx.moveTo(p.x + ux * 5, p.y + uy * 5); ctx.lineTo(lx, ly); ctx.stroke();
      ctx.fillStyle = isSel ? '#1c2430' : '#5c5348';
      ctx.font = `${isSel ? '600 ' : ''}9px Outfit, sans-serif`;
      ctx.textAlign = ux > 0.3 ? 'left' : ux < -0.3 ? 'right' : 'center';
      ctx.fillText(s.shortName, lx + ux * 3, ly + uy * 3 + 3);
      ctx.textAlign = 'left';
    }
    ctx.restore();
    ctx.strokeStyle = '#c4b49a';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(C, C, R, 0, Math.PI * 2); ctx.stroke();
  }, [polarSites, selected, current, layers, extent, view, centerOnSite, visibilityBlocked]);

  const toCanvas = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * SIZE, y: ((e.clientY - rect.top) / rect.height) * SIZE };
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = toCanvas(e);
    for (const s of polarSites) {
      const p = project(view, s.latitude, s.longitude);
      if (p && Math.hypot(p.x - x, p.y - y) < 12) { onSelect(s.id); return; }
    }
    const ll = unproject(view, x, y);
    if (ll) onPlaceCustom(ll.lat, ll.lon);
  };

  const pct = (v: number) => `${(v / SIZE) * 100}%`;
  const remoteLayer = activeSource.layer.type !== 'bundled';

  return (
    <section className="panel" style={{ display: 'flex', flexDirection: 'column' }} data-testid="polar-map"
      data-layer={activeSource.id} data-layer-status={status} data-extent-deg={extent}>
      <div className="panel-header">
        <span className="panel-title"><Compass size={13} /> South pole · stereographic</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className={`btn sm ${layers.grid ? 'active' : 'ghost'}`} aria-pressed={layers.grid} onClick={() => onLayers({ ...layers, grid: !layers.grid })}>Grid</button>
          <button className={`btn sm ${layers.lighting ? 'active' : 'ghost'}`} aria-pressed={layers.lighting} onClick={() => onLayers({ ...layers, lighting: !layers.lighting })}>Light</button>
          <button className={`btn sm ${layers.earthVector ? 'active' : 'ghost'}`} aria-pressed={layers.earthVector} onClick={() => onLayers({ ...layers, earthVector: !layers.earthVector })}>DTE</button>
          <button className={`btn sm icon ${centerOnSite ? 'active' : ''}`} aria-pressed={centerOnSite} aria-label="Centre map on the selected site" title="Centre on the selected site"
            onClick={() => onLayers({ ...layers, centerOnSite: !centerOnSite })}><Crosshair size={12} /></button>
          <button className="btn sm icon" aria-label="Zoom in" title="Zoom in" disabled={zoom >= ZOOM_EXTENTS_DEG.length - 1} onClick={() => setZoom((z) => Math.min(ZOOM_EXTENTS_DEG.length - 1, z + 1))}><Plus size={12} /></button>
          <button className="btn sm icon" aria-label="Zoom out" title="Zoom out" disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))}><Minus size={12} /></button>
          <button className="btn sm icon" aria-label="Reset map view" title="Reset view" onClick={() => { setZoom(0); if (centerOnSite) onLayers({ ...layers, centerOnSite: false }); }}><RotateCcw size={12} /></button>
        </div>
      </div>
      {/* Imagery choice and its live status sit above the map so they stay in view with it. */}
      <div className="polar-layer-row">
        <label>
          <Layers size={10} aria-hidden="true" /> <span>Imagery</span>
          <select className="input" aria-label="Polar map imagery layer" value={activeSource.id}
            onChange={(e) => onLayers({ ...layers, basemap: e.target.value })}>
            {MAP_LAYER_SOURCES.map((s) => (
              <option key={s.id} value={s.id}>{s.product_name}{s.layer.type === 'bundled' ? ' (offline)' : s.layer.type === 'wmts' ? ' (NASA Moon Trek, live)' : ' (LROC WMS, live)'}</option>
            ))}
          </select>
        </label>
        {/* Only the state is a live region: the tile count changes on every arrival and would
            otherwise be announced once per tile. */}
        <span data-testid="polar-layer-status" style={{ color: STATUS_COLOR[status], display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span className="dot" aria-hidden="true" style={{ background: STATUS_COLOR[status] }} />
          <span>
            <span role="status">{STATUS_TEXT[status]}</span>
            {remoteLayer && remote.tiles.length > 0 && status !== 'ready' && status !== 'unavailable' ? ` · ${counts.loaded}/${remote.tiles.length}` : ''}
          </span>
        </span>
      </div>
      <div style={{ position: 'relative', padding: 10, display: 'grid', placeItems: 'center', background: '#f7f1e6' }}>
        <div className="polar-stage" style={{ position: 'relative', width: '100%', maxWidth: 320, aspectRatio: '1', overflow: 'hidden' }}>
          <canvas ref={baseRef} width={SIZE} height={SIZE} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
          {remoteLayer && (
            <div aria-hidden="true" data-testid="polar-remote-layer" style={{ position: 'absolute', inset: 0, opacity: status === 'unavailable' ? 0 : 0.92, clipPath: `circle(${(R / SIZE) * 100}% at 50% 50%)` }}>
              {remote.tiles.map((t) => (
                <img key={`${remote.key}|${t.key}`} src={t.url} alt="" draggable={false} referrerPolicy="no-referrer" data-tile={t.key}
                  onLoad={() => onTile(remote.key, true)} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; onTile(remote.key, false); }}
                  style={{ position: 'absolute', left: pct(t.left), top: pct(t.top), width: pct(t.size), height: pct(t.size), maxWidth: 'none', userSelect: 'none' }} />
              ))}
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(243,230,208,.22)' }} />
            </div>
          )}
          <canvas
            ref={canvasRef}
            width={SIZE}
            height={SIZE}
            role="img"
            aria-label={polarMapDescription(selected.shortName, selected.latitude, selected.longitude, !!visibilityBlocked)}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'crosshair' }}
            onClick={handleClick}
            onMouseMove={(e) => { const { x, y } = toCanvas(e); setHover(unproject(view, x, y)); }}
            onMouseLeave={() => setHover(null)}
          />
        </div>
        <div style={{ position: 'absolute', left: 14, bottom: 12, fontSize: 9, color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>
          {centerOnSite ? `${selected.shortName} ± ${extent}°` : `${(90 - extent).toFixed(extent < 1 ? 3 : 1)}°S–90°S`}
        </div>
        <div style={{ position: 'absolute', right: 14, top: 12, display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--muted)' }}>
          <MapPin size={11} /> Click to drop a custom site
        </div>
        {hover && (
          <div className="tooltip" style={{ left: 14, top: 12 }}>{formatCoord(hover.lat, hover.lon)}</div>
        )}
      </div>
      <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--dim)' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span>{activeSource.attribution ?? activeSource.provider}{activeSource.coverage ? ` · ${activeSource.coverage}` : ''}</span>
          {remoteLayer && <span>Requested from the provider by your browser; never used as elevation.</span>}
          {activeSource.category === 'lighting' && <span>Published long-term illumination, for context — not CHANDRA's result for this epoch.</span>}
          <span>Lighting overlay is geometric, not a DEM shadow model</span>
          <span style={{ marginLeft: 'auto' }} className="mono">0° meridian up · 90°E right</span>
        </div>
      </div>
    </section>
  );
}
