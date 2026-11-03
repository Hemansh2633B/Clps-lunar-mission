import { useMemo, useState } from 'react';
import { Crosshair, MapPin, Plus, Search, Table2, Pin } from 'lucide-react';
import type { LandingSite } from '../types/mission';
import { formatCoord } from '../engine/constants';

interface Props {
  sites: LandingSite[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCustom: () => void;
  onHorizonTable: () => void;
  onPin: () => void;
  compareMode: boolean;
}

type Tab = 'all' | 'artemis' | 'polar' | 'reference' | 'custom';
const isArtemis = (s: LandingSite) => (s.program ?? '').startsWith('Artemis III');
const CONF_LABEL: Record<string, string> = { measured: 'measured', 'region-approximate': 'region approx.', illustrative: 'illustrative', synthetic: 'synthetic', mixed: 'mixed' };

export function SiteCatalog({ sites, selectedId, onSelect, onCustom, onHorizonTable, onPin, compareMode }: Props) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const filtered = useMemo(() => sites.filter((s) => {
    if (tab === 'artemis' && !isArtemis(s)) return false;
    if (tab === 'polar' && s.category !== 'polar') return false;
    if (tab === 'reference' && s.category !== 'reference') return false;
    if (tab === 'custom' && !s.custom) return false;
    if (query && !`${s.name} ${s.region} ${s.program ?? ''}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [sites, tab, query]);
  const selected = sites.find((s) => s.id === selectedId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-header">
        <span className="panel-title"><MapPin size={13} /> Landing sites</span>
        <span className="chip neutral">{sites.length}</span>
      </div>
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid var(--border)' }}>
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--dim)' }} />
          <input className="input" style={{ paddingLeft: 28 }} placeholder="Search sites…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(['all', 'artemis', 'polar', 'reference', 'custom'] as Tab[]).map((t) => (
            <button key={t} className={`btn sm ${tab === t ? 'active' : 'ghost'}`} style={{ flex: 1, textTransform: 'capitalize', whiteSpace: 'nowrap' }} onClick={() => setTab(t)}>{t === 'artemis' ? 'Artemis III' : t}</button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 6 }}>
        {filtered.map((s) => (
          <button key={s.id} className={`site-item ${s.id === selectedId ? 'selected' : ''}`} onClick={() => onSelect(s.id)}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span className="name">{s.shortName}</span>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.accent, flexShrink: 0 }} />
            </div>
            <span className="meta">{formatCoord(s.latitude, s.longitude)}{s.coordinateUncertaintyDeg ? ` ±${s.coordinateUncertaintyDeg}°` : ''}</span>
            <span style={{ fontSize: 10, color: 'var(--dim)' }}>{s.region}{s.custom ? ' · custom' : ''}</span>
            {s.program && (
              <span className="mono" style={{ fontSize: 8.5, color: isArtemis(s) ? 'var(--navy)' : 'var(--muted)', letterSpacing: 0.2 }}>
                {s.program}{s.dataConfidence ? ` · ${CONF_LABEL[s.dataConfidence] ?? s.dataConfidence}` : ''}
              </span>
            )}
          </button>
        ))}
        {filtered.length === 0 && <div style={{ padding: 16, color: 'var(--dim)', fontSize: 12 }}>No sites match.</div>}
      </div>
      {selected && (
        <div style={{ borderTop: '1px solid var(--border)', padding: 12, background: 'var(--panel-2)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{selected.name}</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{formatCoord(selected.latitude, selected.longitude)} · {selected.elevationM.toFixed(0)} m</div>
          <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 8px' }}>{selected.description}</p>
          {selected.program && (
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 10px', padding: '6px 8px', background: '#fffdf7', border: '1px dashed var(--border)' }}>
              <div>{selected.program}{selected.coordinateType ? ` · ${selected.coordinateType}` : ''}{selected.coordinateUncertaintyDeg ? ` · ±${selected.coordinateUncertaintyDeg}°` : ''}</div>
              {selected.coordinateProvenance && <div style={{ color: 'var(--dim)' }}>{selected.coordinateProvenance}</div>}
              {selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--navy)' }}>Source{selected.sourceDate ? ` (${selected.sourceDate})` : ''} ↗</a>}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={onCustom}><Plus size={12} /> Custom</button>
            <button className="btn sm" onClick={onHorizonTable}><Table2 size={12} /> Horizon</button>
            <button className="btn sm primary" onClick={onPin}><Pin size={12} /> {compareMode ? 'Pin' : 'Pin & compare'}</button>
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: selected.terrain.kind === 'dem' && !selected.terrain.synthetic ? 'var(--solar)' : 'var(--dim)' }}>
            <Crosshair size={11} /> {selected.terrain.kind === 'flat' ? 'Idealized spherical horizon'
              : selected.terrain.kind === 'dem' ? (selected.terrain.synthetic ? 'Synthetic demo horizon' : 'DEM-derived horizon')
              : selected.terrain.kind === 'custom' ? 'User-edited 8-sector mask'
              : 'LOLA-inspired illustrative mask'} · {selected.terrain.kind === 'dem' ? `${selected.terrain.resolutionDeg}° bins` : `±${selected.terrain.uncertaintyDeg.toFixed(2)}°`}
          </div>
        </div>
      )}
    </div>
  );
}
