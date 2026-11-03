import { useMemo, useRef, useState } from 'react';
import { CalendarClock, Pause, Play, SkipBack, SkipForward, RotateCcw, GripVertical } from 'lucide-react';
import type { EvaluatedSample, MissionSummary, SimulationResult } from '../types/mission';
import { DAY_MS, clamp, formatDate, formatUTC } from '../engine/constants';

interface Props {
  sim: SimulationResult | null;
  loading: boolean;
  window: { startMs: number; endMs: number; missionStart: number; missionEnd: number };
  timeMs: number;
  onTime: (t: number) => void;
  baselineMs: number;
  onBaseline: (ms: number) => void;
  slipDays: number;
  onSlip: (d: number) => void;
  durationDays: number;
  onDuration: (d: number) => void;
  playing: boolean;
  onPlay: () => void;
  speed: number;
  onSpeed: (s: number) => void;
  viewDays: number;
  onViewDays: (d: number) => void;
  missionSummary: MissionSummary | null;
  baselineSummary: MissionSummary | null;
}

const W = 1200;
const H = 120;
const ML = 112;
const MR = 20;
const PW = W - ML - MR;
const TRACKS = [
  { key: 'sun', label: 'Sunlight / power', y: 12, color: '#c4842a', bg: '#fdf0d5' },
  { key: 'earth', label: 'DTE comms', y: 38, color: '#0e7490', bg: '#e3f2f6' },
  { key: 'combined', label: 'Mission viable', y: 64, color: '#1f7a52', bg: '#e7f5ee' },
] as const;
const TH = 16;
const SPEEDS = [1, 60, 3600, 86400, 604800];
const SPEED_LABEL: Record<number, string> = { 1: '1×', 60: '1 min/s', 3600: '1 h/s', 86400: '1 d/s', 604800: '7 d/s' };

export function TimelineScrubber(props: Props) {
  const { sim, loading, window: win, timeMs, onTime, baselineMs, onBaseline, slipDays, onSlip, durationDays, onDuration, playing, onPlay, speed, onSpeed, viewDays, onViewDays, missionSummary, baselineSummary } = props;
  const sampling = sim?.sampling ?? null;
  const baselineInput = new Date(baselineMs).toISOString().slice(0, 16);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const drag = useRef<{ x: number; slip: number } | null>(null);
  const domain = win.endMs - win.startMs;
  const xOf = (t: number) => ML + ((t - win.startMs) / domain) * PW;

  const runs = useMemo(() => {
    if (!sim) return { sun: [], earth: [], combined: [] } as Record<string, { x: number; w: number }[]>;
    const stride = Math.max(1, Math.floor(sim.samples.length / 1400));
    const out: Record<string, { x: number; w: number }[]> = { sun: [], earth: [], combined: [] };
    const pick = (s: EvaluatedSample, key: string) => key === 'sun' ? s.sunVisibility.visible : key === 'earth' ? s.earthVisibility.visible : s.viable;
    for (const track of TRACKS) {
      let start: number | null = null;
      for (let i = 0; i < sim.samples.length; i += stride) {
        const s = sim.samples[i];
        const vis = pick(s, track.key);
        if (vis && start == null) start = s.timeMs;
        if (!vis && start != null) { out[track.key].push({ x: xOf(start), w: Math.max(1, xOf(s.timeMs) - xOf(start)) }); start = null; }
      }
      if (start != null) out[track.key].push({ x: xOf(start), w: Math.max(1, xOf(win.endMs) - xOf(start)) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, win.startMs, win.endMs]);

  const ticks = useMemo(() => {
    const days = domain / DAY_MS;
    const step = days > 60 ? 10 : days > 20 ? 5 : days > 8 ? 2 : 1;
    const arr: number[] = [];
    const first = Math.ceil(win.startMs / (step * DAY_MS)) * step * DAY_MS;
    for (let t = first; t <= win.endMs; t += step * DAY_MS) arr.push(t);
    return arr;
  }, [win.startMs, win.endMs, domain]);

  const tOfX = (clientX: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    return clamp(win.startMs + ((x - ML) / PW) * domain, win.startMs, win.endMs);
  };

  const mx0 = xOf(win.missionStart);
  const mx1 = xOf(win.missionEnd);
  const combinedDelta = missionSummary && baselineSummary ? missionSummary.combinedPct - baselineSummary.combinedPct : null;
  const energyDelta = missionSummary && baselineSummary ? missionSummary.selectedEnergyKWh - baselineSummary.selectedEnergyKWh : null;

  return (
    <section className="panel" style={{ flexShrink: 0 }}>
      <div className="panel-header">
        <span className="panel-title"><CalendarClock size={13} /> Mission timeline · synodic scrubber</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="btn sm icon" title="Step back 1 day ([)" onClick={() => onTime(clamp(timeMs - DAY_MS, win.startMs, win.endMs))}><SkipBack size={12} /></button>
          <button className={`btn sm ${playing ? 'active' : ''}`} onClick={onPlay}>{playing ? <Pause size={12} /> : <Play size={12} />} {playing ? 'Pause' : 'Play'} <span className="kbd">Space</span></button>
          <button className="btn sm icon" title="Step forward 1 day (])" onClick={() => onTime(clamp(timeMs + DAY_MS, win.startMs, win.endMs))}><SkipForward size={12} /></button>
          <select className="input" style={{ width: 92, height: 24, fontSize: 11 }} value={speed} onChange={(e) => onSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => <option key={s} value={s}>{SPEED_LABEL[s]}</option>)}
          </select>
          <select className="input" style={{ width: 84, height: 24, fontSize: 11 }} value={viewDays} onChange={(e) => onViewDays(Number(e.target.value))}>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
          <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', minWidth: 150, textAlign: 'right' }}>{formatUTC(timeMs)}</span>
        </div>
      </div>
      <div style={{ position: 'relative', padding: '4px 10px 0' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', display: 'block', cursor: 'crosshair' }}
          onMouseMove={(e) => setHoverT(tOfX(e.clientX))}
          onMouseLeave={() => setHoverT(null)}
          onClick={(e) => { if (!drag.current) onTime(tOfX(e.clientX)); }}
        >
          {TRACKS.map((t) => (
            <g key={t.key}>
              <text x={ML - 10} y={t.y + 13} textAnchor="end" fontSize={10} fill="#5c5348" fontFamily="Outfit, sans-serif">{t.label}</text>
              <rect x={ML} y={t.y} width={PW} height={TH} fill={t.bg} rx={2} />
              {runs[t.key].map((r, i) => <rect key={i} x={r.x} y={t.y} width={r.w} height={TH} fill={t.color} opacity={0.85} rx={1} />)}
            </g>
          ))}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={xOf(t)} x2={xOf(t)} y1={8} y2={82} stroke="#f3e6d0" strokeWidth={1} />
              <text x={xOf(t)} y={96} textAnchor="middle" fontSize={9} fill="#8a7358" fontFamily="IBM Plex Mono, monospace">{formatDate(t).slice(5)}</text>
            </g>
          ))}
          <rect x={mx0} y={8} width={Math.max(2, mx1 - mx0)} height={76} fill="rgba(30,58,95,.08)" stroke="#1e3a5f" strokeOpacity={0.6} strokeWidth={1} strokeDasharray="3 2" rx={0}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, slip: slipDays }; }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const rect = svgRef.current!.getBoundingClientRect();
              const dx = ((e.clientX - drag.current.x) / rect.width) * W;
              const deltaDays = (dx / PW) * (domain / DAY_MS);
              onSlip(clamp(Math.round((drag.current.slip + deltaDays) * 4) / 4, 0, 60));
            }}
            onPointerUp={(e) => { (e.target as Element).releasePointerCapture(e.pointerId); setTimeout(() => { drag.current = null; }, 0); }}
          />
          <text x={mx0 + 6} y={18} fontSize={9} fill="#1c2430" fontFamily="IBM Plex Mono, monospace" pointerEvents="none">MISSION {durationDays}d · slip +{slipDays}d</text>
          <g pointerEvents="none">
            <line x1={xOf(timeMs)} x2={xOf(timeMs)} y1={6} y2={86} stroke="#fff" strokeWidth={1.2} />
            <polygon points={`${xOf(timeMs) - 5},4 ${xOf(timeMs) + 5},4 ${xOf(timeMs)},10`} fill="#fff" />
          </g>
          {hoverT != null && <line x1={xOf(hoverT)} x2={xOf(hoverT)} y1={6} y2={86} stroke="#5c5348" strokeOpacity={0.4} strokeDasharray="2 3" />}
          <text x={ML} y={112} fontSize={9} fill="#8a7358" fontFamily="Outfit, sans-serif">Drag the white mission box to simulate launch slip · click tracks to scrub</text>
        </svg>
        {hoverT != null && <div className="tooltip" style={{ right: 16, top: 8 }}>{formatUTC(hoverT)}</div>}
        {loading && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(243,230,208,.6)', fontSize: 11, color: 'var(--ink-soft)' }} className="pulse">Recomputing window…</div>}
      </div>
      <div style={{ padding: '0 12px 6px' }}>
        <input type="range" min={win.startMs} max={win.endMs} step={60000} value={timeMs} onChange={(e) => onTime(Number(e.target.value))} aria-label="Mission time scrubber" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '7px 12px', borderTop: '1px solid var(--border)', background: 'var(--panel-2)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 200 }}>
          <GripVertical size={13} color="var(--muted)" />
          <span className="panel-title" style={{ whiteSpace: 'nowrap' }}>Launch slip</span>
          <span className="chip solar">+{slipDays} d</span>
        </div>
        <input type="range" className="solar" min={0} max={60} step={0.25} value={slipDays} onChange={(e) => onSlip(Number(e.target.value))} style={{ flex: 1, minWidth: 140 }} aria-label="Launch slip days" />
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn sm" onClick={() => onSlip(clamp(slipDays - 14, 0, 60))}>−14 d</button>
          <button className="btn sm" onClick={() => onSlip(clamp(slipDays + 14, 0, 60))}>+14 d</button>
          <button className="btn sm ghost icon" onClick={() => onSlip(0)}><RotateCcw size={12} /></button>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--muted)' }} title="Mission start in UTC. All ephemeris, timelines and exports use UTC (no local timezone).">
          Start (UTC)
          <input
            type="datetime-local" className="input" style={{ height: 22, fontSize: 11, width: 182 }}
            value={baselineInput}
            onChange={(e) => { const v = e.target.value; if (!v) return; const ms = Date.parse(`${v}:00Z`); if (!Number.isNaN(ms)) onBaseline(ms); }}
            aria-label="Mission start date and time (UTC)"
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--muted)' }}>Duration
          <select className="input" style={{ width: 66, height: 22, fontSize: 11 }} value={durationDays} onChange={(e) => onDuration(Number(e.target.value))} aria-label="Mission duration days">
            {[3, 7, 10, 14, 30, 90].map((d) => <option key={d} value={d}>{d} d</option>)}
          </select>
        </label>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>slip → <span style={{ color: 'var(--solar)' }}>{formatDate(win.missionStart)}</span></span>
        <div style={{ display: 'flex', gap: 16, marginLeft: 'auto', alignItems: 'center' }}>
          <div className="metric sm"><span className="label">Combined Δ</span><span className="value" style={{ fontSize: 13, color: combinedDelta == null ? 'var(--muted)' : combinedDelta >= 0 ? 'var(--nominal)' : 'var(--blocked)' }}>{combinedDelta == null ? '—' : `${combinedDelta >= 0 ? '+' : ''}${combinedDelta.toFixed(1)}`}<span className="unit">%</span></span></div>
          <div className="metric sm"><span className="label">Energy Δ</span><span className="value" style={{ fontSize: 13, color: energyDelta == null ? 'var(--muted)' : energyDelta >= 0 ? 'var(--nominal)' : 'var(--blocked)' }}>{energyDelta == null ? '—' : `${energyDelta >= 0 ? '+' : ''}${energyDelta.toFixed(1)}`}<span className="unit">kWh</span></span></div>
          <div className="metric sm"><span className="label">Min batt</span><span className="value" style={{ fontSize: 13, color: missionSummary && missionSummary.minBatterySocPct <= 0 ? 'var(--blocked)' : 'var(--nominal)' }}>{missionSummary ? missionSummary.minBatterySocPct.toFixed(0) : '—'}<span className="unit">%</span></span></div>
          <div className="metric sm"><span className="label">Verdict</span><span className="value" style={{ fontSize: 12, color: missionSummary?.verdict === 'NOMINAL' ? 'var(--nominal)' : missionSummary?.verdict === 'CONDITIONAL' ? 'var(--solar)' : 'var(--blocked)' }}>{missionSummary?.verdict ?? '—'}</span></div>
        </div>
      </div>
      {sampling && (
        <div className="mono" style={{ padding: '3px 12px 6px', fontSize: 9.5, color: 'var(--muted)', borderTop: '1px dashed var(--border)', display: 'flex', gap: 10, flexWrap: 'wrap' }}
          title="Visibility percentages and gaps integrate refined transition timestamps (adaptive bisection), not the coarse sample grid.">
          <span>SAMPLING · {sampling.sampleCount.toLocaleString()} samples</span>
          <span>requested {sampling.requestedStepMinutes} min → effective {sampling.effectiveStepMinutes.toFixed(2)} min</span>
          <span>max gap {sampling.maxGapMinutes.toFixed(2)} min</span>
          {sampling.capped && <span style={{ color: 'var(--solar)' }}>step coarsened to respect 20,000-sample cap (full span + both endpoints preserved)</span>}
          <span style={{ marginLeft: 'auto' }}>UTC · transitions refined adaptively</span>
        </div>
      )}
    </section>
  );
}
