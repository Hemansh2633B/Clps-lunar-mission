import { Crosshair, Mountain, Pin, Table2 } from 'lucide-react';
import type { EvaluatedSample, LandingSite } from '../types/mission';
import { formatCoord } from '../engine/constants';

interface Props {
  site: LandingSite;
  current: EvaluatedSample;
  onHorizonTable: () => void;
  onPin: () => void;
}

export function SiteBrief({ site, current, onHorizonTable, onPin }: Props) {
  return (
    <section className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span className="panel-title"><Crosshair size={13} /> Site context</span>
        <span className="chip neutral">{site.category === 'polar' ? 'South pole' : 'Reference'}</span>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{site.name}</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{formatCoord(site.latitude, site.longitude)} · elev {site.elevationM} m</div>
        </div>
        <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>{site.description}</p>
        <div>
          <div className="panel-title" style={{ marginBottom: 6 }}><Mountain size={12} /> Horizon features</div>
          {site.terrain.features.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--dim)' }}>Idealized flat / spherical horizon. No terrain occlusion modeled.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {site.terrain.features.map((f) => (
                <div key={f.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '4px 0', borderBottom: '1px solid #161c26' }}>
                  <span style={{ color: 'var(--muted)' }}>{f.name}</span>
                  <span className="mono" style={{ color: f.kind === 'drop' ? 'var(--earth)' : 'var(--text)' }}>{f.azimuthDeg.toFixed(0)}° / {f.elevationDeg > 0 ? '+' : ''}{f.elevationDeg.toFixed(1)}°</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 10 }}>
          <div className="panel" style={{ padding: 8, background: '#0c1017' }}>
            <div style={{ color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 9 }}>Sun clearance</div>
            <div className="mono" style={{ fontSize: 14, color: current.sunVisibility.visible ? 'var(--nominal)' : 'var(--blocked)' }}>{current.sunVisibility.clearanceDeg.toFixed(2)}°</div>
          </div>
          <div className="panel" style={{ padding: 8, background: '#0c1017' }}>
            <div style={{ color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 9 }}>Earth clearance</div>
            <div className="mono" style={{ fontSize: 14, color: current.earthVisibility.visible ? 'var(--nominal)' : 'var(--blocked)' }}>{current.earthVisibility.clearanceDeg.toFixed(2)}°</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
          <button className="btn sm" onClick={onHorizonTable}><Table2 size={12} /> Horizon table</button>
          <button className="btn sm primary" onClick={onPin}><Pin size={12} /> Pin scenario</button>
        </div>
        <div style={{ fontSize: 9, color: 'var(--dim)', lineHeight: 1.5 }}>
          Terrain mask is LOLA-inspired and illustrative (±{site.terrain.uncertaintyDeg.toFixed(2)}°). Coordinates are real; elevations are representative. Not for flight certification.
        </div>
      </div>
    </section>
  );
}
