import { Info, ShieldCheck, ShieldAlert, FlaskConical, Mountain, AlertTriangle } from 'lucide-react';
import type { LandingSite, MissionSummary } from '../types/mission';
import { EPHEMERIS_FRAME } from '../engine/lunarFrame';

export type ProvenanceState =
  | 'SYNTHETIC DEMO'
  | 'ILLUSTRATIVE TERRAIN'
  | 'INCOMPLETE COVERAGE'
  | 'REAL DEM — FRAME UNVERIFIED'
  | 'REAL DEM — FRAME VERIFIED';

export interface ProvenanceInfo {
  state: ProvenanceState;
  color: string;
  bg: string;
  blurb: string;
}

/** Derive the honest provenance state from the ACTUAL terrain + frame metadata. */
export function provenanceOf(site: LandingSite): ProvenanceInfo {
  const t = site.terrain;
  if (t.synthetic) {
    return { state: 'SYNTHETIC DEMO', color: '#8a5a16', bg: '#f6ecd6', blurb: 'Procedural terrain for interface exploration. Not real lunar data; never a scientific result.' };
  }
  if (t.kind !== 'dem') {
    return { state: 'ILLUSTRATIVE TERRAIN', color: '#c4842a', bg: '#fdf0d5', blurb: 'LOLA-inspired illustrative / user-edited horizon. Not a measured flight DEM; ranking is indicative only.' };
  }
  if ((t.coveragePercent ?? 100) < 100) {
    return { state: 'INCOMPLETE COVERAGE', color: '#c4842a', bg: '#fdf0d5', blurb: 'Real DEM crop, but ray coverage is incomplete. Quantitative mission visibility is blocked until coverage is complete.' };
  }
  if (!t.frameVerified) {
    return { state: 'REAL DEM — FRAME UNVERIFIED', color: '#c23b32', bg: '#f8e3df', blurb: 'Real DEM, but its reference frame is not verified compatible with the IAU 2015 ephemeris frame. Viewable in Terrain Lab; blocked from quantitative mission visibility.' };
  }
  return { state: 'REAL DEM — FRAME VERIFIED', color: '#1f7a52', bg: '#e7f5ee', blurb: 'Real DEM rotated into the IAU 2015 ephemeris frame with a SPICE-verified constant correction. Residual disclosed below.' };
}

const ICONS: Record<ProvenanceState, typeof Info> = {
  'SYNTHETIC DEMO': FlaskConical,
  'ILLUSTRATIVE TERRAIN': Mountain,
  'INCOMPLETE COVERAGE': AlertTriangle,
  'REAL DEM — FRAME UNVERIFIED': ShieldAlert,
  'REAL DEM — FRAME VERIFIED': ShieldCheck,
};

interface Props {
  site: LandingSite;
  summary?: MissionSummary | null;
  /** compact = single stamp line (status bar); full = stamp + expandable detail. */
  compact?: boolean;
}

/**
 * Persistent, honest provenance indicator. The stamp reflects the real computation
 * state (synthetic / illustrative / real-DEM frame-verified / unverified / incomplete),
 * never a marketing label. Expand for resolution, radius, coverage, frame, uncertainty
 * and sampling. Data confidence is shown separately from performance.
 */
export function ProvenanceIndicator({ site, summary, compact }: Props) {
  const p = provenanceOf(site);
  const t = site.terrain;
  const Icon = ICONS[p.state];
  const confidence = summary?.dataConfidence ?? site.dataConfidence ?? (t.synthetic ? 'synthetic' : t.kind === 'dem' ? 'measured' : 'illustrative');

  if (compact) {
    return (
      <span className="mono" title={p.blurb} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: p.color, fontWeight: 600 }}>
        <Icon size={11} /> {p.state}
      </span>
    );
  }

  const rows: [string, string][] = [
    ['Ephemeris frame', EPHEMERIS_FRAME],
    ['Terrain source frame', t.sourceFrame ?? 'unspecified'],
  ];
  if (t.kind === 'dem' && !t.synthetic) {
    rows.push(['Frame transform', t.frameTransform ? `${t.frameTransform.toUpperCase()} → IAU (residual ≤ ${(t.frameResidualDeg ?? 0).toFixed(4)}°)` : 'none — unverified']);
    rows.push(['Azimuth offset applied', `${(t.azimuthOffsetDeg ?? 0).toFixed(4)}°`]);
  }
  rows.push(['Source file', t.sourceFile ?? '—']);
  rows.push(['Azimuth resolution', `${t.resolutionDeg}° bins${t.effectiveResolutionM ? ` · ~${t.effectiveResolutionM.toFixed(0)} m grid` : ''}`]);
  if (t.radiusKm != null) rows.push(['Analysis radius', `${t.radiusKm} km${t.horizonRadiusKm ? ` (horizon ${t.horizonRadiusKm} km)` : ''} · ${t.analysisScale ?? 'local'}`]);
  if (t.coveragePercent != null) rows.push(['Ray coverage', `${t.coveragePercent.toFixed(1)}%`]);
  rows.push(['Vertical uncertainty', t.verticalUncertaintyM != null ? `${t.verticalUncertaintyM} m (product)` : 'not certified by source metadata']);
  rows.push(['Angular uncertainty', `±${t.uncertaintyDeg}° (azimuth sampling half-width, not vertical accuracy)`]);
  rows.push(['Data confidence', confidence]);
  if (site.coordinateProvenance) rows.push(['Coordinate provenance', site.coordinateProvenance]);
  if (summary?.sampling) {
    rows.push(['Sampling', `${summary.sampling.sampleCount.toLocaleString()} samples · effective ${summary.sampling.effectiveStepMinutes.toFixed(2)} min${summary.sampling.capped ? ' (capped)' : ''}`]);
  }

  return (
    <details className="provenance" style={{ border: `1px solid ${p.color}`, background: p.bg, borderRadius: 0 }}>
      <summary style={{ listStyle: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, padding: '6px 9px', color: p.color }}>
        <Icon size={14} />
        <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4 }}>{p.state}</span>
        <Info size={11} style={{ marginLeft: 'auto', opacity: 0.7 }} />
      </summary>
      <div style={{ padding: '0 9px 8px', fontSize: 10.5, color: 'var(--ink-soft)' }}>
        <p style={{ margin: '2px 0 7px', lineHeight: 1.45 }}>{p.blurb}</p>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} style={{ borderTop: '1px dashed rgba(28,36,48,.15)' }}>
                <td className="mono" style={{ padding: '2px 6px 2px 0', color: 'var(--muted)', whiteSpace: 'nowrap', verticalAlign: 'top', fontSize: 9.5 }}>{k}</td>
                <td style={{ padding: '2px 0', lineHeight: 1.4 }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
