import { useEffect, useMemo, useState } from 'react';
import { Columns2, Download, Pin, Plus, Trash2, X } from 'lucide-react';
import type { AppMode, LandingSite, Scenario } from '../types/mission';
import { useSimulation } from '../hooks/useSimulation';
import { cachedSimulation } from '../engine/simulationClient';
import { DAY_MS, formatCoord } from '../engine/constants';
import type { ComparisonRow } from '../utils/export';
import { COMPARISON_EXPORT_POLICY } from '../utils/export';
import { ProvenanceIndicator, provenanceOf } from './ProvenanceIndicator';
import { AnalysisStatusNotice, AnalysisStatusBadge, EnergyResolutionNotice } from './AnalysisStatusNotice';
import { UtcDateTimeInput } from './UtcDateTimeInput';

const CONF_RANK: Record<string, number> = { measured: 3, 'region-approximate': 2, illustrative: 1, synthetic: 0, mixed: 1 };
const CONF_LABEL: Record<string, string> = { measured: 'measured DEM', 'region-approximate': 'region approx.', illustrative: 'illustrative', synthetic: 'synthetic demo', mixed: 'mixed' };

interface Props {
  scenarios: Scenario[];
  sites: LandingSite[];
  onUpdate: (id: string, patch: Partial<Scenario>) => void;
  onRemove: (id: string) => void;
  onPin: () => void;
  onClose: () => void;
  onExport: (kind: 'csv' | 'json', rows: ComparisonRow[]) => void;
  mode: AppMode;
}

interface CardState { fp: string; loading: boolean; error: string | null }
const scenarioFp = (sc: Scenario) => `${sc.siteId}|${sc.startMs}|${JSON.stringify(sc.config)}`;

/** A scenario whose site no longer exists is shown explicitly — never computed
 *  against a silently-substituted site, and exported as MISSING_SITE. */
function MissingSiteCard({ scenario, sites, onUpdate, onRemove }: { scenario: Scenario; sites: LandingSite[]; onUpdate: Props['onUpdate']; onRemove: (id: string) => void }) {
  return (
    <div className="panel fade-in" style={{ display: 'flex', flexDirection: 'column', borderColor: 'var(--blocked)', minWidth: 0 }}>
      <div className="panel-header">
        <span className="panel-title" style={{ color: 'var(--blocked)' }}>Missing site</span>
        <button className="btn sm ghost icon" onClick={() => onRemove(scenario.id)} title="Remove scenario"><Trash2 size={12} /></button>
      </div>
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div role="alert" style={{ fontSize: 11, color: 'var(--blocked)', lineHeight: 1.5 }}>
          This scenario references site "{scenario.siteId}", which no longer exists in this workspace. No result is computed or exported for it. Reassign a site or remove the scenario.
        </div>
        <select className="input" value="" onChange={(e) => onUpdate(scenario.id, { siteId: e.target.value })} aria-label="Reassign scenario site">
          <option value="" disabled>Reassign to a site…</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.shortName}</option>)}
        </select>
      </div>
    </div>
  );
}

function ScenarioCard({ scenario, site, sites, onUpdate, onRemove, best, indicative, onState }: { scenario: Scenario; site: LandingSite; sites: LandingSite[]; onUpdate: Props['onUpdate']; onRemove: (id: string) => void; best: boolean; indicative?: boolean; onState: (id: string, state: CardState) => void }) {
  const { data: sim, loading, error } = useSimulation(site, scenario.startMs, scenario.startMs + scenario.config.durationDays * DAY_MS, scenario.config);
  // Report resolution state up so exports can distinguish COMPUTING / FAILED /
  // resolved rows explicitly (the cache alone cannot express failure).
  useEffect(() => {
    onState(scenario.id, { fp: scenarioFp(scenario), loading, error });
  }, [scenario, loading, error, onState]);
  const s = sim?.summary;
  const verdictColor = s?.verdict === 'NOMINAL' ? 'var(--nominal)' : s?.verdict === 'CONDITIONAL' ? 'var(--solar)' : 'var(--blocked)';
  const spark = useMemo(() => {
    if (!sim) return '';
    const n = 60;
    const stride = Math.max(1, Math.floor(sim.samples.length / n));
    const pts: string[] = [];
    for (let i = 0; i < sim.samples.length; i += stride) {
      const x = (i / sim.samples.length) * 100;
      const y = 20 - (sim.samples[i].viable ? 16 : 2);
      pts.push(`${x.toFixed(1)},${y}`);
    }
    return pts.join(' ');
  }, [sim]);

  return (
    <div className="panel fade-in" style={{ display: 'flex', flexDirection: 'column', borderColor: best ? '#1f7a52' : 'var(--border)', minWidth: 0 }}>
      <div className="panel-header">
        <span className="panel-title" style={{ color: best ? 'var(--nominal)' : undefined }}>{best ? (indicative ? '★ Best (indicative)' : '★ Best window') : scenario.label || site.shortName}</span>
        <button className="btn sm ghost icon" onClick={() => onRemove(scenario.id)} title="Remove scenario"><Trash2 size={12} /></button>
      </div>
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <select className="input" value={scenario.siteId} onChange={(e) => onUpdate(scenario.id, { siteId: e.target.value })}>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.shortName}</option>)}
        </select>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px', gap: 6, alignItems: 'start' }}>
          <UtcDateTimeInput valueMs={scenario.startMs} onChange={(t) => onUpdate(scenario.id, { startMs: t })} ariaPrefix="Scenario start" />
          <select className="input" value={scenario.config.durationDays} onChange={(e) => onUpdate(scenario.id, { config: { ...scenario.config, durationDays: Number(e.target.value) } })} aria-label="Scenario duration days">
            {[3, 7, 10, 14, 30, 90].map((d) => <option key={d} value={d}>{d} d</option>)}
          </select>
        </div>
        <select className="input" value={scenario.config.arrayMode} onChange={(e) => onUpdate(scenario.id, { config: { ...scenario.config, arrayMode: e.target.value as Scenario['config']['arrayMode'] } })}>
          <option value="horizontal">Horizontal deck</option>
          <option value="vertical-tracking">Vertical mast (tracking)</option>
          <option value="vertical-fixed">Vertical mast (fixed)</option>
        </select>
        <div className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>{formatCoord(site.latitude, site.longitude)}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <ProvenanceIndicator site={site} summary={s} compact />
          {sim?.analysis && <AnalysisStatusBadge analysis={sim.analysis} />}
          {s && <span className="chip neutral" style={{ fontSize: 8.5 }} title="Data confidence is separate from performance. Illustrative terrain is not ranked as measured.">{CONF_LABEL[s.dataConfidence] ?? s.dataConfidence}</span>}
        </div>

        {error ? (
          <div role="alert" style={{ fontSize: 11, color: 'var(--blocked)', lineHeight: 1.5 }}>COMPUTATION FAILED: {error}. No numbers are shown or exported for this scenario.</div>
        ) : sim?.analysis && !sim.analysis.demoEligible ? (
          <AnalysisStatusNotice analysis={sim.analysis} compact />
        ) : loading || !s ? (
          <div style={{ height: 180, display: 'grid', placeItems: 'center', color: 'var(--dim)', fontSize: 11 }} className="pulse">Computing…</div>
        ) : (
          <>
            <svg viewBox="0 0 100 22" style={{ width: '100%', height: 26, background: '#fffdf7', borderRadius: 3 }}>
              <polyline points={spark} fill="none" stroke="#1f7a52" strokeWidth={1.5} />
            </svg>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              <div className="metric sm"><span className="label">Sunlit</span><span className="value" style={{ color: 'var(--solar)' }}>{s.illuminationPct.toFixed(0)}<span className="unit">%</span></span></div>
              <div className="metric sm"><span className="label" title="Geometric Earth line-of-sight, not an RF link budget">Earth LOS</span><span className="value" style={{ color: 'var(--earth)' }}>{s.dtePct.toFixed(0)}<span className="unit">%</span></span></div>
              <div className="metric sm"><span className="label">Both</span><span className="value" style={{ color: 'var(--nominal)' }}>{s.combinedPct.toFixed(0)}<span className="unit">%</span></span></div>
            </div>
            <EnergyResolutionNotice summary={s} compact />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 10 }}>
              {([
                ['Mean Sun el', `${s.meanSunElevationDeg.toFixed(2)}°`],
                ['Peak Sun el', `${s.peakSunElevationDeg.toFixed(2)}°`],
                ['Flat array', `${s.meanHorizontalW.toFixed(0)} W`],
                ['Vertical mast', `${s.meanVerticalTrackingW.toFixed(0)} W`],
                ['Longest eclipse', `${s.longestEclipseHours.toFixed(1)} h`],
                ['Min battery', `${s.minBatterySocPct.toFixed(0)}%`],
              ] as const).map(([label, val]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #f3e6d0' }}>
                  <span style={{ color: 'var(--dim)' }}>{label}</span><span className="mono">{val}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, background: '#fffdf7', border: '1px solid var(--border)', borderRadius: 5 }}>
              <span className="mono" style={{ fontSize: 20, fontWeight: 600, color: verdictColor }}>{s.feasibilityScore}</span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: verdictColor }}>{s.verdict}</div>
                <div style={{ fontSize: 9, color: 'var(--dim)' }}>{s.earthNeverVisible ? 'Far side · relay required' : `${s.combinedPct.toFixed(0)}% simultaneous power + Earth LOS · heuristic`}</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function ComparisonMatrix({ scenarios, sites, onUpdate, onRemove, onPin, onClose, onExport, mode }: Props) {
  const [cardStates, setCardStates] = useState<Record<string, CardState>>({});
  const onCardState = useMemo(() => (id: string, state: CardState) => {
    setCardStates((prev) => (prev[id]?.fp === state.fp && prev[id]?.loading === state.loading && prev[id]?.error === state.error ? prev : { ...prev, [id]: state }));
  }, []);
  const rows: ComparisonRow[] = scenarios.map((sc) => {
    // Missing sites are NEVER silently substituted with sites[0].
    const site = sites.find((s) => s.id === sc.siteId) ?? null;
    const st = cardStates[sc.id];
    const fresh = st && st.fp === scenarioFp(sc) ? st : null;
    return {
      scenario: sc, site,
      sim: site ? cachedSimulation(site, sc.startMs, sc.startMs + sc.config.durationDays * DAY_MS, sc.config) ?? null : null,
      loading: fresh?.loading ?? false,
      error: fresh?.error ?? null,
    };
  });
  // Rank only within the highest data-confidence tier present, so illustrative or
  // synthetic terrain is never crowned "best" over a measured DEM. When the top tier
  // is not measured, the ranking is flagged indicative.
  const { bestId, bestIndicative } = useMemo(() => {
    // Only results with a quantitative summary are rankable; blocked analyses (null
    // summary) are excluded so an invalid dataset can never win a candidate ranking.
    const rankable = rows.filter((r) => r.sim?.summary).map((r) => ({ id: r.scenario.id, summary: r.sim!.summary! }));
    if (rankable.length === 0) return { bestId: null as string | null, bestIndicative: false };
    const topRank = Math.max(...rankable.map((r) => CONF_RANK[r.summary.dataConfidence] ?? 0));
    let best: string | null = null;
    let score = -1;
    for (const r of rankable) {
      if ((CONF_RANK[r.summary.dataConfidence] ?? 0) !== topRank) continue;
      if (r.summary.feasibilityScore > score) { score = r.summary.feasibilityScore; best = r.id; }
    }
    return { bestId: best, bestIndicative: topRank < CONF_RANK.measured };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarios, sites]);
  return (
    <section className="panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div className="panel-header">
        <span className="panel-title"><Columns2 size={13} /> Scenario comparison · {scenarios.length}/4 pinned</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn sm primary" onClick={onPin} disabled={scenarios.length >= 4}><Pin size={12} /> Pin current</button>
          <button className="btn sm" onClick={() => onExport('csv', rows)} disabled={!scenarios.length} title={COMPARISON_EXPORT_POLICY}><Download size={12} /> CSV</button>
          <button className="btn sm" onClick={() => onExport('json', rows)} disabled={!scenarios.length} title={COMPARISON_EXPORT_POLICY}><Download size={12} /> JSON</button>
          <button className="btn sm ghost icon" onClick={onClose}><X size={13} /></button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {mode === 'educator' && (
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5, background: '#fffdf7', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
            Each column is one landing site + start date + solar array choice. Green means the lander can both make power and talk to Earth. Pin Apollo 11 next to a polar site to see why the pole is so different.
          </div>
        )}
        {scenarios.length === 0 ? (
          <div style={{ display: 'grid', placeItems: 'center', height: 240, color: 'var(--dim)', textAlign: 'center' }}>
            <div>
              <Plus size={28} style={{ margin: '0 auto 10px', opacity: 0.5 }} />
              <div style={{ fontSize: 13, marginBottom: 6 }}>No scenarios pinned</div>
              <div style={{ fontSize: 11 }}>Select a site and press “Pin current”, or use the button above.</div>
            </div>
          </div>
        ) : (
          <>
            {scenarios.length > 1 && (
              <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', marginBottom: 8 }}>
                Scores are application-defined heuristics. "Best" is ranked only within the highest data-confidence tier present{bestIndicative ? ' (indicative — no measured DEM in this comparison)' : ''}; illustrative terrain is not ranked as measured. Earth LOS is geometric, not an RF link budget.
              </div>
            )}
            <div role="note" aria-label="Comparison export policy" style={{ fontSize: 9.5, color: 'var(--dim)', marginBottom: 8, lineHeight: 1.5 }}>
              Exports include every pinned row with an explicit resolution state (valid / computing / blocked / failed / missing site / stale). Unresolved rows carry no numbers — blank cells are never zeros and never an implicit status.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(scenarios.length, 4)}, minmax(220px, 1fr))`, gap: 10 }}>
              {scenarios.map((sc) => {
                const site = sites.find((x) => x.id === sc.siteId);
                return site
                  ? <ScenarioCard key={sc.id} scenario={sc} site={site} sites={sites} onUpdate={onUpdate} onRemove={onRemove} best={sc.id === bestId && scenarios.length > 1} indicative={bestIndicative} onState={onCardState} />
                  : <MissingSiteCard key={sc.id} scenario={sc} sites={sites} onUpdate={onUpdate} onRemove={onRemove} />;
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
