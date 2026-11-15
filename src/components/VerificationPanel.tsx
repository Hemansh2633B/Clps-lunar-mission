import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, Radio, ShieldCheck } from 'lucide-react';
import type { LandingSite } from '../types/mission';
import recorded from '../verification/recordedHorizons.json';
import {
  MAX_VERIFY_SAMPLES, VERDICT_TEXT, VERIFICATION_CONVENTIONS, VERIFY_TOLERANCE, buildReport, buildVerifyRequest, compareWithHorizons,
  engineDeltaTSeconds, horizonsSiteFor,
  type Comparison, type HorizonsTarget, type HorizonsTargetName, type HorizonsVerifyResponse, type Verdict,
} from '../verification/horizons';
import { ApiError, BackendUnavailableError, terrainApi } from '../terrain/api';
import { LANDING_SITES } from '../data/landingSites';
import { formatCoord, formatUTC } from '../engine/constants';
import { download } from '../utils/export';
import { APP_VERSION } from '../version';
import { UtcDateTimeInput } from './UtcDateTimeInput';

interface Props {
  site: LandingSite;
  timeMs: number;
  notify: (msg: string) => void;
}

const recordedTables = recorded.targets as unknown as Record<HorizonsTargetName, HorizonsTarget>;
const recordedSite = LANDING_SITES.find((s) => s.id === recorded.site.chandra_site_id) ?? null;
const TARGETS: HorizonsTargetName[] = ['sun', 'earth'];
const VERDICT_CHIP: Record<Verdict, string> = { agree: 'nominal', review: 'solar', disagree: 'blocked' };

type LiveState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; kind: 'offline' | 'disabled' | 'limited' | 'upstream' | 'invalid' | 'mismatch'; message: string }
  | { phase: 'done'; response: HorizonsVerifyResponse; comparisons: Comparison[]; site: LandingSite };

function SummaryTable({ comparisons, tables }: { comparisons: Comparison[]; tables: Partial<Record<HorizonsTargetName, HorizonsTarget>> }) {
  return (
    <div className="hscroll" data-hscroll tabIndex={0} role="region" aria-label="Verification summary table">
      <table className="table" data-testid="verification-summary">
        <thead>
          <tr><th>Target</th><th>Samples</th><th>max |Δ elevation|</th><th>max |Δ azimuth|</th><th>max separation</th><th>RMS separation</th><th>max |Δ range|</th><th>Result</th></tr>
        </thead>
        <tbody>
          {comparisons.map((c) => (
            <tr key={c.target} data-target={c.target} data-verdict={c.verdict}>
              <td>{c.target === 'sun' ? 'Sun' : 'Earth'} <span style={{ color: 'var(--dim)' }}>· {tables[c.target]?.ephemeris_source}</span></td>
              <td>{c.rows.length}</td>
              <td>{c.maxAbsElevationDeg.toFixed(4)}°</td>
              <td>{c.maxAbsAzimuthDeg.toFixed(4)}°</td>
              <td>{c.maxSeparationDeg.toFixed(4)}°</td>
              <td>{c.rmsSeparationDeg.toFixed(4)}°</td>
              <td>{c.maxAbsRangeKm.toFixed(1)} km <span style={{ color: 'var(--dim)' }}>({(c.maxRelativeRange * 100).toFixed(4)} %)</span></td>
              <td><span className={`chip ${VERDICT_CHIP[c.verdict]}`}>{c.verdict === 'agree' ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />} {VERDICT_TEXT[c.verdict]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResidualRows({ comparison }: { comparison: Comparison }) {
  const [open, setOpen] = useState(false);
  const rows = open ? comparison.rows : comparison.rows.slice(0, 6);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{comparison.target === 'sun' ? 'Sun' : 'Earth'} · CHANDRA − Horizons at each Horizons instant</div>
      <div className="hscroll" data-hscroll tabIndex={0} role="region" aria-label={`${comparison.target === 'sun' ? 'Sun' : 'Earth'} residuals table`}
        style={{ maxHeight: open ? 320 : undefined, overflowY: open ? 'auto' : undefined }}>
        <table className="table">
          <thead><tr><th>UTC</th><th>CHANDRA az / el</th><th>Horizons az / el (IAU frame)</th><th>Δ az</th><th>Δ el</th><th>Separation</th><th>Δ range</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.utc}>
                <td>{r.utc.replace('.000Z', 'Z')}</td>
                <td>{r.chandraAzimuthDeg.toFixed(4)}° / {r.chandraElevationDeg.toFixed(4)}°</td>
                <td>{r.horizonsAzimuthDeg.toFixed(4)}° / {r.horizonsElevationDeg.toFixed(4)}°</td>
                <td>{r.dAzimuthDeg.toFixed(4)}°</td>
                <td>{r.dElevationDeg.toFixed(4)}°</td>
                <td>{r.separationDeg.toFixed(4)}°</td>
                <td>{r.dRangeKm.toFixed(1)} km</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {comparison.rows.length > 6 && (
        <button className="btn sm ghost" style={{ marginTop: 4 }} aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? 'Show first rows only' : `Show all ${comparison.rows.length} rows`}</button>
      )}
    </div>
  );
}

function classifyError(err: unknown): Extract<LiveState, { phase: 'error' }> {
  if (err instanceof BackendUnavailableError) {
    return { phase: 'error', kind: 'offline', message: 'The CHANDRA backend is not reachable, so Horizons cannot be queried from here. The recorded reference above still works offline. Start the backend with npm run dev:api, or use a deployment that includes the API function.' };
  }
  if (err instanceof ApiError) {
    if (err.status === 503) return { phase: 'error', kind: 'disabled', message: err.message };
    if (err.status === 429) return { phase: 'error', kind: 'limited', message: `${err.message}${err.retryAfterS ? ` Retry in about ${Math.ceil(err.retryAfterS)} s.` : ''}` };
    if (err.status === 502 || err.status === 504) return { phase: 'error', kind: 'upstream', message: `${err.message} JPL Horizons did not return a usable answer; nothing was compared. The simulation is unaffected.` };
    return { phase: 'error', kind: 'invalid', message: err.message };
  }
  return { phase: 'error', kind: 'mismatch', message: err instanceof Error ? err.message : String(err) };
}

export function VerificationPanel({ site, timeMs, notify }: Props) {
  const recordedResult = useMemo(() => {
    if (!recordedSite) return null;
    try { return TARGETS.map((t) => compareWithHorizons(recordedSite, t, recordedTables[t])); }
    catch { return null; }
  }, []);

  const [startMs, setStartMs] = useState(() => Math.floor(timeMs / 3_600_000) * 3_600_000);
  const [stepMinutes, setStepMinutes] = useState(360);
  const [samples, setSamples] = useState(40);
  const [live, setLive] = useState<LiveState>({ phase: 'idle' });

  const horizonsSite = useMemo(() => horizonsSiteFor(site), [site]);
  const samplesError = !Number.isInteger(samples) || samples < 2 || samples > MAX_VERIFY_SAMPLES ? `Samples must be a whole number from 2 to ${MAX_VERIFY_SAMPLES}.` : null;
  const spanHours = ((samples - 1) * stepMinutes) / 60;

  const run = async () => {
    let body: ReturnType<typeof buildVerifyRequest>;
    try { body = buildVerifyRequest(site, startMs, stepMinutes, samples); }
    catch (err) { setLive({ phase: 'error', kind: 'invalid', message: err instanceof Error ? err.message : String(err) }); return; }
    setLive({ phase: 'loading' });
    try {
      const response = await terrainApi.verifyEphemeris(body);
      const comparisons = TARGETS.filter((t) => response.targets[t]).map((t) => compareWithHorizons(site, t, response.targets[t]!));
      if (comparisons.length === 0) throw new Error('Horizons returned no targets.');
      setLive({ phase: 'done', response, comparisons, site });
    } catch (err) {
      setLive(classifyError(err));
    }
  };

  const exportReport = (source: 'recorded' | 'live') => {
    if (source === 'recorded' && recordedResult && recordedSite) {
      download('chandra-horizons-verification-recorded.json', JSON.stringify(buildReport('recorded', recordedSite.name, recordedSite, recordedResult, recordedTables, APP_VERSION, Date.now()), null, 2), 'application/json');
    } else if (source === 'live' && live.phase === 'done') {
      download(`chandra-horizons-verification-${live.site.id}.json`, JSON.stringify(buildReport('live', live.site.name, live.site, live.comparisons, live.response.targets, APP_VERSION, Date.now()), null, 2), 'application/json');
    } else return;
    notify('Verification report downloaded — sky geometry only, terrain is not part of this check.');
  };

  const firstRecorded = recordedTables.sun.rows[0];

  return (
    <div className="hub-section" data-testid="verification-panel">
      <div className="hub-callout">
        <ShieldCheck size={16} aria-hidden="true" />
        <div>
          <strong>Independent check of Sun and Earth sky positions against NASA/JPL Horizons.</strong>{' '}
          Horizons is a second opinion, not CHANDRA's engine: the mission simulation never depends on it. It has no terrain model, so it can
          confirm where the Sun and Earth are in the sky — never whether terrain hides them.
        </div>
      </div>

      <section className="hub-card" aria-labelledby="verify-recorded-title">
        <div className="hub-card-head">
          <h3 id="verify-recorded-title">Recorded reference · works offline</h3>
          <span className="chip neutral">Recorded {recorded.recorded_utc}</span>
        </div>
        {recordedResult && recordedSite ? (
          <>
            <p className="hub-text">
              {recordedSite.name} ({formatCoord(recordedSite.latitude, recordedSite.longitude)}, IAU 2015) asked of Horizons as MEAN_ME{' '}
              <span className="mono">{recorded.site.latitude_deg.toFixed(6)}°, {recorded.site.east_longitude_deg.toFixed(6)}°E, {recorded.site.altitude_km} km</span>.
              {' '}{recordedResult[0].rows.length} instants every 12 h from {formatUTC(Date.parse(firstRecorded.utc))}. The response text is stored in the repository and re-checked by the test suite.
            </p>
            <SummaryTable comparisons={recordedResult} tables={recordedTables} />
            {recordedResult.map((c) => <ResidualRows key={c.target} comparison={c} />)}
            <div className="hub-actions">
              <button className="btn sm" onClick={() => exportReport('recorded')}><Download size={12} /> Download report (JSON)</button>
              <span className="hub-meta">{recordedTables.sun.generated}</span>
            </div>
          </>
        ) : (
          <p className="hub-text" role="alert">The recorded reference could not be evaluated in this build.</p>
        )}
      </section>

      <section className="hub-card" aria-labelledby="verify-live-title">
        <div className="hub-card-head">
          <h3 id="verify-live-title"><Radio size={13} aria-hidden="true" /> Live check for the selected site</h3>
          <span className="chip neutral">Runs through the CHANDRA backend</span>
        </div>
        <p className="hub-text">
          <strong>{site.name}</strong> · IAU 2015 {formatCoord(site.latitude, site.longitude)}, {site.elevationM.toFixed(0)} m, queried as Horizons MEAN_ME{' '}
          <span className="mono">{horizonsSite.latitude_deg.toFixed(6)}°, {horizonsSite.east_longitude_deg.toFixed(6)}°E, {horizonsSite.altitude_km.toFixed(3)} km</span>
          {' '}(local-north offset {horizonsSite.azimuthOffsetDeg.toFixed(4)}°). The backend sends this one fixed query shape to ssd.jpl.nasa.gov; no other host can be requested.
        </p>
        <div className="hub-form">
          <div className="field"><UtcDateTimeInput valueMs={startMs} onChange={setStartMs} ariaPrefix="Verification start" /></div>
          <div className="field"><label htmlFor="verify-step">Step</label>
            <select id="verify-step" className="input" value={stepMinutes} onChange={(e) => setStepMinutes(Number(e.target.value))}>
              <option value={60}>1 hour</option><option value={120}>2 hours</option><option value={360}>6 hours</option><option value={720}>12 hours</option><option value={1440}>24 hours</option>
            </select>
          </div>
          <div className="field"><label htmlFor="verify-samples">Samples (max {MAX_VERIFY_SAMPLES})</label>
            <input id="verify-samples" className="input mono" type="number" min={2} max={MAX_VERIFY_SAMPLES} step={1} value={Number.isFinite(samples) ? samples : ''} aria-invalid={!!samplesError}
              onChange={(e) => setSamples(e.target.value === '' ? NaN : Number(e.target.value))} style={{ width: 110 }} />
          </div>
          <button className="btn primary" disabled={live.phase === 'loading' || !!samplesError} onClick={() => void run()}>
            {live.phase === 'loading' ? 'Querying Horizons…' : 'Query JPL Horizons'}
          </button>
        </div>
        <div className="hub-meta" style={{ marginTop: 6 }}>
          {samplesError ?? `Covers ${spanHours >= 48 ? `${(spanHours / 24).toFixed(1)} days` : `${spanHours.toFixed(0)} hours`} · two requests (Sun, Earth) · responses are cached for 24 h.`}
        </div>

        <div aria-live="polite" data-testid="verification-live" data-phase={live.phase}>
          {live.phase === 'loading' && <p className="hub-text" role="status">Waiting for JPL Horizons…</p>}
          {live.phase === 'error' && (
            <div className="hub-alert" role="alert" data-kind={live.kind}>
              <AlertTriangle size={14} aria-hidden="true" />
              <div>
                <strong>{{ offline: 'Backend offline', disabled: 'Horizons verification is switched off', limited: 'Rate limited', upstream: 'JPL Horizons unavailable', invalid: 'Request not accepted', mismatch: 'Response not comparable' }[live.kind]}.</strong>{' '}
                {live.message}
              </div>
            </div>
          )}
          {live.phase === 'done' && (
            <>
              <SummaryTable comparisons={live.comparisons} tables={live.response.targets} />
              {live.comparisons.map((c) => <ResidualRows key={c.target} comparison={c} />)}
              <dl className="hub-fields" style={{ marginTop: 10 }}>
                {TARGETS.filter((t) => live.response.targets[t]).map((t) => {
                  const table = live.response.targets[t]!;
                  return (
                    <div key={t} style={{ gridColumn: '1 / -1' }}>
                      <dt>{t === 'sun' ? 'Sun' : 'Earth'} request</dt>
                      <dd>
                        {table.retrieved_utc ? `Retrieved ${table.retrieved_utc}` : 'Retrieval time not reported'} · cache {table.cache ?? 'not reported'} · {table.center_frame} · {table.ephemeris_source}
                        {table.response_sha256 && <> · SHA-256 <span className="mono">{table.response_sha256.slice(0, 16)}…</span></>}
                        {table.request_url && <> · <a href={table.request_url} target="_blank" rel="noopener noreferrer">exact Horizons query <ExternalLink size={10} /></a></>}
                      </dd>
                    </div>
                  );
                })}
                <div style={{ gridColumn: '1 / -1' }}>
                  <dt>Time scales</dt>
                  <dd>
                    Horizons TDB − UT {live.response.targets.sun?.rows[0]?.tdb_minus_ut_s?.toFixed(3) ?? live.response.targets.earth?.rows[0]?.tdb_minus_ut_s?.toFixed(3) ?? 'not reported'} s ·
                    CHANDRA engine TT − UT {engineDeltaTSeconds(Date.parse(live.comparisons[0].rows[0].utc)).toFixed(3)} s (predicted ΔT model)
                  </dd>
                </div>
              </dl>
              <div className="hub-actions">
                <button className="btn sm" onClick={() => exportReport('live')}><Download size={12} /> Download report (JSON)</button>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="hub-card" aria-labelledby="verify-method-title">
        <div className="hub-card-head"><h3 id="verify-method-title">How to read this</h3></div>
        <ul className="hub-list">
          {VERIFICATION_CONVENTIONS.map((c) => <li key={c}>{c}</li>)}
          <li>
            "Agrees" means max separation ≤ {VERIFY_TOLERANCE.separationDeg}° and max |Δ elevation| ≤ {VERIFY_TOLERANCE.elevationDeg}° — CHANDRA's documented
            ephemeris accuracy, about 1/25 of the Sun's apparent radius. It is an engineering tolerance, not a mission requirement.
          </li>
          <li>
            Time scales differ for future dates: at the first recorded instant Horizons used TDB − UT = {firstRecorded.tdb_minus_ut_s?.toFixed(3)} s, while CHANDRA's
            engine predicts TT − UT = {engineDeltaTSeconds(Date.parse(firstRecorded.utc)).toFixed(3)} s. The few-second difference is part of the residuals shown.
          </li>
        </ul>
      </section>
    </div>
  );
}
