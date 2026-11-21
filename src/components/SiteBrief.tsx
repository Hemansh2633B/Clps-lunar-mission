import { useState } from 'react';
import { Copy, Crosshair, ExternalLink, Mountain, Pin, Table2 } from 'lucide-react';
import { EXTERNAL_VIEWERS, coordinateText } from '../data/catalogue';
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
        <span className="chip neutral">{site.category === 'polar' ? (site.latitude >= 0 ? 'North pole' : 'South pole') : site.side === 'far' ? 'Far side' : site.side === 'limb' ? 'Limb band' : 'Near side'}</span>
      </div>
      <div style={{ position: 'relative', height: 92, overflow: 'hidden', borderBottom: '1px solid var(--line)', background: '#fdf6e8' }}>
        <img src="/assets/lander.jpg" alt="" aria-hidden="true" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 62%', mixBlendMode: 'multiply', opacity: 0.9 }} />
        <span className="stamp brass" style={{ position: 'absolute', right: 8, bottom: 8, transform: 'rotate(-2deg)', background: 'rgba(255,250,242,.85)' }}>PLATE · RIM STUDY</span>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        <div>
          <div className="display" style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.15 }}>{site.name}</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{formatCoord(site.latitude, site.longitude)} · elev {site.elevationAvailable === false ? 'unavailable' : `${site.elevationM} m`}{site.terrain.slopeDeg != null ? ` · slope ${site.terrain.slopeDeg.toFixed(1)}°` : ''}</div>
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
            <div style={{ color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 9 }}>Sun · az / el</div>
            <div className="mono" style={{ fontSize: 12, color: visibilityBlocked ? 'var(--dim)' : current.sunVisibility.visible ? 'var(--nominal)' : 'var(--blocked)' }}>{current.sun.azimuthDeg.toFixed(1)}° / {current.sun.elevationDeg.toFixed(2)}°</div>
            <div style={{ color: 'var(--dim)', fontSize: 9 }}>clearance {visibilityBlocked ? 'blocked' : `${current.sunVisibility.clearanceDeg.toFixed(2)}°`} · {current.sunVisibility.visible ? 'terrain + limb clear' : current.sunVisibility.reason === 'lunar-limb' ? 'Moon limb blocks' : current.sunVisibility.reason === 'terrain' ? 'local terrain blocks' : 'below local horizon'}</div>
          </div>
          <div className="panel" style={{ padding: 8, background: '#fffdf7' }}>
            <div style={{ color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 9 }}>Earth · az / el</div>
            <div className="mono" style={{ fontSize: 12, color: visibilityBlocked ? 'var(--dim)' : current.earthVisibility.visible ? 'var(--nominal)' : 'var(--blocked)' }}>{current.earth.azimuthDeg.toFixed(1)}° / {current.earth.elevationDeg.toFixed(2)}°</div>
            <div style={{ color: 'var(--dim)', fontSize: 9 }}>{visibilityBlocked ? 'visibility gated' : current.earthVisibility.bodyOccultation === 'occulted' ? 'lunar body blocks Earth' : current.earthVisibility.bodyOccultation === 'partial' ? 'Earth disk partly behind limb' : current.earthVisibility.visible ? 'geometric LOS clear · not RF' : current.earthVisibility.reason === 'margin' ? 'comms margin not met' : current.earthVisibility.reason === 'terrain' ? 'local terrain blocks' : 'below local horizon'}</div>
          </div>
        </div>
        {(current.incidence || current.relay) && <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '7px 8px', border: '1px solid var(--border)', background: '#fffdf7', fontSize: 10 }}>
          {current.incidence && <div>Terrain incidence <b>{current.incidence.incidenceDeg.toFixed(1)}°</b> · slope {current.incidence.slopeDeg.toFixed(1)}° / aspect {current.incidence.aspectDeg.toFixed(1)}° ({current.incidence.source})</div>}
          {current.relay && <div style={{ color: current.relay.linkUp ? 'var(--nominal)' : 'var(--blocked)' }}>Relay geometry: {current.relay.linkUp ? 'both legs clear' : `site→relay ${current.relay.siteBodyClear && current.relay.siteTerrainClear ? 'clear' : 'blocked'}, relay→Earth ${current.relay.earthClear ? 'clear' : 'Moon-blocked'}`} · {current.relay.rangeKm.toFixed(0)} km · NOT an RF link</div>}
        </div>}
        <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
          <button className="btn sm" onClick={onHorizonTable}><Table2 size={12} /> Horizon table</button>
          <button className="btn sm primary" onClick={onPin}><Pin size={12} /> Pin scenario</button>
        </div>
        <ExternalViewers latitude={site.latitude} longitude={site.longitude} />
        <div role="note" aria-label="Terrain data status" style={{ fontSize: 9, color: footerColor, lineHeight: 1.5 }}>
          {footer.text}
          {site.terrain.kind === 'dem' && !site.terrain.synthetic ? ` Azimuth sampling half-width ±${site.terrain.uncertaintyDeg.toFixed(2)}°; ${site.terrain.accuracyNote ?? 'vertical accuracy unverified.'}` : ''}
        </div>
      </div>
    </section>
  );
}

/**
 * Jump to NASA's own viewers for this location. Neither QuickMap nor Moon Trek
 * documents a stable deep-link format, so the links open the tool itself and the
 * coordinates are copied for pasting into its search box — no guessed URL scheme.
 */
function ExternalViewers({ latitude, longitude }: { latitude: number; longitude: number }) {
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);
  const text = coordinateText(latitude, longitude);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${latitude.toFixed(4)}, ${(((longitude + 180) % 360 + 360) % 360 - 180).toFixed(4)}`);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
    window.setTimeout(() => setCopied(null), 2500);
  };
  return (
    <div data-testid="external-viewers" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 10 }}>
      <span style={{ color: 'var(--dim)' }}>Inspect in</span>
      {Object.values(EXTERNAL_VIEWERS).map((v) => (
        <a key={v.url} className="btn sm ghost" href={v.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }} title={`Opens ${v.label} in a new tab. Paste the copied coordinates into its search box.`}>
          {v.label} <ExternalLink size={10} />
        </a>
      ))}
      <button className="btn sm ghost" onClick={() => void copy()} title={text} aria-label={`Copy site coordinates: ${text}`}><Copy size={10} /> Copy lat, lon</button>
      <span role="status" style={{ color: copied === 'failed' ? 'var(--crimson)' : 'var(--nominal)' }}>
        {copied === 'ok' ? 'Copied' : copied === 'failed' ? `Copy blocked — ${text}` : ''}
      </span>
    </div>
  );
}
