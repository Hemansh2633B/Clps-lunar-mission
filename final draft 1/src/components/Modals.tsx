import { useEffect, useId, useRef, useState } from 'react';
import { X, Download, Plus, SlidersHorizontal } from 'lucide-react';
import type { EvaluatedSample, LandingSite, MissionConfig } from '../types/mission';
import type { CustomTerrainPreset } from '../data/landingSites';
import { horizonTable } from '../engine/horizonPhysics';
import { formatCoord } from '../engine/constants';
import { MISSION_PRESETS, matchingPresetId, CUSTOM_PRESET_ID } from '../data/missionPresets';
import { NumberField } from './NumberField';
import type { NumericConfigKey } from '../engine/configLimits';

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    node?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !node) return;
      const focusable = Array.from(node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); previous?.focus?.(); };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`modal fade-in ${wide ? 'wide' : ''}`} style={{ outline: 'none' }}>
        <div className="modal-header">
          <span id={titleId} style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
          <button className="btn sm ghost icon" onClick={onClose} aria-label="Close dialog"><X size={13} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export interface CustomSiteInput {
  name: string;
  latitude: number;
  longitude: number;
  elevationM: number;
  preset: CustomTerrainPreset;
  sectors?: number[];
}

export function CustomSiteModal({ onClose, onCreate, initial }: { onClose: () => void; onCreate: (input: CustomSiteInput) => void; initial?: { lat: number; lon: number } }) {
  const [name, setName] = useState('Custom polar site');
  const [lat, setLat] = useState(initial?.lat ?? -89.0);
  const [lon, setLon] = useState(initial?.lon ?? 0);
  const [elev, setElev] = useState(0);
  const [preset, setPreset] = useState<CustomTerrainPreset>('crater-rim');
  const [advanced, setAdvanced] = useState(false);
  const [sectors, setSectors] = useState<number[]>([0.4, 0.2, 1.5, 3.5, 2.0, 0.5, 0.1, 0.3]);
  const valid = Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lon) && lon >= -180 && lon <= 360 && Number.isFinite(elev);
  return (
    <Modal title="Synthesize custom site" onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label>Site name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>Latitude (°)</label><input className="input mono" type="number" step={0.001} min={-90} max={90} value={lat} onChange={(e) => setLat(Number(e.target.value))} /></div>
        <div className="field"><label>Longitude (°E)</label><input className="input mono" type="number" step={0.001} min={-180} max={360} value={lon} onChange={(e) => setLon(Number(e.target.value))} /></div>
        <div className="field"><label>Elevation (m)</label><input className="input mono" type="number" step={10} value={elev} onChange={(e) => setElev(Number(e.target.value))} /></div>
        <div className="field"><label>Terrain preset</label>
          <select className="input" value={preset} onChange={(e) => setPreset(e.target.value as CustomTerrainPreset)}>
            <option value="flat">Flat / spherical</option>
            <option value="ridge">Ridge</option>
            <option value="crater-rim">Crater rim</option>
            <option value="massif">Massif</option>
          </select>
        </div>
      </div>
      <button className="btn sm ghost" style={{ marginTop: 12, padding: 0 }} onClick={() => setAdvanced((v) => !v)}>{advanced ? 'Hide' : 'Edit'} 8-sector horizon mask</button>
      {advanced && (
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {sectors.map((v, i) => (
            <div className="field" key={i}>
              <label>{i * 45}° · {v.toFixed(1)}°</label>
              <input type="range" min={-1} max={8} step={0.1} value={v} onChange={(e) => setSectors((s) => s.map((x, j) => j === i ? Number(e.target.value) : x))} />
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 12, lineHeight: 1.5 }}>
        Custom horizons are illustrative presets or user-edited masks, not measured LOLA DEM data. {formatCoord(lat, lon)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!valid} onClick={() => onCreate({ name, latitude: lat, longitude: lon, elevationM: elev, preset, sectors: advanced ? sectors : undefined })}><Plus size={13} /> Create site</button>
      </div>
    </Modal>
  );
}

export function SettingsModal({ config, onChange, onClose }: { config: MissionConfig; onChange: (c: MissionConfig) => void; onClose: () => void }) {
  const activePreset = matchingPresetId(config);
  const setNum = (key: NumericConfigKey) => (v: number) => onChange({ ...config, [key]: v });
  const fields: NumericConfigKey[] = ['arrayAreaM2', 'cellEfficiency', 'systemDerate', 'loadW', 'batteryCapacityKWh', 'initialSocPct', 'commsMarginDeg', 'stepMinutes', 'fixedPanelAzimuthDeg', 'durationDays'];
  return (
    <Modal title="Mission parameters" onClose={onClose} wide>
      <div style={{ marginBottom: 14 }}>
        <div className="panel-title" style={{ marginBottom: 8 }}><SlidersHorizontal size={12} /> Start from a preset</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {MISSION_PRESETS.map((p) => (
            <button key={p.id} className={`btn ${activePreset === p.id ? 'active' : ''}`} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 3, height: 'auto', padding: '8px 10px', textAlign: 'left' }}
              onClick={() => onChange({ ...p.config })} aria-pressed={activePreset === p.id} title={p.description}>
              <span style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'normal' }}>{p.label}</span>
              <span style={{ fontSize: 9, color: 'var(--dim)', fontWeight: 400, whiteSpace: 'normal' }}>{p.tagline}</span>
            </button>
          ))}
          <button className={`btn ${activePreset === CUSTOM_PRESET_ID ? 'active' : ''}`} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 3, height: 'auto', padding: '8px 10px' }} aria-pressed={activePreset === CUSTOM_PRESET_ID} title="Your own configuration">
            <span style={{ fontSize: 11, fontWeight: 600 }}>Custom</span>
            <span style={{ fontSize: 9, color: 'var(--dim)', fontWeight: 400 }}>Tune every value below</span>
          </button>
        </div>
        <p style={{ fontSize: 10, color: 'var(--dim)', lineHeight: 1.5, margin: '8px 0 0' }}>
          Presets are <strong>illustrative configurations</strong> for demonstration — not claims about actual NASA vehicle specifications.
          {activePreset !== CUSTOM_PRESET_ID && <> {MISSION_PRESETS.find((p) => p.id === activePreset)?.description}</>}
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div className="field"><label>Array geometry</label>
          <select className="input" value={config.arrayMode} onChange={(e) => onChange({ ...config, arrayMode: e.target.value as MissionConfig['arrayMode'] })}>
            <option value="horizontal">Horizontal deck</option>
            <option value="vertical-tracking">Vertical mast (az tracking)</option>
            <option value="vertical-fixed">Vertical mast (fixed az)</option>
          </select>
          <span style={{ fontSize: 9, color: 'var(--dim)', lineHeight: 1.35, marginTop: 2 }}>How the array faces the Sun. A tracking mast follows the Sun's azimuth; a horizontal deck faces straight up.</span>
        </div>
        {fields.map((f) => <NumberField key={f} field={f} value={config[f] as number} onChange={setNum(f)} />)}
      </div>
      <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 14, lineHeight: 1.6 }}>
        Power model: P = flux × area × cell efficiency × derate × max(0, cos incidence). Horizontal uses sin(elevation); vertical tracking uses cos(elevation); fixed vertical adds cos(azimuth offset). Battery integrates net power with 92% charge / 95% discharge efficiency on the event-aware generation timeline. DTE requires Earth center above terrain + margin. No atmospheric refraction.
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}><button className="btn primary" onClick={onClose}>Done</button></div>
    </Modal>
  );
}

export function HorizonTableModal({ site, current, onClose, onExport, visibilityBlocked }: { site: LandingSite; current: EvaluatedSample; onClose: () => void; onExport: () => void; visibilityBlocked?: boolean }) {
  const step = site.terrain.kind === 'dem' ? site.terrain.resolutionDeg : 5;
  const rows = horizonTable(site, current, step);
  return (
    <Modal title={`Horizon elevation table · ${site.shortName}`} onClose={onClose} wide>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{site.terrain.label} · {step}° bins · Sun az {current.sun.azimuthDeg.toFixed(1)}°, Earth az {current.earth.azimuthDeg.toFixed(1)}°</span>
        <button className="btn sm" onClick={onExport} disabled={visibilityBlocked}
          title={visibilityBlocked ? 'Clearance export blocked at this epoch — the frame correction is not validated here' : undefined}>
          <Download size={12} /> CSV
        </button>
      </div>
      {visibilityBlocked && (
        <p role="note" style={{ fontSize: 11, color: 'var(--blocked)', border: '1px solid var(--blocked)', background: '#fbeae5', padding: '8px 10px', margin: '0 0 10px' }}>
          Terrain visibility is blocked at this epoch — clearance columns are withheld (they would be measured against an unvalidated mask). Terrain elevations and sky azimuths remain shown; CSV export is disabled.
        </p>
      )}
      <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 5 }}>
        <table className="table">
          <thead><tr><th>Az (°)</th><th>Terrain (°)</th><th>Sun clearance (°)</th><th>Earth clearance (°)</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.azimuthDeg}>
                <td>{r.azimuthDeg}</td>
                <td>{r.terrainElevationDeg.toFixed(2)}</td>
                <td style={{ color: visibilityBlocked ? 'var(--dim)' : r.sunClearanceDeg == null ? 'var(--dim)' : r.sunClearanceDeg >= 0 ? 'var(--nominal)' : 'var(--blocked)' }}>{visibilityBlocked ? 'blocked' : r.sunClearanceDeg == null ? '—' : r.sunClearanceDeg.toFixed(2)}</td>
                <td style={{ color: visibilityBlocked ? 'var(--dim)' : r.earthClearanceDeg == null ? 'var(--dim)' : r.earthClearanceDeg >= 0 ? 'var(--nominal)' : 'var(--blocked)' }}>{visibilityBlocked ? 'blocked' : r.earthClearanceDeg == null ? '—' : r.earthClearanceDeg.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export function ShortcutsModal({ onClose, onReopenWelcome }: { onClose: () => void; onReopenWelcome?: () => void }) {
  const keys: [string, string][] = [
    ['Space', 'Play / pause mission clock'],
    ['[ / ]', 'Step −1 / +1 day'],
    ['← / →', 'Step −1 / +1 hour'],
    ['C', 'Toggle comparison mode'],
    ['T', 'Toggle Terrain Lab (3D DEM inspector)'],
    ['O', 'Toggle Space views (planet time-lapse + fleet hangar)'],
    ['E', 'Toggle educator / planner mode'],
    ['G', 'Open field guide'],
    ['P', 'Pin current scenario'],
    ['?', 'Show this help'],
    ['Esc', 'Close overlays'],
  ];
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {keys.map(([k, desc]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}>
            <span className="kbd" style={{ minWidth: 60 }}>{k}</span><span style={{ color: 'var(--muted)' }}>{desc}</span>
          </div>
        ))}
      </div>
      {onReopenWelcome && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>New here? Reopen the welcome guide.</span>
          <button className="btn sm" onClick={onReopenWelcome}>Reopen welcome</button>
        </div>
      )}
    </Modal>
  );
}
