import { useMemo, useState } from 'react';
import { Mountain, Sun, Earth, Eye, EyeOff, Maximize2 } from 'lucide-react';
import type { AppMode, EvaluatedSample, LandingSite, SimulationResult } from '../types/mission';
import { terrainElevationAt } from '../engine/horizonPhysics';
import { clamp, wrap360 } from '../engine/constants';

export interface PanoramaOptions {
  showTracks: boolean;
  showTerrain: boolean;
  sector: 'full' | 'sun' | 'earth';
}

interface Props {
  site: LandingSite;
  current: EvaluatedSample;
  sim: SimulationResult | null;
  mode: AppMode;
  options: PanoramaOptions;
  onOptions: (o: PanoramaOptions) => void;
  /** When true, terrain-visibility claims are gated (frame/epoch); positions stay valid. */
  visibilityBlocked?: boolean;
}

const W = 1000;
const H = 300;
const ML = 46;
const MR = 16;
const MT = 24;
const MB = 28;
const PW = W - ML - MR;
const PH = H - MT - MB;

const COMPASS: [number, string][] = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW'], [360, 'N']];

export function HorizonPanorama({ site, current, sim, mode, options, onOptions, visibilityBlocked }: Props) {
  const [hover, setHover] = useState<{ x: number; y: number; az: number; el: number } | null>(null);
  const [locked, setLocked] = useState<{ az: number; el: number } | null>(null);

  const { azStart, azSpan, elMin, elMax } = useMemo(() => {
    const maxTerrain = Math.max(...site.terrain.elevations);
    const minTerrain = Math.min(...site.terrain.elevations);
    let trackMax = 0;
    if (sim) for (const s of sim.samples) trackMax = Math.max(trackMax, s.sun.elevationDeg, s.earth.elevationDeg);
    const elMax = clamp(Math.max(12, maxTerrain + 4, current.sun.elevationDeg + 6, current.earth.elevationDeg + 6, trackMax + 6), 12, 90);
    const elMin = clamp(Math.min(-4, minTerrain - 2), -30, -4);
    let azStart = 0;
    let azSpan = 360;
    if (options.sector === 'sun') { azStart = wrap360(current.sun.azimuthDeg - 60); azSpan = 120; }
    if (options.sector === 'earth') { azStart = wrap360(current.earth.azimuthDeg - 60); azSpan = 120; }
    return { azStart, azSpan, elMin, elMax };
  }, [site, sim, current, options.sector]);

  const xOf = (az: number) => {
    const d = wrap360(az - azStart);
    return d <= azSpan ? ML + (d / azSpan) * PW : null;
  };
  const yOf = (el: number) => MT + (1 - (el - elMin) / (elMax - elMin)) * PH;

  const terrainPath = useMemo(() => {
    if (!options.showTerrain) return '';
    const pts: string[] = [];
    const steps = 360;
    for (let i = 0; i <= steps; i++) {
      const az = wrap360(azStart + (i / steps) * azSpan);
      const x = ML + (i / steps) * PW;
      const y = yOf(terrainElevationAt(site.terrain, az));
      pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
    }
    pts.push(`L${ML + PW},${MT + PH} L${ML},${MT + PH} Z`);
    return pts.join(' ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, azStart, azSpan, elMin, elMax, options.showTerrain]);

  const tracks = useMemo(() => {
    if (!options.showTracks || !sim) return { sun: [] as string[], earth: [] as string[] };
    const stride = Math.max(1, Math.floor(sim.samples.length / 240));
    const build = (pick: (s: EvaluatedSample) => { az: number; el: number }) => {
      const segs: string[] = [];
      let cur = '';
      let prevX: number | null = null;
      for (let i = 0; i < sim.samples.length; i += stride) {
        const p = pick(sim.samples[i]);
        const x = xOf(p.az);
        const y = yOf(p.el);
        if (x == null) { if (cur) segs.push(cur); cur = ''; prevX = null; continue; }
        if (prevX != null && Math.abs(x - prevX) > PW / 2) { if (cur) segs.push(cur); cur = ''; }
        cur += `${cur ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
        prevX = x;
      }
      if (cur) segs.push(cur);
      return segs;
    };
    return {
      sun: build((s) => ({ az: s.sun.azimuthDeg, el: s.sun.elevationDeg })),
      earth: build((s) => ({ az: s.earth.azimuthDeg, el: s.earth.elevationDeg })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, options.showTracks, azStart, azSpan, elMin, elMax]);

  const sunX = xOf(current.sun.azimuthDeg);
  const earthX = xOf(current.earth.azimuthDeg);
  const sunY = yOf(current.sun.elevationDeg);
  const earthY = yOf(current.earth.elevationDeg);
  const probe = locked ?? (hover ? { az: hover.az, el: hover.el } : null);
  const probeTerrain = probe ? terrainElevationAt(site.terrain, probe.az) : 0;

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    if (x < ML || x > ML + PW || y < MT || y > MT + PH) { setHover(null); return; }
    const az = wrap360(azStart + ((x - ML) / PW) * azSpan);
    const el = elMin + (1 - (y - MT) / PH) * (elMax - elMin);
    setHover({ x, y, az, el });
  };

  const elStep = elMax > 40 ? 15 : elMax > 20 ? 5 : 2;
  const elTicks: number[] = [];
  for (let e = Math.ceil(elMin / elStep) * elStep; e <= elMax; e += elStep) elTicks.push(e);

  return (
    <section className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span className="panel-title"><Mountain size={13} /> Local horizon · 360° panorama</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className={`chip ${visibilityBlocked ? 'blocked' : current.sunVisibility.visible ? 'solar' : 'blocked'}`}><Sun size={11} /> {visibilityBlocked ? 'Sun visibility blocked' : current.sunVisibility.visible ? 'Sunlit' : current.sunVisibility.reason === 'terrain' ? 'Terrain shadow' : 'Night'}</span>
          <span className={`chip ${visibilityBlocked ? 'blocked' : current.earthVisibility.visible ? 'earth' : 'blocked'}`}><Earth size={11} /> {visibilityBlocked ? 'Earth visibility blocked' : current.earthVisibility.visible ? 'DTE open' : 'Earth blocked'}</span>
          <select className="input" style={{ width: 130, height: 24, fontSize: 11 }} value={options.sector} onChange={(e) => onOptions({ ...options, sector: e.target.value as PanoramaOptions['sector'] })}>
            <option value="full">Full 360°</option>
            <option value="sun">Sun sector ±60°</option>
            <option value="earth">Earth sector ±60°</option>
          </select>
          <button className={`btn sm ${options.showTracks ? 'active' : 'ghost'}`} title="Toggle orbital tracks" onClick={() => onOptions({ ...options, showTracks: !options.showTracks })}>{options.showTracks ? <Eye size={12} /> : <EyeOff size={12} />} Tracks</button>
          <button className={`btn sm ${options.showTerrain ? 'active' : 'ghost'}`} title="Toggle terrain mask" onClick={() => onOptions({ ...options, showTerrain: !options.showTerrain })}><Mountain size={12} /></button>
          <button className="btn sm ghost" title="Reset view" onClick={() => { onOptions({ ...options, sector: 'full' }); setLocked(null); }}><Maximize2 size={12} /></button>
        </div>
      </div>
      <div style={{ position: 'relative', background: 'radial-gradient(ellipse at 50% 120%, #f6ead2 0%, #f7f1e6 70%)' }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={`Local horizon panorama.${visibilityBlocked ? ' Terrain visibility is blocked by the frame gate at this epoch; only sky positions are shown.' : ''} Sun at ${current.sun.azimuthDeg.toFixed(0)} degrees azimuth and ${current.sun.elevationDeg.toFixed(1)} degrees elevation, ${current.sunVisibility.visible ? 'visible' : 'below the horizon or terrain-occulted'}. Earth at ${current.earth.azimuthDeg.toFixed(0)} degrees azimuth and ${current.earth.elevationDeg.toFixed(1)} degrees elevation, ${current.earthVisibility.visible ? 'visible, direct-to-Earth open' : 'not visible'}. A numeric horizon table is available from the site brief.`}
          style={{ width: '100%', display: 'block', cursor: 'crosshair' }} onMouseMove={handleMove} onMouseLeave={() => setHover(null)} onClick={() => { if (hover) setLocked(locked ? null : { az: hover.az, el: hover.el }); }}>
          <defs>
            <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f7f4ee" />
              <stop offset="55%" stopColor="#f6ead2" />
              <stop offset="100%" stopColor="#f3d7ae" />
            </linearGradient>
            <linearGradient id="terrainGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e7d3b0" />
              <stop offset="100%" stopColor="#d9c19a" />
            </linearGradient>
            <radialGradient id="sunGlow"><stop offset="0%" stopColor="#c4842a" stopOpacity=".55" /><stop offset="100%" stopColor="#c4842a" stopOpacity="0" /></radialGradient>
            <radialGradient id="earthGlow"><stop offset="0%" stopColor="#0e7490" stopOpacity=".45" /><stop offset="100%" stopColor="#0e7490" stopOpacity="0" /></radialGradient>
          </defs>
          <rect x={ML} y={MT} width={PW} height={PH} fill="url(#skyGrad)" />
          {elTicks.map((e) => (
            <g key={e}>
              <line x1={ML} x2={ML + PW} y1={yOf(e)} y2={yOf(e)} stroke={e === 0 ? '#1c2430' : '#e4d3b4'} strokeOpacity={e === 0 ? 0.35 : 1} strokeWidth={e === 0 ? 1.2 : 1} strokeDasharray={e === 0 ? '3 4' : '3 5'} />
              <text x={ML - 8} y={yOf(e) + 3} textAnchor="end" fontSize={10} fill="#8a7358" fontFamily="IBM Plex Mono, monospace">{e}°</text>
            </g>
          ))}
          {COMPASS.filter(([a]) => { const x = xOf(a); return x != null; }).map(([a, label]) => {
            const x = xOf(a)!;
            return (
              <g key={a}>
                <line x1={x} x2={x} y1={MT} y2={MT + PH} stroke="#e0cfae" strokeWidth={1} />
                <text x={x} y={H - 10} textAnchor="middle" fontSize={10} fill="#5c5348" fontFamily="IBM Plex Mono, monospace">{label}</text>
                <text x={x} y={H - 21} textAnchor="middle" fontSize={8} fill="#8a7358" fontFamily="IBM Plex Mono, monospace">{a === 360 ? 0 : a}°</text>
              </g>
            );
          })}
          {tracks.sun.map((d, i) => <path key={`s${i}`} d={d} fill="none" stroke="#c4842a" strokeOpacity={0.4} strokeWidth={1.2} strokeDasharray="4 4" />)}
          {tracks.earth.map((d, i) => <path key={`e${i}`} d={d} fill="none" stroke="#0e7490" strokeOpacity={0.45} strokeWidth={1.2} strokeDasharray="2 4" />)}
          {options.showTerrain && <path d={terrainPath} fill="url(#terrainGrad)" stroke="#3d3128" strokeWidth={1.6} />}
          {options.showTerrain && site.terrain.features.filter((f) => f.kind !== 'drop' && f.elevationDeg > 1).map((f) => {
            const x = xOf(f.azimuthDeg);
            if (x == null) return null;
            const y = yOf(terrainElevationAt(site.terrain, f.azimuthDeg));
            return <text key={f.name} x={x} y={y - 6} textAnchor="middle" fontSize={8.5} fill="#8a7358" fontFamily="Outfit, sans-serif">{f.name}</text>;
          })}
          {earthX != null && (
            <g>
              <circle cx={earthX} cy={earthY} r={18} fill="url(#earthGlow)" />
              <circle cx={earthX} cy={earthY} r={6} fill={visibilityBlocked ? '#efe8da' : current.earthVisibility.visible ? '#0e7490' : '#e7f0f4'} stroke={visibilityBlocked ? '#8a7358' : current.earthVisibility.visible ? '#0e7490' : '#c23b32'} strokeWidth={1.5} strokeDasharray={visibilityBlocked || !current.earthVisibility.visible ? '3 2' : ''} />
              <circle cx={earthX - 2} cy={earthY - 1} r={2} fill="#0e7490" opacity={0.7} />
              <text x={earthX > W - 130 ? earthX - 11 : earthX + 11} y={earthY - 8} textAnchor={earthX > W - 130 ? "end" : "start"} fontSize={10} fill={visibilityBlocked ? '#8a7358' : current.earthVisibility.visible ? '#0e7490' : '#c23b32'} fontFamily="IBM Plex Mono, monospace">EARTH {current.earth.elevationDeg.toFixed(2)}°</text>
            </g>
          )}
          {sunX != null && (
            <g>
              <circle cx={sunX} cy={sunY} r={24} fill="url(#sunGlow)" />
              <circle cx={sunX} cy={sunY} r={7} fill={visibilityBlocked ? '#efe8da' : current.sunVisibility.visible ? '#c4842a' : '#fdf0d5'} stroke={visibilityBlocked ? '#8a7358' : current.sunVisibility.visible ? '#8a5a16' : '#c23b32'} strokeWidth={1.5} strokeDasharray={visibilityBlocked || !current.sunVisibility.visible ? '3 2' : ''} />
              <text x={sunX > W - 130 ? sunX - 12 : sunX + 12} y={sunY + 4} textAnchor={sunX > W - 130 ? "end" : "start"} fontSize={10} fill={visibilityBlocked ? '#8a7358' : current.sunVisibility.visible ? '#8a5a16' : '#c23b32'} fontFamily="IBM Plex Mono, monospace">SUN {current.sun.elevationDeg.toFixed(2)}°</text>
            </g>
          )}
          {probe && (() => {
            const x = xOf(probe.az);
            if (x == null) return null;
            const y = yOf(probe.el);
            return (
              <g pointerEvents="none">
                <line x1={x} x2={x} y1={MT} y2={MT + PH} stroke="#1c2430" strokeOpacity={0.3} strokeDasharray="2 3" />
                <line x1={ML} x2={ML + PW} y1={y} y2={y} stroke="#1c2430" strokeOpacity={0.3} strokeDasharray="2 3" />
                <circle cx={x} cy={y} r={4} fill="none" stroke="#1c2430" strokeOpacity={0.7} />
              </g>
            );
          })()}
        </svg>
        {probe && (
          <div className="tooltip" style={{ left: 12, top: 10 }}>
            AZ {probe.az.toFixed(1)}° · EL {probe.el.toFixed(2)}° · terrain {probeTerrain.toFixed(2)}° {locked ? '· locked (click to release)' : ''}
          </div>
        )}
        {mode === 'educator' && (
          <div style={{ position: 'absolute', right: 12, bottom: 36, maxWidth: 260, background: 'rgba(255,250,242,.95)', border: '1px solid var(--line-strong)', borderRadius: 0, padding: '8px 10px', fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, boxShadow: '3px 3px 0 rgba(28,36,48,.12)' }}>
            <strong style={{ color: 'var(--text)' }}>Read the silhouette.</strong> The gray ridge is terrain. The Sun or Earth is blocked whenever it sits below that line — even if its elevation is above 0°.
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 16, padding: '6px 12px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--dim)', flexWrap: 'wrap' }}>
        <span><span style={{ color: 'var(--solar)' }}>━</span> Sun track</span>
        <span><span style={{ color: 'var(--earth)' }}>┄</span> Earth track (libration)</span>
        <span><span style={{ color: '#6b5344' }}>▰</span> Terrain mask</span>
        <span style={{ marginLeft: 'auto' }} className="mono">{site.terrain.label} · {site.terrain.kind === 'dem' ? site.terrain.elevations.length : site.terrain.elevations.length - 1} samples @ {site.terrain.resolutionDeg}° · click to lock probe</span>
      </div>
    </section>
  );
}
