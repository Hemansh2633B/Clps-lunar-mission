import { Activity, BatteryCharging, Clock, Earth, Radio, Sun, Zap, AlertTriangle, CheckCircle2, Scale } from 'lucide-react';
import type { AppMode, EvaluatedSample, LandingSite, MissionConfig, SimulationResult, TransitionEvent } from '../types/mission';
import { formatDuration, LIGHT_SPEED_KMS } from '../engine/constants';
import { ProvenanceIndicator } from './ProvenanceIndicator';
import { AnalysisStatusNotice } from './AnalysisStatusNotice';
import { InfoTip } from './InfoTip';
import { explainClearance, explainIllumination, explainEarthLos } from '../utils/explain';

interface Props {
  site: LandingSite;
  current: EvaluatedSample;
  sim: SimulationResult | null;
  events: TransitionEvent[];
  timeMs: number;
  mode: AppMode;
  config: MissionConfig;
  onSettings: () => void;
  loading?: boolean;
  error?: string | null;
  progress?: { phase: 'sampling' | 'transitions' | 'energy' | 'summary'; fraction: number } | null;
  /** Instantaneous frame/coverage gate (epoch-aware), independent of the window analysis. */
  visibilityBlocked?: boolean;
}

const PHASE_LABEL: Record<string, string> = {
  sampling: 'Sampling illumination & visibility',
  transitions: 'Refining rise/set transitions',
  energy: 'Integrating power & battery',
  summary: 'Summarizing mission window',
};

function nextEvent(events: TransitionEvent[], body: 'sun' | 'earth', timeMs: number, wantVisible: boolean) {
  return events.find((e) => e.body === body && e.timeMs > timeMs && e.visible === wantVisible) ?? null;
}

function Stat({ label, value, unit, color, tip }: { label: string; value: string; unit?: string; color?: string; tip?: string }) {
  return (
    <div className="metric sm">
      <span className="label" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>{label}{tip && <InfoTip id={tip} />}</span>
      <span className="value" style={{ color }}>{value}{unit && <span className="unit">{unit}</span>}</span>
    </div>
  );
}

export function TelemetryPanel({ site, current, sim, events, timeMs, mode, config, onSettings, loading, error, progress, visibilityBlocked }: Props) {
  const sunNext = nextEvent(events, 'sun', timeMs, !current.sunVisibility.visible);
  const earthNext = nextEvent(events, 'earth', timeMs, !current.earthVisibility.visible);
  const summary = sim?.summary;
  const maxW = current.power.fluxWm2 * config.arrayAreaM2 * config.cellEfficiency * config.systemDerate;
  const verdictColor = summary?.verdict === 'NOMINAL' ? 'var(--nominal)' : summary?.verdict === 'CONDITIONAL' ? 'var(--solar)' : 'var(--blocked)';
  const educator = mode === 'educator';
  const blocked = !!sim?.analysis && !sim.analysis.demoEligible;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-header">
        <span className="panel-title"><Activity size={13} /> Telemetry</span>
        <span className={`chip ${visibilityBlocked ? 'blocked' : current.viable ? 'nominal' : 'blocked'}`}>{visibilityBlocked ? 'Visibility blocked' : current.viable ? 'Window viable' : 'Window gap'}</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{site.shortName}</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{site.latitude.toFixed(3)}°, {site.longitude.toFixed(3)}° · {site.elevationM} m</div>
          {site.program && <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 2 }}>{site.program}{site.coordinateType ? ` · ${site.coordinateType}` : ''}</div>}
        </div>

        <ProvenanceIndicator site={site} summary={summary} />

        {sim?.analysis && <AnalysisStatusNotice analysis={sim.analysis} />}
        {visibilityBlocked && !blocked && (
          <div role="note" style={{ fontSize: 10.5, lineHeight: 1.5, color: 'var(--blocked)', border: '1px solid var(--blocked)', padding: '8px 10px', background: '#fbeae5' }}>
            Instantaneous terrain visibility is blocked at this epoch — the frame correction is not validated here. Sky positions (elevation/azimuth) remain valid; scrub into the validated range for visibility.
          </div>
        )}

        {!blocked && !visibilityBlocked && (<>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="panel" style={{ padding: 10, borderColor: current.sunVisibility.visible ? '#d9b877' : '#e0a99f' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--solar)', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}><Sun size={12} /> {current.sunVisibility.visible ? 'Sunlit' : 'Dark'}</div>
            <div className="mono" style={{ fontSize: 16, marginTop: 6 }}>{sunNext ? formatDuration((sunNext.timeMs - timeMs) / 3_600_000) : '—'}</div>
            <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{current.sunVisibility.visible ? 'to sunset' : 'to sunrise'}{!sunNext ? ' · none in window' : ''}</div>
          </div>
          <div className="panel" style={{ padding: 10, borderColor: current.earthVisibility.visible ? '#9fc6d2' : '#e0a99f' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--earth)', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}><Radio size={12} /> {current.earthVisibility.visible ? 'DTE open' : 'Earth blocked'}</div>
            <div className="mono" style={{ fontSize: 16, marginTop: 6 }}>{summary?.earthNeverVisible ? 'NEVER' : earthNext ? formatDuration((earthNext.timeMs - timeMs) / 3_600_000) : '—'}</div>
            <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{summary?.earthNeverVisible ? 'far side · relay needed' : current.earthVisibility.visible ? 'to Earthset' : 'to AOS'}{!earthNext && !summary?.earthNeverVisible ? ' · none in window' : ''}</div>
          </div>
        </div>

        <details open={educator} style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, background: '#fffdf7', border: '1px solid var(--border)', borderRadius: 5, padding: '8px 10px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 10.5, color: 'var(--ink-soft)', listStyle: 'none' }}>What the current sky means</summary>
          <div style={{ marginTop: 6 }}>
            {explainClearance('Sun', current.sunVisibility)} {explainClearance('Earth', current.earthVisibility)}
          </div>
        </details>

        <section>
          <div className="panel-title" style={{ marginBottom: 8 }}><Sun size={12} color="var(--solar)" /> Solar illumination</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Stat label="Elevation" value={current.sun.elevationDeg.toFixed(2)} tip="sun-elevation" unit="deg" color="var(--solar)" />
            <Stat label="Azimuth" value={current.sun.azimuthDeg.toFixed(1)} tip="sun-azimuth" unit="deg" />
            <Stat label="Terrain @ az" value={current.sunVisibility.terrainElevationDeg.toFixed(2)} tip="horizon-elevation" unit="deg" />
            <Stat label="Clearance" value={current.sunVisibility.clearanceDeg.toFixed(2)} tip="clearance" unit="deg" color={current.sunVisibility.visible ? 'var(--nominal)' : 'var(--blocked)'} />
            <Stat label="Solar flux" value={current.power.fluxWm2.toFixed(0)} tip="solar-flux" unit="W/m²" />
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
          <p style={{ fontSize: 9.5, color: 'var(--dim)', lineHeight: 1.45, marginTop: 7 }}>
            Instantaneous array power (W), not net energy. Idealized model: flux 1361/au² W/m²; horizontal deck ∝ sin(el), tracking mast ∝ cos(el), fixed mast ∝ cos(el)·cos(Δaz); zero output when the Sun is terrain-occulted. No temperature, dust, or degradation effects.
          </p>
        </section>

        <section>
          <div className="panel-title" style={{ marginBottom: 8 }}><Earth size={12} color="var(--earth)" /> Direct-to-Earth</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Stat label="Elevation" value={current.earth.elevationDeg.toFixed(2)} tip="earth-elevation" unit="deg" color="var(--earth)" />
            <Stat label="Azimuth" value={current.earth.azimuthDeg.toFixed(1)} tip="earth-azimuth" unit="deg" />
            <Stat label="Clearance" value={current.earthVisibility.clearanceDeg.toFixed(2)} tip="clearance" unit="deg" color={current.earthVisibility.visible ? 'var(--nominal)' : 'var(--blocked)'} />
            <Stat label="Libration lat" value={current.libration.subEarthLatitudeDeg.toFixed(2)} tip="libration" unit="deg" />
            <Stat label="Libration lon" value={current.libration.subEarthLongitudeDeg.toFixed(2)} tip="libration" unit="deg" />
            <Stat label="Range" value={(current.earth.distanceKm / 1000).toFixed(1)} unit="×10³ km" />
            <Stat label="One-way light" value={(current.earth.distanceKm / LIGHT_SPEED_KMS).toFixed(2)} unit="s" />
            <Stat label="Comms margin" value={config.commsMarginDeg.toFixed(1)} unit="deg" />
          </div>
          <p style={{ fontSize: 9.5, color: 'var(--dim)', lineHeight: 1.45, marginTop: 7 }}>
            Geometric Earth line-of-sight only — <strong>not an RF link budget</strong>. No antenna gain, transmit power, coding, or pointing loss is modeled; "DTE open" means Earth clears the terrain, not that a radio link is closed.
          </p>
        </section>

        <section>
          <div className="panel-title" style={{ marginBottom: 8 }}><BatteryCharging size={12} color="var(--nominal)" /> Mission window · {config.durationDays} d</div>
          {summary ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                <Stat label="Sunlit" value={summary.illuminationPct.toFixed(0)} tip="illumination" unit="%" color="var(--solar)" />
                <Stat label="DTE" value={summary.dtePct.toFixed(0)} tip="dte" unit="%" color="var(--earth)" />
                <Stat label="Both" value={summary.combinedPct.toFixed(0)} tip="combined" unit="%" color="var(--nominal)" />
              </div>
              <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 10px' }}>
                {explainIllumination(summary.illuminationPct)} {explainEarthLos(summary.dtePct, summary.earthNeverVisible)}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Stat label="Longest eclipse" value={formatDuration(summary.longestEclipseHours)} />
                <Stat label="Longest DTE gap" value={formatDuration(summary.longestDteGapHours)} />
                <Stat label="Min battery" value={summary.minBatterySocPct.toFixed(0)} tip="soc" unit="%" color={summary.minBatterySocPct <= 0 ? 'var(--blocked)' : 'var(--nominal)'} />
                <Stat label="Energy" value={summary.selectedEnergyKWh.toFixed(1)} unit="kWh" />
              </div>
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, padding: 10, border: '1px solid var(--border)', borderRadius: 6, background: '#fffdf7' }}>
                <svg width={52} height={52} viewBox="0 0 52 52">
                  <circle cx={26} cy={26} r={22} fill="none" stroke="#f3e6d0" strokeWidth={5} />
                  <circle cx={26} cy={26} r={22} fill="none" stroke={verdictColor} strokeWidth={5} strokeDasharray={`${(summary.feasibilityScore / 100) * 138.2} 138.2`} strokeLinecap="round" transform="rotate(-90 26 26)" />
                  <text x={26} y={30} textAnchor="middle" fontSize={14} fill="#1c2430" fontFamily="IBM Plex Mono, monospace">{summary.feasibilityScore}</text>
                </svg>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: verdictColor }}>
                    {summary.verdict === 'NOMINAL' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {summary.verdict}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.45, marginTop: 3 }}>{educator ? (summary.verdict === 'NOMINAL' ? 'This window looks good: power and Earth line-of-sight overlap for most of the mission.' : summary.verdict === 'RELAY REQUIRED' ? 'Earth never rises here. The lander must talk through a relay satellite.' : summary.verdict === 'ENERGY DEFICIT' ? 'The battery model runs out of stored energy before the window ends — more array area or less load is needed.' : 'This window has gaps. The team would need to store energy and schedule Earth-visibility passes carefully.') : summary.verdictReason}</div>
                </div>
              </div>

              <details style={{ marginTop: 10, border: '1px solid var(--border)', background: '#fffdf7', borderRadius: 6 }}>
                <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', fontSize: 11, fontWeight: 600, color: 'var(--ink-soft)' }}>
                  <Scale size={12} /> How this score is computed <span className="chip" style={{ marginLeft: 'auto', fontSize: 8.5 }}>heuristic</span>
                </summary>
                <div style={{ padding: '0 10px 9px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                    <thead>
                      <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                        <th style={{ padding: '3px 4px', fontWeight: 600 }}>Component</th>
                        <th style={{ padding: '3px 4px', fontWeight: 600, textAlign: 'right' }}>Value</th>
                        <th style={{ padding: '3px 4px', fontWeight: 600, textAlign: 'right' }}>Weight</th>
                        <th style={{ padding: '3px 4px', fontWeight: 600, textAlign: 'right' }}>Points</th>
                      </tr>
                    </thead>
                    <tbody className="mono">
                      {summary.scoreBreakdown.components.map((c) => (
                        <tr key={c.key} style={{ borderTop: '1px dashed var(--border)' }}>
                          <td style={{ padding: '3px 4px', fontFamily: 'Outfit, sans-serif' }}>{c.label}</td>
                          <td style={{ padding: '3px 4px', textAlign: 'right' }}>{c.valuePct.toFixed(1)}%</td>
                          <td style={{ padding: '3px 4px', textAlign: 'right' }}>×{c.weight.toFixed(2)}</td>
                          <td style={{ padding: '3px 4px', textAlign: 'right' }}>{c.contribution.toFixed(1)}</td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: '1px solid var(--ink)', fontWeight: 700 }}>
                        <td style={{ padding: '3px 4px', fontFamily: 'Outfit, sans-serif' }}>Total (rounded)</td>
                        <td /><td style={{ padding: '3px 4px', textAlign: 'right' }}>Σ{summary.scoreBreakdown.weightsSum.toFixed(2)}</td>
                        <td style={{ padding: '3px 4px', textAlign: 'right' }}>{summary.feasibilityScore}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p style={{ fontSize: 9.5, color: 'var(--dim)', lineHeight: 1.45, marginTop: 7 }}>{summary.scoreBreakdown.note}</p>
                  <p style={{ fontSize: 9.5, color: 'var(--dim)', lineHeight: 1.45, marginTop: 4 }}>
                    Data confidence: <strong>{summary.dataConfidence}</strong> (separate from performance). Battery component is an energy-balance model (charge η 0.92 / discharge η 0.95, hard SOC bounds) — <strong>not thermal survival</strong>.
                  </p>
                </div>
              </details>
            </>
          ) : error ? (
            <div role="alert" style={{ fontSize: 11, color: 'var(--blocked)', display: 'flex', alignItems: 'flex-start', gap: 6, lineHeight: 1.45 }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> Mission window failed: {error}
            </div>
          ) : loading ? (
            <div style={{ fontSize: 11, color: 'var(--dim)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Clock size={12} className="pulse" /> {progress ? PHASE_LABEL[progress.phase] : 'Computing mission window'}…</span>
              <div role="progressbar" aria-label="Mission window computation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ? Math.round(progress.fraction * 100) : undefined}
                style={{ height: 5, background: 'var(--panel-2)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: progress ? `${Math.round(progress.fraction * 100)}%` : '30%', background: 'var(--navy)', transition: 'width .2s ease', animation: progress ? undefined : 'pulse 1.2s ease-in-out infinite' }} />
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--dim)', display: 'flex', alignItems: 'center', gap: 6 }}><Clock size={12} /> No mission window yet — adjust the start date or duration.</div>
          )}
        </section>
        </>)}
      </div>
    </div>
  );
}
