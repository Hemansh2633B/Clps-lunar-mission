import { useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Layers, Minus, Plus, RotateCcw, MapPin } from 'lucide-react';
import type { EvaluatedSample, LandingSite } from '../types/mission';
import { clamp, formatCoord, wrap360 } from '../engine/constants';
import { polarMapDescription } from '../utils/a11y';

export interface MapLayers { grid: boolean; lighting: boolean; earthVector: boolean; }

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

function project(lat: number, lon: number, extentDeg: number) {
  const colat = 90 + lat;
  if (colat < 0 || colat > extentDeg) return null;
  const r = (Math.tan((colat / 2) * DEG) / Math.tan((extentDeg / 2) * DEG)) * R;
  return { x: C + r * Math.sin(lon * DEG), y: C + r * Math.cos(lon * DEG) };
}
function unproject(x: number, y: number, extentDeg: number) {
  const dx = x - C;
  const dy = y - C;
  const r = Math.hypot(dx, dy);
  if (r > R) return null;
  const colat = 2 * Math.atan((r / R) * Math.tan((extentDeg / 2) * DEG)) / DEG;
  return { lat: colat - 90, lon: wrap360(Math.atan2(dx, dy) / DEG) };
}

export function PolarMap({ sites, selected, current, onSelect, onPlaceCustom, layers, onLayers, visibilityBlocked }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const lightCache = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const [extent, setExtent] = useState(10);
  const [hover, setHover] = useState<{ x: number; y: number; lat: number; lon: number } | null>(null);
  const [imgReady, setImgReady] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.src = `${import.meta.env.BASE_URL}assets/lroc-south-pole.jpg`;
    img.onload = () => { imgRef.current = img; setImgReady(true); };
  }, []);

  const polarSites = useMemo(() => sites.filter((s) => s.category === 'polar' || s.latitude <= -80), [sites]);

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
    ctx.fillStyle = '#f7f1e6';
    ctx.fillRect(0, 0, SIZE, SIZE);
    if (imgRef.current) {
      ctx.globalAlpha = 0.9;
      ctx.drawImage(imgRef.current, C - R, C - R, R * 2, R * 2);
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

    if (layers.lighting) {
      const key = `${current.subsolarLatitudeDeg.toFixed(1)}|${current.subsolarLongitudeDeg.toFixed(1)}|${extent}`;
      let lc = lightCache.current.get(key);
      if (!lc) {
        lc = document.createElement('canvas');
        lc.width = 220; lc.height = 220;
        const lctx = lc.getContext('2d')!;
        const data = lctx.createImageData(220, 220);
        const slat = current.subsolarLatitudeDeg * DEG;
        const slon = current.subsolarLongitudeDeg * DEG;
        const sx = Math.cos(slat) * Math.cos(slon);
        const sy = Math.cos(slat) * Math.sin(slon);
        const sz = Math.sin(slat);
        for (let py = 0; py < 220; py++) {
          for (let px = 0; px < 220; px++) {
            const x = (px / 219) * SIZE;
            const y = (py / 219) * SIZE;
            const ll = unproject(x, y, extent);
            const idx = (py * 220 + px) * 4;
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
      ctx.drawImage(lc, C - R, C - R, R * 2, R * 2);
    }

    if (layers.grid) {
      ctx.strokeStyle = 'rgba(138,115,88,.4)';
      ctx.lineWidth = 1;
      const rings = extent >= 10 ? [85, 80] : extent >= 5 ? [88, 85] : [89, 88];
      for (const lat of rings) {
        const p = project(lat, 0, extent);
        if (!p) continue;
        const r = Math.hypot(p.x - C, p.y - C);
        ctx.beginPath(); ctx.arc(C, C, r, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#8a7358';
        ctx.font = '10px IBM Plex Mono, monospace';
        ctx.fillText(`${Math.abs(lat)}°S`, C + 4, C - r + 12);
      }
      for (let lon = 0; lon < 360; lon += 30) {
        const p = project(90 - extent, lon, extent);
        if (!p) continue;
        ctx.beginPath(); ctx.moveTo(C, C); ctx.lineTo(p.x, p.y); ctx.stroke();
        const lp = project(90 - extent + 0.6, lon, extent);
        if (lp) { ctx.fillStyle = '#8a7358'; ctx.font = '10px IBM Plex Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText(`${lon}°`, lp.x, lp.y + 4); ctx.textAlign = 'left'; }
      }
      ctx.strokeStyle = 'rgba(28,36,48,.4)';
      ctx.beginPath(); ctx.moveTo(C - 8, C); ctx.lineTo(C + 8, C); ctx.moveTo(C, C - 8); ctx.lineTo(C, C + 8); ctx.stroke();
    }

    if (layers.earthVector) {
      const sp = project(selected.latitude, selected.longitude, extent);
      if (sp) {
        const az = current.earth.azimuthDeg * DEG;
        const len = 46;
        const ex = sp.x + Math.sin(az) * len;
        const ey = sp.y + Math.cos(az) * len;
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
      const p = project(s.latitude, s.longitude, extent);
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
      const ux = rr > 1 ? dx / rr : Math.sin(s.longitude * DEG);
      const uy = rr > 1 ? dy / rr : Math.cos(s.longitude * DEG);
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
  }, [polarSites, selected, current, layers, extent, imgReady, visibilityBlocked]);

  const toCanvas = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * SIZE, y: ((e.clientY - rect.top) / rect.height) * SIZE };
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = toCanvas(e);
    for (const s of polarSites) {
      const p = project(s.latitude, s.longitude, extent);
      if (p && Math.hypot(p.x - x, p.y - y) < 12) { onSelect(s.id); return; }
    }
    const ll = unproject(x, y, extent);
    if (ll) onPlaceCustom(ll.lat, ll.lon);
  };

  return (
    <section className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span className="panel-title"><Compass size={13} /> South pole · stereographic</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={`btn sm ${layers.grid ? 'active' : 'ghost'}`} onClick={() => onLayers({ ...layers, grid: !layers.grid })}>Grid</button>
          <button className={`btn sm ${layers.lighting ? 'active' : 'ghost'}`} onClick={() => onLayers({ ...layers, lighting: !layers.lighting })}>Light</button>
          <button className={`btn sm ${layers.earthVector ? 'active' : 'ghost'}`} onClick={() => onLayers({ ...layers, earthVector: !layers.earthVector })}>DTE</button>
          <button className="btn sm icon" onClick={() => setExtent((e) => clamp(e * 2, 2.5, 10))}><Plus size={12} /></button>
          <button className="btn sm icon" onClick={() => setExtent((e) => clamp(e / 2, 2.5, 10))}><Minus size={12} /></button>
          <button className="btn sm icon" onClick={() => setExtent(10)}><RotateCcw size={12} /></button>
        </div>
      </div>
      <div style={{ position: 'relative', padding: 10, display: 'grid', placeItems: 'center', background: '#f7f1e6' }}>
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label={polarMapDescription(selected.shortName, selected.latitude, selected.longitude, !!visibilityBlocked)}
          style={{ width: '100%', maxWidth: 250, aspectRatio: '1', cursor: 'crosshair', borderRadius: '50%' }}
          onClick={handleClick}
          onMouseMove={(e) => { const { x, y } = toCanvas(e); const ll = unproject(x, y, extent); setHover(ll ? { x: e.clientX, y: e.clientY, ...ll } : null); }}
          onMouseLeave={() => setHover(null)}
        />
        <div style={{ position: 'absolute', left: 14, bottom: 12, fontSize: 9, color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>
          LROC WAC · 400 m/px · {Math.abs(90 - extent).toFixed(1)}°S–90°S
        </div>
        <div style={{ position: 'absolute', right: 14, top: 12, display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--muted)' }}>
          <MapPin size={11} /> Click to drop a custom site
        </div>
        {hover && (
          <div className="tooltip" style={{ left: 14, top: 12 }}>{formatCoord(hover.lat, hover.lon)}</div>
        )}
      </div>
      <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--dim)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span><Layers size={10} style={{ display: 'inline', marginRight: 4 }} />Imagery: NASA/GSFC/ASU LROC</span>
        <span>Lighting overlay is geometric, not a DEM shadow model</span>
        <span style={{ marginLeft: 'auto' }} className="mono">0° meridian ↓ · 90°E →</span>
      </div>
    </section>
  );
}
