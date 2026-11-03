import { useState } from 'react';
import { X, Download, Plus } from 'lucide-react';
import type { EvaluatedSample, LandingSite, MissionConfig } from '../types/mission';
import type { CustomTerrainPreset } from '../data/landingSites';
import { horizonTable } from '../engine/horizonPhysics';
import { formatCoord } from '../engine/constants';

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal fade-in ${wide ? 'wide' : ''}`}>
        <div className="modal-header">
          <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
          <button className="btn sm ghost icon" onClick={onClose}><X size={13} /></button>
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
  const num = (key: keyof MissionConfig, label: string, step = 1, min = 0, max = 10000) => (
    <div className="field"><label>{label}</label><input className="input mono" type="number" step={step} min={min} max={max} value={config[key] as number} onChange={(e) => onChange({ ...config, [key]: Number(e.target.value) })} /></div>
  );
  return (
    <Modal title="Mission parameters" onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div className="field"><label>Array geometry</label>
          <select className="input" value={config.arrayMode} onChange={(e) => onChange({ ...config, arrayMode: e.target.value as MissionConfig['arrayMode'] })}>
            <option value="horizontal">Horizontal deck</option>
            <option value="vertical-tracking">Vertical mast (az tracking)</option>
            <option value="vertical-fixed">Vertical mast (fixed az)</option>
          </select>
        </div>
        {num('arrayAreaM2', 'Array area (m²)', 0.5, 0.1, 200)}
        {num('cellEfficiency', 'Cell efficiency', 0.01, 0.05, 0.5)}
        {num('systemDerate', 'System derate', 0.01, 0.3, 1)}
        {num('loadW', 'Surface load (W)', 10, 0, 10000)}
        {num('batteryCapacityKWh', 'Battery (kWh)', 1, 0.1, 1000)}
        {num('initialSocPct', 'Initial SOC (%)', 5, 0, 100)}
        {num('commsMarginDeg', 'DTE elevation margin (°)', 0.1, 0, 10)}
        {num('stepMinutes', 'Sample step (min)', 5, 1, 240)}
        <div className="field"><label>Fixed panel azimuth (°)</label><input className="input mono" type="number" min={0} max={360} value={config.fixedPanelAzimuthDeg} onChange={(e) => onChange({ ...config, fixedPanelAzimuthDeg: Number(e.target.value) })} /></div>
        {num('durationDays', 'Mission duration (d)', 1, 1, 90)}
      </div>
      <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 14, lineHeight: 1.6 }}>
        Power model: P = flux × area × cell efficiency × derate × max(0, cos incidence). Horizontal uses sin(elevation); vertical tracking uses cos(elevation); fixed vertical adds cos(azimuth offset). Battery integrates net power with 92% charge / 95% discharge efficiency. DTE requires Earth center above terrain + margin. No atmospheric refraction.
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}><button className="btn primary" onClick={onClose}>Done</button></div>
    </Modal>
  );
}

export function HorizonTableModal({ site, current, onClose, onExport }: { site: LandingSite; current: EvaluatedSample; onClose: () => void; onExport: () => void }) {
  const rows = horizonTable(site, current, 5);
  return (
    <Modal title={`Horizon elevation table · ${site.shortName}`} onClose={onClose} wide>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{site.terrain.label} · 5° bins · Sun az {current.sun.azimuthDeg.toFixed(1)}°, Earth az {current.earth.azimuthDeg.toFixed(1)}°</span>
        <button className="btn sm" onClick={onExport}><Download size={12} /> CSV</button>
      </div>
      <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 5 }}>
        <table className="table">
          <thead><tr><th>Az (°)</th><th>Terrain (°)</th><th>Sun clearance (°)</th><th>Earth clearance (°)</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.azimuthDeg}>
                <td>{r.azimuthDeg}</td>
                <td>{r.terrainElevationDeg.toFixed(2)}</td>
                <td style={{ color: r.sunClearanceDeg == null ? 'var(--dim)' : r.sunClearanceDeg >= 0 ? 'var(--nominal)' : 'var(--blocked)' }}>{r.sunClearanceDeg == null ? '—' : r.sunClearanceDeg.toFixed(2)}</td>
                <td style={{ color: r.earthClearanceDeg == null ? 'var(--dim)' : r.earthClearanceDeg >= 0 ? 'var(--nominal)' : 'var(--blocked)' }}>{r.earthClearanceDeg == null ? '—' : r.earthClearanceDeg.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const keys: [string, string][] = [
    ['Space', 'Play / pause mission clock'],
    ['[ / ]', 'Step −1 / +1 day'],
    ['← / →', 'Step −1 / +1 hour'],
    ['C', 'Toggle comparison mode'],
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
    </Modal>
  );
}
