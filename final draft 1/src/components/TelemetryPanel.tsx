import { Activity, BatteryCharging, Clock, Earth, Radio, Sun, Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { AppMode, EvaluatedSample, LandingSite, MissionConfig, SimulationResult, TransitionEvent } from '../types/mission';
import { formatDuration, LIGHT_SPEED_KMS } from '../engine/constants';

interface Props {
  site: LandingSite;
  current: EvaluatedSample;
  sim: SimulationResult | null;
  events: TransitionEvent[];
  timeMs: number;
  mode: AppMode;
  config: MissionConfig;
  onSettings: () => void;
}

function nextEvent(events: TransitionEvent[], body: 'sun' | 'earth', timeMs: number, wantVisible: boolean) {
  return events.find((e) => e.body === body && e.timeMs > timeMs && e.visible === wantVisible) ?? null;
}

function Stat({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div className="metric sm">
      <span className="label">{label}</span>
      <span className="value" style={{ color }}>{value}{unit && <span className="unit">{unit}</span>}</span>
    </div>
  );
}

export function TelemetryPanel({ site, current, sim, events, timeMs, mode, config, onSettings }: Props) {
  const sunNext = nextEvent(events, 'sun', timeMs, !current.sunVisibility.visible);
  const earthNext = nextEvent(events, 'earth', timeMs, !current.earthVisibility.visible);
  const summary = sim?.summary;
  const maxW = current.power.fluxWm2 * config.arrayAreaM2 * config.cellEfficiency * config.systemDerate;
  const verdictColor = summary?.verdict === 'NOMINAL' ? 'var(--nominal)' : summary?.verdict === 'CONDITIONAL' ? 'var(--solar)' : 'var(--blocked)';
  const educator = mode === 'educator';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-header">
        <span className="panel-title"><Activity size={13} /> Telemetry</span>
        <span className={`chip ${current.viable ? 'nominal' : 'blocked'}`}>{current.viable ? 'Window viable' : 'Window gap'}</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{site.shortName}</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{site.latitude.toFixed(3)}°, {site.longitude.toFixed(3)}° · {site.elevationM} m</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="panel" style={{ padding: 10, borderColor: current.sunVisibility.visible ? '#5c430f' : '#5c1d1d' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--solar)', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}><Sun size={12} /> {current.sunVisibility.visible ? 'Sunlit' : 'Dark'}</div>
            <div className="mono" style={{ fontSize: 16, marginTop: 6 }}>{sunNext ? formatDuration((sunNext.timeMs - timeMs) / 3_600_000) : '—'}</div>
            <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{current.sunVisibility.visible ? 'to sunset' : 'to sunrise'}{!sunNext ? ' · none in window' : ''}</div>
          </div>
          <div className="panel" style={{ padding: 10, borderColor: current.earthVisibility.visible ? '#0f4c5c' : '#5c1d1d' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--earth)', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}><Radio size={12} /> {current.earthVisibility.visible ? 'DTE open' : 'LOS'}</div>
            <div className="mono" style={{ fontSize: 16, marginTop: 6 }}>{summary?.earthNeverVisible ? 'NEVER' : earthNext ? formatDuration((earthNext.timeMs - timeMs) / 3_600_000) : '—'}</div>
            <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{summary?.earthNeverVisible ? 'far side · relay needed' : current.earthVisibility.visible ? 'to Earthset' : 'to AOS'}{!earthNext && !summary?.earthNeverVisible ? ' · none in window' : ''}</div>
          </div>
        </div>

        {educator && (
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, background: '#0c1017', border: '1px solid var(--border)', borderRadius: 5, padding: 10 }}>
            {current.sunVisibility.visible ? 'The lander can see the Sun and make power.' : current.sunVisibility.reason === 'terrain' ? 'The Sun is above the mathematical horizon, but a mountain is blocking it.' : 'The Sun is below the horizon — the lander is in lunar night.'}
            {' '}
            {current.earthVisibility.visible ? 'Earth is above the terrain, so the lander can radio home directly.' : summary?.earthNeverVisible ? 'This site is on the far side: Earth never rises. A relay satellite is required.' : 'Earth is hidden behind terrain right now, so direct radio contact is lost.'}
          </div>
        )}

        <section>
          <div className="panel-title" style={{ marginBottom: 8 }}><Sun size={12} color="var(--solar)" /> Solar illumination</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Stat label="Elevation" value={current.sun.elevationDeg.toFixed(2)} unit="deg" color="var(--solar)" />
            <Stat label="Azimuth" value={current.sun.azimuthDeg.toFixed(1)} unit="deg" />
            <Stat label="Terrain @ az" value={current.sunVisibility.terrainElevationDeg.toFixed(2)} unit="deg" />
            <Stat label="Clearance" value={current.sunVisibility.clearanceDeg.toFixed(2)} unit="deg" color={current.sunVisibility.visible ? 'var(--nominal)' : 'var(--blocked)'} />
            <Stat label="Solar flux" value={current.power.fluxWm2.toFixed(0)} unit="W/m²" />
            <Stat label="Incidence cos" value={current.power.verticalIncidence.toFixed(3)} />
          </div>
        </section>

        <section>
          <div className="panel-title" style={{ marginBottom: 8 }}><Zap size={12} color="var(--solar)" /> Array output</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="mono" style={{ fontSize: 30, fontWeight: 600, color: current.power.selectedW > config.loadW ? 'var(--nominal)' : 'var(--solar)' }}>{current.power.selectedW.toFixed(0)}</span>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>W · {config.arrayMode.replace('-', ' ')}</span>
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {([
              ['Horizontal deck', current.power.horizontalW, 'var(--solar)'],
              ['Vertical mast (tracking)', current.power.verticalTrackingW, 'var(--nominal)'],
              ['Vertical mast (fixed)', current.power.verticalFixedW, 'var(--earth)'],
            ] as const).map(([label, w, color]) => (
              <div key={label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}><span>{label}</span><span className="mono">{w.toFixed(0)} W</span></div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${maxW > 0 ? (w / maxW) * 100 : 0}%`, background: color }} /></div>
              </div>
            ))}
          </div>
          <button className="btn sm ghost" style={{ marginTop: 8, padding: 0 }} onClick={onSettings}>Array: {config.arrayAreaM2} m² · {(config.cellEfficiency * 100).toFixed(0)}% cells · {(config.systemDerate * 100).toFixed(0)}% derate →</button>
        </section>

        <section>
          <div className="panel-title" style={{ marginBottom: 8 }}><Earth size={12} color="var(--earth)" /> Direct-to-Earth</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Stat label="Elevation" value={current.earth.elevationDeg.toFixed(2)} unit="deg" color="var(--earth)" />
            <Stat label="Azimuth" value={current.earth.azimuthDeg.toFixed(1)} unit="deg" />
            <Stat label="Clearance" value={current.earthVisibility.clearanceDeg.toFixed(2)} unit="deg" color={current.earthVisibility.visible ? 'var(--nominal)' : 'var(--blocked)'} />
            <Stat label="Libration lat" value={current.libration.subEarthLatitudeDeg.toFixed(2)} unit="deg" />
            <Stat label="Libration lon" value={current.libration.subEarthLongitudeDeg.toFixed(2)} unit="deg" />
            <Stat label="Range" value={(current.earth.distanceKm / 1000).toFixed(1)} unit="×10³ km" />
            <Stat label="One-way light" value={(current.earth.distanceKm / LIGHT_SPEED_KMS).toFixed(2)} unit="s" />
            <Stat label="Comms margin" value={config.commsMarginDeg.toFixed(1)} unit="deg" />
          </div>
        </section>

        <section>
          <div className="panel-title" style={{ marginBottom: 8 }}><BatteryCharging size={12} color="var(--nominal)" /> Mission window · {config.durationDays} d</div>
          {summary ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                <Stat label="Sunlit" value={summary.illuminationPct.toFixed(0)} unit="%" color="var(--solar)" />
                <Stat label="DTE" value={summary.dtePct.toFixed(0)} unit="%" color="var(--earth)" />
                <Stat label="Both" value={summary.combinedPct.toFixed(0)} unit="%" color="var(--nominal)" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Stat label="Longest eclipse" value={formatDuration(summary.longestEclipseHours)} />
                <Stat label="Longest DTE gap" value={formatDuration(summary.longestDteGapHours)} />
                <Stat label="Min battery" value={summary.minBatterySocPct.toFixed(0)} unit="%" color={summary.minBatterySocPct <= 0 ? 'var(--blocked)' : 'var(--nominal)'} />
                <Stat label="Energy" value={summary.selectedEnergyKWh.toFixed(1)} unit="kWh" />
              </div>
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, padding: 10, border: '1px solid var(--border)', borderRadius: 6, background: '#0c1017' }}>
                <svg width={52} height={52} viewBox="0 0 52 52">
                  <circle cx={26} cy={26} r={22} fill="none" stroke="#1a212c" strokeWidth={5} />
                  <circle cx={26} cy={26} r={22} fill="none" stroke={verdictColor} strokeWidth={5} strokeDasharray={`${(summary.feasibilityScore / 100) * 138.2} 138.2`} strokeLinecap="round" transform="rotate(-90 26 26)" />
                  <text x={26} y={30} textAnchor="middle" fontSize={14} fill="#E6EAF2" fontFamily="JetBrains Mono, monospace">{summary.feasibilityScore}</text>
                </svg>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: verdictColor }}>
                    {summary.verdict === 'NOMINAL' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {summary.verdict}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.45, marginTop: 3 }}>{educator ? (summary.verdict === 'NOMINAL' ? 'This window looks good: power and radio contact overlap for most of the mission.' : summary.verdict === 'RELAY REQUIRED' ? 'Earth never rises here. The lander must talk through a relay satellite.' : 'This window has gaps. The team would need to store energy and schedule radio passes carefully.') : summary.verdictReason}</div>
                </div>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--dim)', display: 'flex', alignItems: 'center', gap: 6 }}><Clock size={12} className="pulse" /> Computing mission window…</div>
          )}
        </section>
      </div>
    </div>
  );
}
