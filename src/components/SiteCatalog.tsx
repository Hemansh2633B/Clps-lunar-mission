import { useMemo, useState } from 'react';
import { Crosshair, MapPin, Plus, Search, Table2, Pin, History, Rocket, Globe2 } from 'lucide-react';
import type { LandingSite } from '../types/mission';
import { formatCoord } from '../engine/constants';
import { CANDIDATE_DATASET_LABEL, CANDIDATE_DATASET_NOTE, ARTEMIS_CONTEXT, ARTEMIS_CONTEXT_AS_OF } from '../data/missionContext';

interface Props {
  sites: LandingSite[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCustom: () => void;
  /** Click on the global coordinate grid: open arbitrary-coordinate entry. */
  onCoordinateInput?: (latitude: number, longitude: number) => void;
  onHorizonTable: () => void;
  onPin: () => void;
  compareMode: boolean;
}

function CoordinateMap({ sites, selectedId, onSelect, onCoordinateInput }: { sites: LandingSite[]; selectedId: string; onSelect: (id: string) => void; onCoordinateInput?: (latitude: number, longitude: number) => void }) {
  const W = 360, H = 180, pad = 10;
  const point = (site: LandingSite) => ({ x: pad + (site.longitude / 360) * (W - pad * 2), y: pad + ((90 - site.latitude) / 180) * (H - pad * 2) });
  const handleBackground = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onCoordinateInput || (e.target instanceof Element && e.target.closest('[role="button"]'))) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    const longitude = Math.max(0, Math.min(360, ((x - pad) / (W - 2 * pad)) * 360));
    const latitude = Math.max(-90, Math.min(90, 90 - ((y - pad) / (H - 2 * pad)) * 180));
    onCoordinateInput(Number(latitude.toFixed(3)), Number(longitude.toFixed(3)));
  };
  const handleKey = (e: React.KeyboardEvent<SVGGElement>, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(id); }
  };
  return <div id="global-lunar-coordinate-map" style={{ border: '1px solid var(--border)', background: '#fbf8f0', padding: 5 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 8.5, color: 'var(--dim)', margin: '0 2px 4px' }}><span>SCHEMATIC COORDINATE GRID · no surface imagery</span><span>east longitude</span></div>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Equirectangular lunar coordinate grid: longitude 0 to 360 degrees east, latitude 90 degrees north to 90 degrees south. Click an empty grid point to enter custom coordinates; select a marker to open a listed site." style={{ width: '100%', display: 'block', cursor: onCoordinateInput ? 'crosshair' : 'default', touchAction: 'manipulation' }} onClick={handleBackground}>
      <rect x={pad} y={pad} width={W - 2 * pad} height={H - 2 * pad} fill="#f7f1e6" stroke="#8a7358" strokeWidth={0.8} />
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360].map((lon) => {
        const x = pad + (lon / 360) * (W - pad * 2);
        return <g key={`lon-${lon}`} pointerEvents="none"><line x1={x} x2={x} y1={pad} y2={H - pad} stroke={lon === 0 || lon === 180 || lon === 360 ? '#c9b590' : '#e1d6c4'} strokeWidth={lon === 0 || lon === 180 || lon === 360 ? 0.8 : 0.45} /><text x={x} y={H - 1} textAnchor="middle" fontSize={7} fill="#756957">{lon}°</text></g>;
      })}
      {[-60, -30, 0, 30, 60].map((lat) => {
        const y = pad + ((90 - lat) / 180) * (H - pad * 2);
        return <g key={`lat-${lat}`} pointerEvents="none"><line x1={pad} x2={W - pad} y1={y} y2={y} stroke={lat === 0 ? '#c9b590' : '#e1d6c4'} strokeWidth={lat === 0 ? 0.8 : 0.45} /><text x={pad + 2} y={y - 2} fontSize={7} fill="#756957">{lat > 0 ? '+' : ''}{lat}°</text></g>;
      })}
      {sites.map((site) => {
        const { x, y } = point(site);
        const selected = site.id === selectedId;
        return <g key={site.id} role="button" tabIndex={0} aria-label={`Select ${site.name}, latitude ${site.latitude.toFixed(3)} degrees, east longitude ${site.longitude.toFixed(3)} degrees; ${site.side ?? 'side not classified'}`} onClick={(e) => { e.stopPropagation(); onSelect(site.id); }} onKeyDown={(e) => handleKey(e, site.id)} style={{ cursor: 'pointer' }}>
          <circle cx={x} cy={y} r={selected ? 4.2 : 2.8} fill={site.side === 'far' ? '#7c4d9e' : site.side === 'limb' ? '#c4842a' : '#0e7490'} stroke={selected ? '#1c2430' : '#fffdf7'} strokeWidth={selected ? 1.5 : 0.9} />
          <title>{`${site.shortName} · ${formatCoord(site.latitude, site.longitude)} · ${site.side ?? 'side not classified'}`}</title>
        </g>;
      })}
      <text x={W / 2} y={H / 2 + 3} textAnchor="middle" fontSize={8} fill="#8a7358" pointerEvents="none">0°E · nominal sub-Earth meridian</text>
    </svg>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4, flexWrap: 'wrap', fontSize: 8, color: 'var(--dim)', margin: '3px 2px 0' }}><span>● near side</span><span style={{ color: '#c4842a' }}>● limb band</span><span style={{ color: '#7c4d9e' }}>● far side</span><span>Click empty grid for custom coordinates</span></div>
  </div>;
}

type Tab = 'all' | 'artemis' | 'polar' | 'far-side' | 'reference' | 'custom';
const isArtemis = (s: LandingSite) => (s.program ?? '').startsWith('Artemis III');
const CONF_LABEL: Record<string, string> = { measured: 'measured', 'region-approximate': 'region approx.', illustrative: 'illustrative', synthetic: 'synthetic', mixed: 'mixed' };

export function SiteCatalog({ sites, selectedId, onSelect, onCustom, onCoordinateInput, onHorizonTable, onPin, compareMode }: Props) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [mapOpen, setMapOpen] = useState(false);
  const filtered = useMemo(() => sites.filter((s) => {
    if (tab === 'artemis' && !isArtemis(s)) return false;
    if (tab === 'polar' && s.category !== 'polar') return false;
    if (tab === 'far-side' && s.side !== 'far') return false;
    if (tab === 'reference' && s.category === 'far-side') return false;
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
          {(['all', 'artemis', 'polar', 'far-side', 'reference', 'custom'] as Tab[]).map((t) => (
            <button key={t} className={`btn sm ${tab === t ? 'active' : 'ghost'}`} style={{ flex: 1, textTransform: 'capitalize', whiteSpace: 'nowrap' }} onClick={() => setTab(t)} aria-pressed={tab === t}>{t === 'artemis' ? '2024 Regions' : t}</button>
          ))}
        </div>
        <button className={`btn sm ${mapOpen ? 'active' : 'ghost'}`} style={{ justifyContent: 'center' }} onClick={() => setMapOpen((v) => !v)} aria-expanded={mapOpen} aria-controls="global-lunar-coordinate-map"><Globe2 size={12} /> {mapOpen ? 'Hide global coordinate grid' : 'Open global coordinate grid · near / far side'}</button>
        {mapOpen && <CoordinateMap sites={sites} selectedId={selectedId} onSelect={onSelect} onCoordinateInput={onCoordinateInput} />}
        {tab === 'artemis' && (
          <div style={{ border: '1px solid var(--border)', background: '#fffdf7', padding: 9, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 700, color: 'var(--navy)' }}>
              <History size={12} /> {CANDIDATE_DATASET_LABEL}
            </div>
            <p style={{ margin: 0, fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>{CANDIDATE_DATASET_NOTE}</p>
            <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9.5, fontWeight: 700, color: 'var(--ink-soft)' }}>
                <Rocket size={11} /> Current mission context (NASA, as of {ARTEMIS_CONTEXT_AS_OF})
              </div>
              {ARTEMIS_CONTEXT.map((m) => (
                <div key={m.mission} style={{ fontSize: 9.5, color: 'var(--muted)', lineHeight: 1.45 }}>
                  <strong style={{ color: 'var(--ink)' }}>{m.mission}</strong> · {m.target} — {m.role}{' '}
                  <a href={m.sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--navy)' }}>NASA ↗</a>
                </div>
              ))}
            </div>
          </div>
        )}
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
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{formatCoord(selected.latitude, selected.longitude)} · {selected.elevationAvailable === false ? 'elevation unavailable' : `${selected.elevationM.toFixed(0)} m`}</div>
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
