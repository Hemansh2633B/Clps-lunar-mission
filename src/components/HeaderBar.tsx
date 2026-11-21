import { useEffect, useRef, useState } from 'react';
import { BookOpen, Box, Columns2, Database, Download, Keyboard, Settings2, GraduationCap, Gauge, Orbit, HelpCircle, Clock3, ChevronDown } from 'lucide-react';
import type { AppMode } from '../types/mission';
import { mjd, wrap180 } from '../engine/constants';
import { APP_VERSION } from '../version';

interface Props {
  timeMs: number;
  mode: AppMode;
  onMode: (m: AppMode) => void;
  compareMode: boolean;
  onCompare: () => void;
  terrainActive: boolean;
  onTerrain: () => void;
  spaceActive: boolean;
  onSpace: () => void;
  dataActive: boolean;
  onData: () => void;
  onGuide: () => void;
  onHelp: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  onExport: (kind: 'json' | 'timeseries' | 'horizon' | 'summary' | 'events' | 'energy') => void;
  playing: boolean;
  subSolar: { lat: number; lon: number };
  subEarth: { lat: number; lon: number };
}

const fmtLat = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'N' : 'S'}`;
const fmtLon = (v: number) => { const w = wrap180(v); return `${Math.abs(w).toFixed(2)}°${w >= 0 ? 'E' : 'W'}`; };

export function HeaderBar({ timeMs, mode, onMode, compareMode, onCompare, terrainActive, onTerrain, spaceActive, onSpace, dataActive, onData, onGuide, onHelp, onSettings, onShortcuts, onExport, playing, subSolar, subEarth }: Props) {
  const [exportOpen, setExportOpen] = useState(false);
  const [clockOpen, setClockOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setExportOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const utc = new Date(timeMs).toISOString();
  return (
    <>
      <div className="coralbar" />
      <header className="app-header" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 14px', borderBottom: '1px solid var(--line)', background: 'rgba(248,241,228,.94)', backdropFilter: 'blur(8px)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, flex: '0 0 auto' }}>
          <img src="/assets/patch.png" alt="CHANDRA mission patch" width={42} height={42} style={{ width: 42, height: 42, borderRadius: '50%', border: '1px solid var(--line)', objectFit: 'cover', flex: '0 0 auto' }} />
          <div title="CHANDRA — Sanskrit lunar deity, “the shining one”">
            <div className="display" style={{ fontSize: 19, lineHeight: 1, fontWeight: 600, whiteSpace: 'nowrap' }}>CHANDRA</div>
            <div className="mono" style={{ fontSize: 9, letterSpacing: '.18em', color: 'var(--ink-soft)', marginTop: 3 }}>LUNAR MISSION ANALYSIS · v{APP_VERSION}</div>
          </div>
        </div>

        <button type="button" className="clock-toggle" aria-expanded={clockOpen} aria-controls="mission-clock-details" onClick={() => setClockOpen((open) => !open)} title="Show UTC epoch, modified Julian date and lunar sub-points">
          <Clock3 size={13} />
          <span>Mission clock</span>
          <time dateTime={utc}>{utc.slice(0, 16).replace('T', ' ')} UTC</time>
          <ChevronDown size={12} className={clockOpen ? 'clock-chevron open' : 'clock-chevron'} />
        </button>
        <span className="engine-pill" style={{ flex: '0 0 auto' }} title="Sun/Earth ephemeris via astronomy-engine + IAU 2015 Moon rotation"><span className="led sage" />EPHEMERIS: NOMINAL</span>

        <span className={`chip ${playing ? 'nominal' : 'neutral'}`} title="Simulation playback" style={{ marginLeft: 4, flex: '0 0 auto' }}>
          <span className={playing ? 'led sage' : ''} style={playing ? undefined : { width: 8, height: 8, borderRadius: '50%', background: 'var(--dim)', display: 'inline-block' }} />
          {playing ? 'RUNNING' : 'HOLD'}
        </span>

        <div style={{ flex: 1 }} />

        <div className="header-tools">
          <div className="modeswitch" role="radiogroup" aria-label="Workspace mode">
            <button type="button" role="radio" aria-checked={mode === 'planner'} onClick={() => onMode('planner')}><Gauge size={13} /> PLAN</button>
            <button type="button" role="radio" aria-checked={mode === 'educator'} onClick={() => onMode('educator')}><GraduationCap size={13} /> TEACH</button>
          </div>
          <button className={`btn ${spaceActive ? 'active' : ''}`} onClick={onSpace} title="Space views — planet time-lapse and fleet hangar" aria-label="Space views"><Orbit size={14} /> <span className="tool-label">Space</span> <span className="kbd">O</span></button>
          <button className={`btn ${terrainActive ? 'active' : ''}`} onClick={onTerrain} title="Terrain analysis — 3D lab and real DEM workflow" aria-label="Terrain analysis"><Box size={14} /> <span className="tool-label">Terrain</span> <span className="kbd">T</span></button>
          <button className={`btn ${compareMode && !terrainActive && !spaceActive && !dataActive ? 'active' : ''}`} onClick={onCompare} data-tour="compare" title="Comparison — pinned scenarios, confidence-tiered ranking" aria-label="Comparison"><Columns2 size={14} /> <span className="tool-label">Compare</span> <span className="kbd">C</span></button>
          <button className={`btn ${dataActive ? 'active' : ''}`} onClick={onData} aria-pressed={dataActive} title="Lunar Data Hub — sources, provenance, JPL Horizons verification" aria-label="Data Hub"><Database size={14} /> <span className="tool-label">Data</span> <span className="kbd">D</span></button>
          <button className="btn" onClick={onGuide} title="Field Guide — guided stories and searchable glossary" aria-label="Field Guide"><BookOpen size={14} /> <span className="tool-label">Guide</span> <span className="kbd">G</span></button>
          <div ref={ref} data-tour="export" style={{ position: 'relative' }}>
            <button className="btn primary" onClick={() => setExportOpen((v) => !v)}><Download size={14} /> Export</button>
            {exportOpen && (
              <div className="fade-in" style={{ position: 'absolute', right: 0, top: 36, width: 230, background: 'var(--paper-2)', border: '1px solid var(--ink)', borderRadius: 0, padding: 4, zIndex: 40, boxShadow: '5px 5px 0 rgba(28,36,48,.18)' }}>
                {([
                  ['json', 'Mission report (.json)'],
                  ['summary', 'Window summary (.csv)'],
                  ['timeseries', 'Telemetry timeseries (.csv)'],
                  ['energy', 'Energy & battery history (.csv)'],
                  ['events', 'Visibility events (.csv)'],
                  ['horizon', 'Horizon mask (.csv)'],
                ] as const).map(([kind, label]) => (
                  <button key={kind} className="btn ghost" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => { onExport(kind); setExportOpen(false); }}>{label}</button>
                ))}
              </div>
            )}
          </div>
          <button className="btn icon" title="Welcome guide — what CHANDRA does and how to start" aria-label="Open welcome guide" onClick={onHelp}><HelpCircle size={15} /></button>
          <button className="btn icon" title="Mission parameters" aria-label="Mission parameters" data-tour="settings" onClick={onSettings}><Settings2 size={15} /></button>
          <button className="btn icon" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={onShortcuts}><Keyboard size={15} /></button>
        </div>
      </header>
      {clockOpen && (
      <div id="mission-clock-details" className="clock-strip header-clock">
        <div className="cluster">
          <div className="k">MISSION EPOCH · SIM</div>
          <div className="v">{utc.slice(11, 19)} <span style={{ color: 'var(--brass)' }}>UTC</span></div>
          <div className="h">{utc.slice(0, 10)}</div>
        </div>
        <div className="cluster">
          <div className="k">MJD</div>
          <div className="v">{mjd(timeMs).toFixed(4)}</div>
          <div className="h">MODIFIED JULIAN</div>
        </div>
        <div className="cluster">
          <div className="k">SUB-SOLAR</div>
          <div className="v">{fmtLon(subSolar.lon)} · {fmtLat(subSolar.lat)}</div>
          <div className="h">SELENOGRAPHIC</div>
        </div>
        <div className="cluster">
          <div className="k">SUB-EARTH</div>
          <div className="v">{fmtLon(subEarth.lon)} · {fmtLat(subEarth.lat)}</div>
          <div className="h">OPTICAL LIBRATION</div>
        </div>
      </div>
      )}
    </>
  );
}
