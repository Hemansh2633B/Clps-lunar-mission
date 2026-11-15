import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudDownload, Database, ExternalLink, FileSearch, RefreshCw } from 'lucide-react';
import type { AcquireResponse, DatasetEntry, DatasetMetadata, DatasetsResponse, TerrainData } from '../terrain/types';
import { ApiError, BackendUnavailableError, terrainApi } from '../terrain/api';
import { sourceById } from '../data/catalogue';
import { formatBytes, modelEligibility, tiffCompressionLabel, tiffPredictorLabel } from '../terrain/datasets';

interface Props {
  online: boolean;
  datasets: DatasetsResponse | null;
  datasetsError: string | null;
  datasetId: string;
  onSelect: (id: string) => void;
  onRefresh: () => Promise<void>;
  location: { latitude: number; longitude: number; radius: number };
  locationError: string | null;
  /** A new subset was stored: select it and build real terrain from it. */
  onAcquired: (id: string) => void;
  data: TerrainData | null;
  busy: boolean;
}

type AcquireState =
  | { phase: 'idle' }
  | { phase: 'planning' | 'downloading' }
  | { phase: 'planned'; plan: AcquireResponse; key: string }
  | { phase: 'done'; result: AcquireResponse }
  | { phase: 'error'; message: string };

const label = (d: DatasetEntry) => (d.kind === 'configured' ? 'Configured DEM' : d.id);

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="lab-meta-row"><dt>{k}</dt><dd>{v}</dd></div>;
}

function describeError(err: unknown): string {
  if (err instanceof BackendUnavailableError) return 'The backend is not reachable. Nothing was downloaded.';
  if (err instanceof ApiError && err.status === 429) return `${err.message}${err.retryAfterS ? ` Retry in about ${Math.ceil(err.retryAfterS)} s.` : ''}`;
  return err instanceof Error ? err.message : String(err);
}

export function TerrainDataPanel({ online, datasets, datasetsError, datasetId, onSelect, onRefresh, location, locationError, onAcquired, data, busy }: Props) {
  const [meta, setMeta] = useState<{ id: string; value: DatasetMetadata | null; error: string | null } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [product, setProduct] = useState('');
  const [acquire, setAcquire] = useState<AcquireState>({ phase: 'idle' });
  const [refreshing, setRefreshing] = useState(false);

  const list = datasets?.datasets ?? [];
  const selected = list.find((d) => d.id === datasetId) ?? null;
  const products = datasets?.acquisition.products ?? [];
  const productId = product || products.find((p) => p.id === 'lola-ldem-80s-20mpp-adj')?.id || products[0]?.id || '';
  const productInfo = sourceById(productId);
  const planKey = `${productId}|${location.latitude}|${location.longitude}|${location.radius}`;

  useEffect(() => {
    if (!online || !selected?.ready) { setMeta(null); return; }
    let active = true;
    setMeta({ id: selected.id, value: null, error: null });
    terrainApi.metadata(selected.id)
      .then((value) => { if (active) setMeta({ id: selected.id, value, error: null }); })
      .catch((err) => { if (active) setMeta({ id: selected.id, value: null, error: describeError(err) }); });
    return () => { active = false; };
  }, [online, selected?.id, selected?.ready]);

  const run = async (dryRun: boolean) => {
    if (!productId || locationError) return;
    setAcquire({ phase: dryRun ? 'planning' : 'downloading' });
    try {
      const result = await terrainApi.acquire({ product_id: productId, latitude: location.latitude, longitude: location.longitude, radius_km: location.radius, dry_run: dryRun });
      if (dryRun) { setAcquire({ phase: 'planned', plan: result, key: planKey }); return; }
      // Refresh the list first, then report success and select the new dataset in one update,
      // so "done" is never shown while the selector still points at another dataset.
      await onRefresh();
      if (result.dataset?.id) onAcquired(result.dataset.id);
      setAcquire({ phase: 'done', result });
    } catch (err) {
      setAcquire({ phase: 'error', message: describeError(err) });
    }
  };

  const eligibility = modelEligibility(data);
  const m = meta?.value ?? null;
  const planStale = acquire.phase === 'planned' && acquire.key !== planKey;

  return (
    <div data-testid="terrain-data-panel">
      <div className="panel-title" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Database size={12} /> DEM datasets
        <span style={{ flex: 1 }} />
        {online && (
          <button className="btn sm icon ghost" aria-label="Refresh dataset list" title="Refresh dataset list" disabled={refreshing}
            onClick={() => { setRefreshing(true); void onRefresh().finally(() => setRefreshing(false)); }}><RefreshCw size={11} /></button>
        )}
      </div>

      {!online && (
        <p className="lab-note" data-testid="datasets-offline">
          Backend offline. The synthetic demo works without it; real DEM loading, metadata and LOLA acquisition need the backend
          (<span className="mono">npm run dev:api</span>, or a deployment with the API function).
        </p>
      )}
      {online && datasetsError && <p className="lab-note warn" role="alert"><AlertTriangle size={11} /> {datasetsError}</p>}
      {online && !datasets && !datasetsError && <p className="lab-note" role="status">Loading datasets…</p>}

      {online && datasets && (
        <>
          <div className="field">
            <label htmlFor="terrain-dataset">Real-DEM dataset</label>
            <select id="terrain-dataset" className="input" value={selected ? selected.id : ''} onChange={(e) => onSelect(e.target.value)}>
              {!selected && <option value="">No dataset available</option>}
              {list.map((d) => (
                <option key={d.id} value={d.id} disabled={!d.ready}>{label(d)}{d.ready ? (d.source ? ` · ${d.source.filename}` : '') : ' · not ready'}</option>
              ))}
            </select>
          </div>
          {selected && !selected.ready && (
            <p className="lab-note" data-testid="dataset-not-ready">
              {selected.kind === 'configured' ? '' : 'This dataset cannot be opened. '}
              {selected.error ?? 'No DEM is configured on this backend.'}
            </p>
          )}
          {selected?.ready && selected.source && (
            <dl className="lab-meta" data-testid="dataset-summary">
              <Row k="Frame" v={<>
                {selected.source.lunar_reference_frame || 'Not declared'}{' '}
                <span className={`chip ${selected.frame?.recognized ? 'nominal' : 'blocked'}`}>{selected.frame?.recognized ? 'validated' : 'not validated'}</span>
              </>} />
              <Row k="Resolution" v={selected.source.source_resolution ? `${selected.source.source_resolution.map((v) => Number(v.toPrecision(6))).join(' × ')} ${selected.source.source_resolution_unit ?? ''}` : 'Not reported'} />
              <Row k="Raster" v={`${selected.source.width} × ${selected.source.height} px`} />
              <Row k="Heights" v={`${selected.source.value_kind ?? 'height'} · ${selected.source.vertical_unit ?? 'unit not declared'}`} />
              <Row k="Datum" v={selected.source.elevation_reference} />
              {selected.source.synthetic && <Row k="Nature" v={<span className="chip solar">Synthetic fixture · demo only</span>} />}
            </dl>
          )}
          {selected?.ready && (
            <button className="btn sm ghost" aria-expanded={detailsOpen} aria-controls="terrain-dataset-details" onClick={() => setDetailsOpen((v) => !v)} style={{ marginTop: 6 }}>
              <FileSearch size={11} /> {detailsOpen ? 'Hide' : 'Show'} full metadata
            </button>
          )}
          {detailsOpen && selected?.ready && (
            <div id="terrain-dataset-details" data-testid="dataset-metadata">
              {meta?.error && <p className="lab-note warn" role="alert"><AlertTriangle size={11} /> {meta.error}</p>}
              {!m && !meta?.error && <p className="lab-note" role="status">Reading raster header…</p>}
              {m && (
                <dl className="lab-meta">
                  <Row k="File" v={m.source.filename} />
                  <Row k="Projection" v={`${m.georeferencing.projection}${m.georeferencing.geographic ? ' (geographic)' : ''} · ${m.georeferencing.unit}`} />
                  <Row k="CRS" v={m.source.crs_name || 'Not reported'} />
                  <Row k="Sphere radius" v={`${m.source.lunar_radius_m.toLocaleString('en-US')} m`} />
                  <Row k="Samples" v={`${m.raster.bits_per_sample}-bit ${m.raster.sample_format}`} />
                  <Row k="Storage" v={`${m.raster.layout} · compression ${tiffCompressionLabel(m.raster.compression)} · predictor ${tiffPredictorLabel(m.raster.predictor)} · ${m.raster.overviews} overview(s)`} />
                  <Row k="NoData" v={m.raster.nodata === null ? 'None declared' : String(m.raster.nodata)} />
                  <Row k="Scale / offset" v={`${m.source.scale ?? 1} / ${m.source.offset ?? 0}`} />
                  <Row k="Bounds" v={<span className="mono">{[m.georeferencing.bounds.left, m.georeferencing.bounds.bottom, m.georeferencing.bounds.right, m.georeferencing.bounds.top].map((v) => Number(v.toFixed(3))).join(', ')}</span>} />
                  <Row k="Footprint" v={<span className="mono">{m.georeferencing.footprint.map((c) => (c.latitude === undefined ? `${c.corner}: outside projection` : `${c.corner.replace('_', ' ')}: ${c.latitude.toFixed(4)}°, ${c.longitude!.toFixed(4)}°E`)).join(' · ')}</span>} />
                  <Row k="Frame check" v={m.frame.note} />
                  <Row k="Frame interval" v={`${m.validated_frame_interval_utc[0]} → ${m.validated_frame_interval_utc[1]}`} />
                  <Row k="Eligibility" v={<>
                    <span className={`chip ${m.eligibility.quantitative_candidate ? 'nominal' : 'blocked'}`}>{m.eligibility.quantitative_candidate ? 'Quantitative candidate' : 'View only'}</span>{' '}
                    {m.eligibility.note} {m.eligibility.notes.join(' ')}
                  </>} />
                  {m.source.provenance && Object.keys(m.source.provenance).length > 0 && (
                    <Row k="Provenance" v={<span className="mono" style={{ whiteSpace: 'pre-wrap' }}>{Object.entries(m.source.provenance).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('\n')}</span>} />
                  )}
                </dl>
              )}
            </div>
          )}
        </>
      )}

      <div className="lab-model" data-testid="model-eligibility" data-level={eligibility.level}>
        <div className="lab-model-head">
          {eligibility.level === 'eligible' ? <CheckCircle2 size={12} color="var(--nominal)" /> : <AlertTriangle size={12} color={eligibility.level === 'blocked' ? 'var(--crimson)' : 'var(--brass)'} />}
          <strong>{eligibility.title}</strong>
        </div>
        <div>{eligibility.detail}</div>
        {data && !data.synthetic && data.processing && (
          <div className="mono" style={{ fontSize: 9.5, marginTop: 3 }}>{data.processing.engine} · {data.processing.resampling} · {data.processing.transform}</div>
        )}
      </div>

      {online && datasets && (
        <div style={{ marginTop: 12 }}>
          <div className="panel-title" style={{ marginBottom: 6 }}><CloudDownload size={12} /> Acquire a NASA LOLA subset</div>
          {!datasets.acquisition.enabled ? (
            <p className="lab-note" data-testid="acquire-disabled">Remote acquisition is switched off on this deployment. Use <span className="mono">npm run lola:subset</span> locally, or load a DEM you downloaded yourself.</p>
          ) : (
            <>
              <div className="field">
                <label htmlFor="terrain-product">Source product (NASA PGDA)</label>
                <select id="terrain-product" className="input" value={productId} onChange={(e) => { setProduct(e.target.value); setAcquire({ phase: 'idle' }); }}>
                  {products.map((p) => {
                    const info = sourceById(p.id);
                    return <option key={p.id} value={p.id}>{info?.product_id ?? p.id}{info?.spatial_resolution ? ` · ${info.spatial_resolution}` : ''}</option>;
                  })}
                </select>
              </div>
              <p className="lab-note">
                {productInfo?.coverage ?? 'Coverage not confirmed'}{productInfo?.file_size ? ` · full file ${productInfo.file_size}` : ''}. Only the blocks covering{' '}
                <span className="mono">{location.latitude}°, {location.longitude}°E ± {location.radius} km</span> are read by HTTP range requests — the full file is never downloaded.
                {' '}{productInfo?.documentation_url && <a href={productInfo.documentation_url} target="_blank" rel="noopener noreferrer">Product page <ExternalLink size={9} /></a>}
              </p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn sm" disabled={busy || !!locationError || acquire.phase === 'planning' || acquire.phase === 'downloading'} onClick={() => void run(true)}>
                  {acquire.phase === 'planning' ? 'Planning…' : 'Estimate download'}
                </button>
                <button className="btn sm primary" disabled={busy || !!locationError || acquire.phase !== 'planned' || planStale} onClick={() => void run(false)}
                  title={acquire.phase !== 'planned' || planStale ? 'Estimate the download for this location first' : undefined}>
                  <CloudDownload size={11} /> Download subset
                </button>
              </div>
              <div aria-live="polite" data-testid="acquire-status" data-phase={acquire.phase}>
                {locationError && <p className="lab-note warn">{locationError}</p>}
                {acquire.phase === 'downloading' && <p className="lab-note" role="status">Reading the subset from NASA PGDA… this can take a minute.</p>}
                {acquire.phase === 'planned' && (
                  <dl className="lab-meta" data-testid="acquire-plan">
                    <Row k="Download" v={<strong>≈ {formatBytes(acquire.plan.plan.estimated_download_bytes)}</strong>} />
                    <Row k="Window" v={`${acquire.plan.plan.source_pixel_window[2]} × ${acquire.plan.plan.source_pixel_window[3]} px of ${acquire.plan.plan.source_width} × ${acquire.plan.plan.source_height}`} />
                    <Row k="Native" v={`${acquire.plan.plan.native_resolution} ${acquire.plan.plan.native_resolution_unit}/px · ${acquire.plan.plan.source_blocks} block(s)`} />
                    {planStale && <Row k="Note" v="Location or product changed — estimate again." />}
                  </dl>
                )}
                {acquire.phase === 'done' && (
                  <p className="lab-note ok" data-testid="acquire-done">
                    <CheckCircle2 size={11} /> Stored {acquire.result.dataset?.id} ({formatBytes(acquire.result.bytes ?? 0)}, SHA-256 <span className="mono">{acquire.result.sha256?.slice(0, 12)}…</span>).
                    {acquire.result.storage && !acquire.result.storage.persistent && ' Storage on this deployment is temporary: the subset may need to be acquired again later.'}
                  </p>
                )}
                {acquire.phase === 'error' && <p className="lab-note warn" role="alert"><AlertTriangle size={11} /> {acquire.message}</p>}
              </div>
              <p className="lab-note" style={{ marginTop: 6 }}>
                Storage: {datasets.storage.kind} · {datasets.storage.persistent ? 'persistent' : 'temporary on this deployment'}.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
