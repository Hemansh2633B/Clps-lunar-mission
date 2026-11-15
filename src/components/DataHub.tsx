import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Database, ExternalLink, Flag, Map as MapIcon, Mountain, Search, ShieldCheck } from 'lucide-react';
import type { LandingSite } from '../types/mission';
import {
  AVAILABILITY_LABEL, CATALOGUE, INTEGRATION_LABEL, matchesSource,
  type CatalogueSource, type SourceAvailability, type SourceCategory,
} from '../data/catalogue';
import { terrainApi } from '../terrain/api';
import type { SourcesResponse } from '../terrain/types';
import { VerificationPanel } from './VerificationPanel';

export type DataHubTab = 'sources' | 'verification' | 'csa';

interface Props {
  site: LandingSite;
  timeMs: number;
  tab: DataHubTab;
  onTab: (t: DataHubTab) => void;
  onShowLayer: (sourceId: string) => void;
  onOpenTerrain: () => void;
  notify: (msg: string) => void;
}

const UNKNOWN = 'Not confirmed';
const CATEGORY_CHIP: Record<SourceCategory, string> = {
  imagery: 'neutral', dem: 'earth', terrain: 'neutral', lighting: 'solar', ephemeris: 'earth', mission: 'neutral', provenance: 'nominal',
};

type Runtime = { state: 'checking' } | { state: 'offline' } | { state: 'online'; info: SourcesResponse['runtime'] };

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={value ? undefined : 'unknown'}>{value || UNKNOWN}</dd>
    </div>
  );
}

function SourceCard({ source, onShowLayer, onOpenTerrain, onVerify }: { source: CatalogueSource; onShowLayer: (id: string) => void; onOpenTerrain: () => void; onVerify: () => void }) {
  const category = CATALOGUE.categories.find((c) => c.id === source.category);
  return (
    <article className="hub-card" data-source-id={source.id} data-category={source.category} aria-labelledby={`src-${source.id}`}>
      <div className="hub-card-head">
        <h3 id={`src-${source.id}`}>{source.product_name}</h3>
        <div className="hub-chips">
          <span className={`chip ${CATEGORY_CHIP[source.category]}`}>{category?.title ?? source.category}</span>
          <span className={`chip ${source.availability === 'bundled' ? 'nominal' : 'neutral'}`}>{AVAILABILITY_LABEL[source.availability]}</span>
        </div>
      </div>
      <div className="hub-provider">{source.provider}</div>
      <dl className="hub-fields">
        <Field label="Product ID" value={source.product_id} />
        <Field label="Version" value={source.version} />
        <Field label="Resolution" value={source.spatial_resolution} />
        <Field label="Coverage" value={source.coverage} />
        <Field label="Coordinate system" value={source.coordinate_system} />
        <Field label="Reference frame" value={source.reference_frame} />
        <Field label="Vertical datum" value={source.vertical_datum} />
        {source.file_size !== undefined && <Field label="File size" value={source.file_size} />}
        <Field label="Published" value={source.publication_date} />
        <Field label="Retrieved / checked" value={source.retrieval_date} />
        <Field label="Attribution" value={source.attribution} />
        <Field label="Usage terms" value={source.usage_terms} />
      </dl>
      {source.notes && <p className="hub-text">{source.notes}</p>}
      {source.verification && <p className="hub-meta"><ShieldCheck size={10} aria-hidden="true" /> {source.verification}</p>}
      <div className="hub-actions">
        <span className="hub-meta">Used by: {INTEGRATION_LABEL[source.integration]}</span>
        <span style={{ flex: 1 }} />
        {source.integration === 'polar-map-layer' && <button className="btn sm" onClick={() => onShowLayer(source.id)}><MapIcon size={12} /> Show on Polar Map</button>}
        {source.integration === 'acquire' && <button className="btn sm" onClick={onOpenTerrain}><Mountain size={12} /> Acquire in Terrain Lab</button>}
        {source.integration === 'verification' && <button className="btn sm" onClick={onVerify}><ShieldCheck size={12} /> Open verification</button>}
        {source.documentation_url && <a className="btn sm ghost" href={source.documentation_url} target="_blank" rel="noopener noreferrer">Documentation <ExternalLink size={10} /></a>}
        {source.access_url && <a className="btn sm ghost" href={source.access_url} target="_blank" rel="noopener noreferrer">Open source <ExternalLink size={10} /></a>}
      </div>
    </article>
  );
}

export function DataHub({ site, timeMs, tab, onTab, onShowLayer, onOpenTerrain, notify }: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SourceCategory | 'all'>('all');
  const [availability, setAvailability] = useState<SourceAvailability | 'all'>('all');
  const [runtime, setRuntime] = useState<Runtime>({ state: 'checking' });

  useEffect(() => {
    let active = true;
    terrainApi.sources()
      .then((r) => { if (active) setRuntime(r.runtime ? { state: 'online', info: r.runtime } : { state: 'offline' }); })
      .catch(() => { if (active) setRuntime({ state: 'offline' }); });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => CATALOGUE.sources.filter((s) =>
    (category === 'all' || s.category === category) && (availability === 'all' || s.availability === availability) && matchesSource(s, query)),
  [category, availability, query]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of CATALOGUE.sources) m.set(s.category, (m.get(s.category) ?? 0) + 1);
    return m;
  }, []);

  const tabs: { id: DataHubTab; label: string; icon: React.ReactNode }[] = [
    { id: 'sources', label: `Sources (${CATALOGUE.sources.length})`, icon: <Database size={13} /> },
    { id: 'verification', label: 'Ephemeris verification', icon: <ShieldCheck size={13} /> },
    { id: 'csa', label: `CSA mission references (${CATALOGUE.csa.length})`, icon: <Flag size={13} /> },
  ];

  return (
    <section className="panel data-hub" data-testid="data-hub" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="panel-header">
        <span className="panel-title"><Database size={13} /> Lunar Data Hub · sources, provenance, verification</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }} data-testid="hub-runtime" data-state={runtime.state}>
          {runtime.state === 'checking' && <span className="chip neutral">Checking backend…</span>}
          {runtime.state === 'offline' && <span className="chip solar" title="The catalogue is bundled, so it is complete without a backend. Live acquisition and live Horizons checks need one.">Backend offline · bundled catalogue</span>}
          {runtime.state === 'online' && (
            <>
              <span className="chip nominal">Backend online · {runtime.info.deployment}</span>
              <span className={`chip ${runtime.info.acquisition_enabled ? 'nominal' : 'neutral'}`}>LOLA acquisition {runtime.info.acquisition_enabled ? 'on' : 'off'}</span>
              <span className={`chip ${runtime.info.horizons_enabled ? 'nominal' : 'neutral'}`}>Horizons {runtime.info.horizons_enabled ? 'on' : 'off'}</span>
              <span className={`chip ${runtime.info.storage.persistent ? 'nominal' : 'solar'}`} title={runtime.info.storage.persistent ? 'Acquired subsets persist.' : 'Acquired subsets are temporary on this deployment and may disappear.'}>
                Storage {runtime.info.storage.kind}{runtime.info.storage.persistent ? '' : ' · temporary'}
              </span>
            </>
          )}
        </div>
      </div>

      <div role="tablist" aria-label="Data Hub sections" className="hub-tabs">
        {tabs.map((t) => (
          <button key={t.id} role="tab" id={`hub-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`hub-panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
            className={`btn sm ${tab === t.id ? 'active' : 'ghost'}`} onClick={() => onTab(t.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              const i = tabs.findIndex((x) => x.id === tab);
              const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].id;
              onTab(next);
              window.requestAnimationFrame(() => document.getElementById(`hub-tab-${next}`)?.focus());
            }}>{t.icon} {t.label}</button>
        ))}
      </div>

      <div className="hub-body" role="tabpanel" id={`hub-panel-${tab}`} aria-labelledby={`hub-tab-${tab}`}>
        {tab === 'sources' && (
          <div className="hub-section">
            <div className="hub-callout">
              <BookOpen size={16} aria-hidden="true" />
              <div>
                Every dataset, service and reference CHANDRA uses or links to. <strong>{UNKNOWN}</strong> means the value was not confirmed from the provider — it is never a guess.
                Imagery is never used as elevation; mission references are never used as terrain. Catalogue dated {CATALOGUE.catalogue_date}.
              </div>
            </div>
            <div className="hub-filters">
              <label className="hub-search">
                <Search size={13} aria-hidden="true" />
                <input className="input" type="search" placeholder="Search product, provider, frame…" aria-label="Search data sources" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <div className="hub-chips" role="group" aria-label="Filter by category">
                <button className={`btn sm ${category === 'all' ? 'active' : 'ghost'}`} aria-pressed={category === 'all'} onClick={() => setCategory('all')}>All</button>
                {CATALOGUE.categories.filter((c) => counts.has(c.id)).map((c) => (
                  <button key={c.id} className={`btn sm ${category === c.id ? 'active' : 'ghost'}`} aria-pressed={category === c.id} title={c.description} onClick={() => setCategory(c.id)}>
                    {c.title} · {counts.get(c.id)}
                  </button>
                ))}
              </div>
              <select className="input" aria-label="Filter by availability" value={availability} onChange={(e) => setAvailability(e.target.value as SourceAvailability | 'all')} style={{ width: 220 }}>
                <option value="all">Any availability</option>
                {(Object.keys(AVAILABILITY_LABEL) as SourceAvailability[]).map((a) => <option key={a} value={a}>{AVAILABILITY_LABEL[a]}</option>)}
              </select>
            </div>
            <div className="hub-meta" role="status" data-testid="hub-count">{filtered.length} of {CATALOGUE.sources.length} sources</div>
            {filtered.length === 0 ? (
              <div className="hub-empty">
                No source matches these filters.
                <button className="btn sm" onClick={() => { setQuery(''); setCategory('all'); setAvailability('all'); }}>Clear filters</button>
              </div>
            ) : (
              <div className="hub-grid">
                {filtered.map((s) => <SourceCard key={s.id} source={s} onShowLayer={onShowLayer} onOpenTerrain={onOpenTerrain} onVerify={() => onTab('verification')} />)}
              </div>
            )}
          </div>
        )}

        {tab === 'verification' && <VerificationPanel site={site} timeMs={timeMs} notify={notify} />}

        {tab === 'csa' && (
          <div className="hub-section">
            <div className="hub-callout warn">
              <Flag size={16} aria-hidden="true" />
              <div>
                <strong>Mission reference only.</strong> {CATALOGUE.csa_notice}{' '}
                Source: <a href={CATALOGUE.csa_landing.url} target="_blank" rel="noopener noreferrer">Canadian Space Agency — Moon exploration <ExternalLink size={10} /></a>,
                retrieved {CATALOGUE.csa_landing.retrieval_date}. Latest news item listed there: “{CATALOGUE.csa_landing.latest_listed_news.title}” ({CATALOGUE.csa_landing.latest_listed_news.date}).
              </div>
            </div>
            <div className="hub-grid">
              {CATALOGUE.csa.map((r) => (
                <article key={r.id} className="hub-card" data-csa-id={r.id} aria-labelledby={`csa-${r.id}`}>
                  <div className="hub-card-head">
                    <h3 id={`csa-${r.id}`}>{r.title}</h3>
                    <span className="chip neutral">Mission reference</span>
                  </div>
                  <div className="hub-provider">{r.provider} · {r.topic}</div>
                  <p className="hub-text">{r.summary}</p>
                  <dl className="hub-fields">
                    <Field label="Published" value={r.publication_date} />
                    <Field label="Retrieved" value={r.retrieval_date} />
                  </dl>
                  <p className="hub-meta"><ShieldCheck size={10} aria-hidden="true" /> {r.verification}</p>
                  <div className="hub-actions">
                    <span className="hub-meta">Not terrain, elevation or lighting data</span>
                    <span style={{ flex: 1 }} />
                    <a className="btn sm ghost" href={r.url} target="_blank" rel="noopener noreferrer">Open at CSA <ExternalLink size={10} /></a>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
