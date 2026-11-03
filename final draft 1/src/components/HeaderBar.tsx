import { useEffect, useRef, useState } from 'react';
import { BookOpen, Box, Columns2, Download, Keyboard, Moon, Settings2, GraduationCap, Gauge } from 'lucide-react';
import type { AppMode } from '../types/mission';
import { mjd } from '../engine/constants';

interface Props {
  timeMs: number;
  mode: AppMode;
  onMode: (m: AppMode) => void;
  compareMode: boolean;
  onCompare: () => void;
  terrainActive: boolean;
  onTerrain: () => void;
  onGuide: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  onExport: (kind: 'json' | 'timeseries' | 'horizon' | 'summary') => void;
  playing: boolean;
}

export function HeaderBar({ timeMs, mode, onMode, compareMode, onCompare, terrainActive, onTerrain, onGuide, onSettings, onShortcuts, onExport, playing }: Props) {
  const [exportOpen, setExportOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setExportOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const utc = new Date(timeMs).toISOString();
  return (
    <header style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 14px', height: 52, borderBottom: '1px solid var(--border)', background: 'linear-gradient(180deg,#10141c,#0b0e13)', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 6, border: '1px solid #2a3441', background: '#0c1017', display: 'grid', placeItems: 'center', position: 'relative' }}>
          <Moon size={16} color="#F59E0B" strokeWidth={1.75} />
          <span style={{ position: 'absolute', inset: -3, border: '1px solid rgba(245,158,11,.18)', borderRadius: 8 }} />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.18em' }}>SELENE</div>
          <div style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--dim)', textTransform: 'uppercase' }}>Lunar mission planning console</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginLeft: 12, padding: '4px 12px', border: '1px solid var(--border)', borderRadius: 5, background: '#0c1017' }}>
        <div>
          <div style={{ fontSize: 9, color: 'var(--dim)', letterSpacing: '.1em', textTransform: 'uppercase' }}>Mission epoch · sim</div>
          <div className="mono" style={{ fontSize: 14, fontWeight: 500 }}>{utc.slice(0, 10)} <span style={{ color: 'var(--solar)' }}>{utc.slice(11, 19)}</span> <span style={{ color: 'var(--dim)', fontSize: 11 }}>UTC</span></div>
        </div>
        <div style={{ width: 1, height: 26, background: 'var(--border)' }} />
        <div>
          <div style={{ fontSize: 9, color: 'var(--dim)', letterSpacing: '.1em', textTransform: 'uppercase' }}>MJD</div>
          <div className="mono" style={{ fontSize: 13 }}>{mjd(timeMs).toFixed(4)}</div>
        </div>
        <span className={`chip ${playing ? 'nominal' : 'neutral'}`}><span className={playing ? 'pulse' : ''} style={{ width: 6, height: 6, borderRadius: '50%', background: playing ? 'var(--nominal)' : 'var(--dim)' }} />{playing ? 'RUNNING' : 'HOLD'}</span>
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', border: '1px solid var(--border-strong)', borderRadius: 5, overflow: 'hidden' }}>
        <button className={`btn ghost sm ${mode === 'planner' ? 'active' : ''}`} style={{ borderRadius: 0, border: 'none' }} onClick={() => onMode('planner')}><Gauge size={13} /> Planner</button>
        <button className={`btn ghost sm ${mode === 'educator' ? 'active' : ''}`} style={{ borderRadius: 0, border: 'none' }} onClick={() => onMode('educator')}><GraduationCap size={13} /> Educator</button>
      </div>
      <button className={`btn ${terrainActive ? 'active' : ''}`} onClick={onTerrain}><Box size={14} /> Terrain Lab <span className="kbd">T</span></button>
      <button className={`btn ${compareMode && !terrainActive ? 'active' : ''}`} onClick={onCompare}><Columns2 size={14} /> Compare <span className="kbd">C</span></button>
      <button className="btn" onClick={onGuide}><BookOpen size={14} /> Field guide <span className="kbd">G</span></button>
      <div ref={ref} style={{ position: 'relative' }}>
        <button className="btn" onClick={() => setExportOpen((v) => !v)}><Download size={14} /> Export</button>
        {exportOpen && (
          <div className="fade-in" style={{ position: 'absolute', right: 0, top: 34, width: 230, background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: 4, zIndex: 40, boxShadow: '0 16px 40px rgba(0,0,0,.5)' }}>
            {([
              ['json', 'Mission report (.json)'],
              ['summary', 'Window summary (.csv)'],
              ['timeseries', 'Telemetry timeseries (.csv)'],
              ['horizon', 'Horizon mask (.csv)'],
            ] as const).map(([kind, label]) => (
              <button key={kind} className="btn ghost" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => { onExport(kind); setExportOpen(false); }}>{label}</button>
            ))}
          </div>
        )}
      </div>
      <button className="btn icon" title="Mission parameters" onClick={onSettings}><Settings2 size={15} /></button>
      <button className="btn icon" title="Keyboard shortcuts (?)" onClick={onShortcuts}><Keyboard size={15} /></button>
    </header>
  );
}
