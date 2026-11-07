import { Crosshair, Mountain, Pin, Table2 } from 'lucide-react';
import type { AnalysisAssessment, EvaluatedSample, LandingSite } from '../types/mission';
import { demFooterStatus } from '../utils/a11y';
import { formatCoord } from '../engine/constants';

interface Props {
  site: LandingSite;
  current: EvaluatedSample;
  onHorizonTable: () => void;
  onPin: () => void;
  visibilityBlocked?: boolean;
  /** Mission-window assessment — the footer quotes it verbatim when blocked. */
  analysis?: AnalysisAssessment | null;
}

export function SiteBrief({ site, current, onHorizonTable, onPin, visibilityBlocked, analysis }: Props) {
  const footer = demFooterStatus(site, analysis ?? null, !!visibilityBlocked);
  const footerColor = footer.tone === 'blocked' ? 'var(--blocked)' : footer.tone === 'ok' ? 'var(--nominal)' : footer.tone === 'warn' ? 'var(--solar)' : 'var(--dim)';
  return (
    <section className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span className="panel-title"><Crosshair size={13} /> Site context</span>
        <span className="chip neutral">{site.category === 'polar' ? (site.latitude >= 0 ? 'North pole' : 'South pole') : 'Reference'}</span>
      </div>
      <div style={{ position: 'relative', height: 92, overflow: 'hidden', borderBottom: '1px solid var(--line)', background: '#fdf6e8' }}>
        <img src="/assets/lander.jpg" alt="" aria-hidden="true" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 62%', mixBlendMode: 'multiply', opacity: 0.9 }} />
        <span className="stamp brass" style={{ position: 'absolute', right: 8, bottom: 8, transform: 'rotate(-2deg)', background: 'rgba(255,250,242,.85)' }}>PLATE · RIM STUDY</span>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        <div>
          <div className="display" style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.15 }}>{site.name}</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{formatCoord(site.latitude, site.longitude)} · elev {site.elevationM} m</div>
        </div>
        <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>{site.description}</p>
        <div>
          <div className="panel-title" style={{ marginBottom: 6 }}><Mountain size={12} /> {site.terrain.kind === 'dem' ? 'DEM horizon provenance' : 'Horizon features'}</div>
          {site.terrain.kind === 'dem' ? (
            <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.6 }}>
              <div>{site.terrain.synthetic ? 'Synthetic demo samples — NOT real lunar data.' : 'Measured/sample elevations preserved; no illustrative ripple added.'}</div>
              <div className="mono">Source {site.terrain.sourceFile ?? 'unknown'} · {site.terrain.gridSize ?? '?'}² grid · {site.terrain.samplingDeg ?? site.terrain.resolutionDeg}° bins</div>
              <div className="mono">Coverage {site.terrain.coveragePercent?.toFixed(1) ?? '?'}% · radius {site.terrain.radiusKm ?? '?'} km · horizon {site.terrain.horizonRadiusKm ?? '?'} km · eye {site.terrain.eyeHeightM} m</div>
            </div>
          ) : site.terrain.features.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--dim)' }}>Idealized flat / spherical horizon. No terrain occlusion modeled.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {site.terrain.features.map((f) => (
                <div key={f.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '4px 0', borderBottom: '1px solid #f3e6d0' }}>
                  <span style={{ color: 'var(--muted)' }}>{f.name}</span>
                  <span className="mono" style={{ color: f.kind === 'drop' ? 'var(--earth)' : 'var(--text)' }}>{f.azimuthDeg.toFixed(0)}° / {f.elevationDeg > 0 ? '+' : ''}{f.elevationDeg.toFixed(1)}°</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 10 }}>
          <div className="panel" style={{ padding: 8, background: '#fffdf7' }}>
            <div style={{ color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 9 }}>Sun clearance</div>
            <div className="mono" style={{ fontSize: 14, color: visibilityBlocked ? 'var(--dim)' : current.sunVisibility.visible ? 'var(--nominal)' : 'var(--blocked)' }}>{visibilityBlocked ? 'blocked' : `${current.sunVisibility.clearanceDeg.toFixed(2)}°`}</div>
          </div>
          <div className="panel" style={{ padding: 8, background: '#fffdf7' }}>
            <div style={{ color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 9 }}>Earth clearance</div>
            <div className="mono" style={{ fontSize: 14, color: visibilityBlocked ? 'var(--dim)' : current.earthVisibility.visible ? 'var(--nominal)' : 'var(--blocked)' }}>{visibilityBlocked ? 'blocked' : `${current.earthVisibility.clearanceDeg.toFixed(2)}°`}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
          <button className="btn sm" onClick={onHorizonTable}><Table2 size={12} /> Horizon table</button>
          <button className="btn sm primary" onClick={onPin}><Pin size={12} /> Pin scenario</button>
        </div>
        <div role="note" aria-label="Terrain data status" style={{ fontSize: 9, color: footerColor, lineHeight: 1.5 }}>
          {footer.text}
          {site.terrain.kind === 'dem' && !site.terrain.synthetic ? ` Azimuth sampling half-width ±${site.terrain.uncertaintyDeg.toFixed(2)}°; ${site.terrain.accuracyNote ?? 'vertical accuracy unverified.'}` : ''}
        </div>
      </div>
    </section>
  );
}
