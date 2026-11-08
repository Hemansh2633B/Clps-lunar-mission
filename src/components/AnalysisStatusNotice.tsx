import { ShieldAlert, FlaskConical, Mountain, AlertTriangle, Gauge } from 'lucide-react';
import type { AnalysisAssessment, AnalysisStatus, MissionSummary } from '../types/mission';
import { energyResolutionDisclosure } from '../engine/analysisStatus';

const STATUS_LABEL: Record<AnalysisStatus, string> = {
  VALID: 'Quantitative analysis',
  SYNTHETIC_DEMO: 'Synthetic demonstration',
  ILLUSTRATIVE: 'Illustrative demonstration',
  FRAME_UNVERIFIED: 'Frame unverified — analysis blocked',
  INCOMPLETE_COVERAGE: 'Incomplete coverage — analysis blocked',
  FRAME_MODEL_OUTSIDE_VALIDATED_RANGE: 'Outside validated frame range — analysis blocked',
  NUMERICAL_RESOLUTION_INSUFFICIENT: 'Numerical resolution insufficient — analysis blocked',
  COMPUTATION_FAILED: 'Computation failed',
};

/**
 * Renders the computation-boundary scientific status. For a BLOCKED analysis it shows
 * the reason + an actionable resolution INSTEAD of ordinary quantitative conclusions.
 * For eligible/demo analyses it returns null (the ProvenanceIndicator carries the label).
 * Color is never the only signal — an icon + explicit text always accompany the status.
 */
export function AnalysisStatusNotice({ analysis, compact }: { analysis: AnalysisAssessment; compact?: boolean }) {
  if (analysis.demoEligible) return null;
  const Icon = analysis.status === 'FRAME_UNVERIFIED' ? ShieldAlert
    : analysis.status === 'COMPUTATION_FAILED' ? AlertTriangle
      : analysis.status === 'NUMERICAL_RESOLUTION_INSUFFICIENT' ? Gauge : AlertTriangle;
  const reason = 'reason' in analysis ? analysis.reason : '';
  const resolution = 'resolution' in analysis ? analysis.resolution : '';
  return (
    <div role="alert" style={{ border: '1px solid var(--blocked)', background: '#f8e3df', color: '#8f2b23', padding: compact ? 8 : 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, fontSize: compact ? 10.5 : 12 }}>
        <Icon size={compact ? 13 : 15} style={{ flexShrink: 0 }} /> {STATUS_LABEL[analysis.status]}
      </div>
      <p style={{ margin: 0, fontSize: compact ? 10 : 11.5, lineHeight: 1.5 }}>{reason}</p>
      {!compact && (
        <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>
          <strong>How to resolve:</strong> {resolution}
        </p>
      )}
      {!compact && (
        <p style={{ margin: 0, fontSize: 10, color: '#a05248', lineHeight: 1.45 }}>
          No quantitative mission conclusions are shown for this dataset. The terrain remains viewable in Terrain Lab.
        </p>
      )}
    </div>
  );
}

/** Small inline badge for the analysis status (used in comparison cards / headers). */
export function AnalysisStatusBadge({ analysis }: { analysis: AnalysisAssessment }) {
  const blocked = !analysis.demoEligible;
  const demo = analysis.status === 'SYNTHETIC_DEMO' || analysis.status === 'ILLUSTRATIVE';
  const Icon = blocked ? ShieldAlert : analysis.status === 'SYNTHETIC_DEMO' ? FlaskConical : analysis.status === 'ILLUSTRATIVE' ? Mountain : Gauge;
  const color = blocked ? '#c23b32' : demo ? '#c4842a' : '#1f7a52';
  return (
    <span className="mono" title={STATUS_LABEL[analysis.status]} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 8.5, fontWeight: 700, color, letterSpacing: 0.3 }}>
      <Icon size={10} /> {blocked ? 'BLOCKED' : demo ? 'DEMO' : 'VALID'}
    </span>
  );
}


/** Persistent, non-blocking warning shared by telemetry and comparison cards. */
export function EnergyResolutionNotice({ summary, compact }: { summary: MissionSummary | null | undefined; compact?: boolean }) {
  const disclosure = energyResolutionDisclosure(summary?.integrationDiagnostics);
  if (!disclosure) return null;
  return (
    <div role="note" aria-label="Energy integration resolution warning" style={{ border: '1px solid var(--solar)', background: '#fdf0d5', color: 'var(--brass)', padding: compact ? 8 : 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: compact ? 10.5 : 11.5 }}>
        <Gauge size={13} style={{ flexShrink: 0 }} /> Coarse energy integration — result uncertain
      </div>
      <p style={{ margin: 0, fontSize: compact ? 10 : 11, lineHeight: 1.5 }}>{disclosure.message}</p>
    </div>
  );
}
