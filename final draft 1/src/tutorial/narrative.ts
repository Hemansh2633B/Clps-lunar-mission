/**
 * Branching narrative layer for THE 14-DAY WINDOW.
 *
 * Pure functions: (chapter, live world) → dialogue + readouts. Every number comes
 * from the same engine results the instruments show (current sample, mission
 * summary, baseline summary, analysis assessment). Branches are driven by
 * `AnalysisAssessment` and real state — never by decorative graphics, never by
 * pre-scripted outcomes. Blocked analyses produce an explanation, NOT a verdict.
 */
import type {
  AnalysisAssessment, EvaluatedSample, LandingSite, MissionConfig, MissionSummary,
} from '../types/mission';
import type { DialogueLine } from './story';
import { explainClearance, explainEarthLos, explainIllumination, explainVerdict } from '../utils/explain';

export interface StoryWorld {
  site: LandingSite;
  current: EvaluatedSample;
  config: MissionConfig;
  presetName: string;
  slipDays: number;
  missionStartMs: number;
  /** Mission-window summary (null while computing or blocked). */
  summary: MissionSummary | null;
  /** Same site + config at the unslipped baseline start. */
  baselineSummary: MissionSummary | null;
  analysis: AnalysisAssessment | null;
  loading: boolean;
  scenarioCount: number;
  compareMode: boolean;
}

export interface LiveReadout {
  label: string;
  value: string;
}

export interface ChapterNarrative {
  lines: DialogueLine[];
  readouts: LiveReadout[];
  /** Caveat strip rendered under the readouts (blocked / computing / RF notice). */
  note?: string;
}

const deg = (n: number, digits = 1) => `${n.toFixed(digits)}°`;
const pct = (n: number) => `${n.toFixed(0)}%`;
const hours = (n: number) => `${n.toFixed(1)} h`;
const watts = (n: number) => `${n.toFixed(0)} W`;

const CONFIDENCE_LABEL: Record<string, string> = {
  measured: 'measured reference data',
  'region-approximate': 'an approximate region center (±0.5°) — not a surveyed landing point',
  illustrative: 'an illustrative planning mask — not measured terrain',
  synthetic: 'synthetic demo terrain — not real lunar data',
};

/** Honest one-line provenance for the selected site, from catalogue metadata. */
export function describeProvenance(site: LandingSite): string {
  const conf = CONFIDENCE_LABEL[site.dataConfidence ?? 'illustrative'] ?? 'unclassified data';
  const parts = [`This site is ${conf}.`];
  if (site.coordinateType === 'surveyed') parts.push('Its coordinates are a surveyed reference point.');
  if (site.terrain.kind === 'dem') {
    parts.push(site.terrain.frameVerified
      ? `DEM frame ${site.terrain.sourceFrame ?? '?'} is allowlisted and rotated into the ephemeris frame, with the residual disclosed.`
      : `DEM frame ${site.terrain.sourceFrame ?? 'unspecified'} is NOT verified — quantitative results are blocked until it is resolved.`);
  }
  if (site.terrain.synthetic) parts.push('The horizon is synthetic and labeled as a demo wherever it appears.');
  return parts.join(' ');
}

function blockedNarrative(analysis: AnalysisAssessment): ChapterNarrative | null {
  if (analysis.demoEligible) return null;
  return {
    lines: [
      { speaker: 'ARIN', text: `Hold on — this analysis is blocked: ${analysis.reason}` },
      { speaker: 'MIRA', text: `No verdict until that is fixed. ${analysis.resolution} I will not read you numbers the model refuses to stand behind.` },
    ],
    readouts: [{ label: 'Analysis status', value: analysis.status }],
    note: 'Analysis blocked — no quantitative verdict is shown or exported.',
  };
}

export type SlipOutcome = 'blocked' | 'baseline' | 'computing' | 'better' | 'worse' | 'similar';

/** Which way the slip actually moved the combined-visibility budget (>1 pp threshold). */
export function slipOutcome(w: StoryWorld): SlipOutcome {
  if (w.analysis && !w.analysis.demoEligible) return 'blocked';
  if (w.slipDays === 0) return 'baseline';
  if (!w.summary || !w.baselineSummary) return 'computing';
  const delta = w.summary.combinedPct - w.baselineSummary.combinedPct;
  if (delta > 1) return 'better';
  if (delta < -1) return 'worse';
  return 'similar';
}

function slipNarrative(w: StoryWorld): ChapterNarrative {
  const outcome = slipOutcome(w);
  if (outcome === 'blocked') return blockedNarrative(w.analysis!)!;
  if (outcome === 'baseline') {
    return {
      lines: [{ speaker: 'MIRA', text: 'We are still on the baseline window — slip is zero. Drag the launch-slip slider (try +14 days) and I will read you the difference the solver computes.' }],
      readouts: [{ label: 'Launch slip', value: '0 days (baseline)' }],
    };
  }
  if (outcome === 'computing' || !w.summary || !w.baselineSummary) {
    return {
      lines: [{ speaker: 'ARIN', text: 'The solver is recomputing the slipped window against the baseline. I will read the difference when both results are in — no guessed numbers.' }],
      readouts: [{ label: 'Launch slip', value: `+${w.slipDays.toFixed(2)} days` }],
      note: 'Waiting for baseline and slipped summaries…',
    };
  }
  const s = w.summary;
  const b = w.baselineSummary;
  const delta = s.combinedPct - b.combinedPct;
  const verdictLine: Record<'better' | 'worse' | 'similar', string> = {
    better: `The slip actually helps here: simultaneous Sun + Earth coverage rises by ${Math.abs(delta).toFixed(1)} percentage points. Good news is still a model result — check the confidence tier before celebrating.`,
    worse: `The slip hurts: simultaneous Sun + Earth coverage drops by ${Math.abs(delta).toFixed(1)} percentage points. This is what a two-week slide can do when the Sun marches half a circle around the horizon.`,
    similar: `The combined coverage barely moves (${Math.abs(delta).toFixed(1)} percentage points). Check the longest outage below — similar totals can still hide a different worst gap.`,
  };
  return {
    lines: [
      { speaker: 'ARIN', text: verdictLine[outcome as 'better' | 'worse' | 'similar'] },
      { speaker: 'MIRA', text: `Longest stretch without both Sun and Earth: ${hours(b.longestCombinedGapHours)} on the baseline versus ${hours(s.longestCombinedGapHours)} after the slip. That gap is what the battery has to ride out.` },
    ],
    readouts: [
      { label: 'Launch slip', value: `+${w.slipDays.toFixed(2)} days` },
      { label: 'Sun + Earth, baseline → slipped', value: `${pct(b.combinedPct)} → ${pct(s.combinedPct)}` },
      { label: 'Longest combined gap', value: `${hours(b.longestCombinedGapHours)} → ${hours(s.longestCombinedGapHours)}` },
    ],
  };
}

function batteryNarrative(w: StoryWorld): ChapterNarrative {
  if (w.analysis && !w.analysis.demoEligible) return blockedNarrative(w.analysis)!;
  if (!w.summary) {
    return {
      lines: [{ speaker: 'ARIN', text: 'The mission window is still computing — the battery report appears when the solver finishes. Nothing to read yet, and nothing invented.' }],
      readouts: [],
      note: w.loading ? 'Computing mission window…' : 'No summary available yet.',
    };
  }
  const s = w.summary;
  const consumedKWh = (w.config.loadW * s.durationHours) / 1000;
  const lines: DialogueLine[] = [
    { speaker: 'ARIN', text: `This window generates ${s.selectedEnergyKWh.toFixed(1)} kWh and the ${watts(w.config.loadW)} load consumes ${consumedKWh.toFixed(1)} kWh. We start at ${w.config.initialSocPct.toFixed(0)}% charge, with 92% charge / 95% discharge efficiency. Lowest modeled state of charge: ${pct(s.minBatterySocPct)}.` },
    { speaker: 'MIRA', text: explainVerdict(s) },
  ];
  if (s.depletionHours > 0) {
    lines.push({ speaker: 'MIRA', text: `The model spends ${hours(s.depletionHours)} at 0% — an ENERGY DEFICIT under these assumptions. That is not a survival prediction: thermal, radiation and hardware limits are not modeled.` });
  }
  return {
    lines,
    readouts: [
      { label: 'Generated / consumed', value: `${s.selectedEnergyKWh.toFixed(1)} / ${consumedKWh.toFixed(1)} kWh` },
      { label: 'Minimum state of charge', value: pct(s.minBatterySocPct) },
      { label: 'Hours at 0% (deficit)', value: hours(s.depletionHours) },
      { label: 'Verdict', value: s.verdict },
    ],
    note: 'Energy-balance model only — not thermal or spacecraft survival.',
  };
}

export function chapterNarrative(chapter: number, w: StoryWorld): ChapterNarrative {
  const blocked = w.analysis ? blockedNarrative(w.analysis) : null;
  switch (chapter) {
    case 0:
      return { lines: [], readouts: [] };
    case 1:
      return {
        lines: [
          { speaker: 'MIRA', text: `Selected: ${w.site.name} at ${deg(Math.abs(w.site.latitude), 2)}${w.site.latitude < 0 ? 'S' : 'N'}, ${deg(Math.abs(w.site.longitude), 2)}${w.site.longitude < 0 ? 'W' : 'E'}.` },
          { speaker: 'ARIN', text: describeProvenance(w.site) },
        ],
        readouts: [
          { label: 'Latitude / longitude', value: `${deg(w.site.latitude, 2)} / ${deg(w.site.longitude, 2)}` },
          { label: 'Data confidence', value: w.site.dataConfidence ?? 'illustrative' },
          { label: 'Terrain source', value: w.site.terrain.label },
        ],
        note: blocked ? 'Heads-up: the current analysis is blocked — chapter 2 will explain why.' : undefined,
      };
    case 2: {
      if (blocked) return blocked;
      const lines: DialogueLine[] = [
        { speaker: 'ARIN', text: explainClearance('Sun', w.current.sunVisibility) },
      ];
      const readouts: LiveReadout[] = [
        { label: 'Sun elevation / azimuth', value: `${deg(w.current.sun.elevationDeg)} / ${deg(w.current.sun.azimuthDeg)}` },
        { label: 'Terrain clearance', value: deg(w.current.sunVisibility.clearanceDeg, 2) },
      ];
      if (w.summary) {
        lines.push({ speaker: 'MIRA', text: `${explainIllumination(w.summary.illuminationPct)} Longest single eclipse: ${hours(w.summary.longestEclipseHours)}.` });
        readouts.push({ label: 'Window illumination', value: pct(w.summary.illuminationPct) });
      }
      return { lines, readouts, note: w.summary ? undefined : 'Mission summary still computing — instant readings above are live.' };
    }
    case 3: {
      if (blocked) return blocked;
      const lines: DialogueLine[] = [
        { speaker: 'ARIN', text: `${explainClearance('Earth', w.current.earthVisibility)} Libration right now puts the sub-Earth point at ${deg(w.current.libration.subEarthLatitudeDeg, 2)}, ${deg(w.current.libration.subEarthLongitudeDeg, 2)}.` },
        { speaker: 'MIRA', text: w.summary ? explainEarthLos(w.summary.dtePct, w.summary.earthNeverVisible) : 'Geometric Earth line-of-sight is not an RF link budget.' },
      ];
      const readouts: LiveReadout[] = [
        { label: 'Earth elevation', value: deg(w.current.earth.elevationDeg) },
        { label: 'Sub-Earth point (lat, lon)', value: `${deg(w.current.libration.subEarthLatitudeDeg, 2)}, ${deg(w.current.libration.subEarthLongitudeDeg, 2)}` },
      ];
      if (w.summary) {
        readouts.push({ label: 'Window DTE availability', value: pct(w.summary.dtePct) });
        readouts.push({ label: 'Longest DTE gap', value: hours(w.summary.longestDteGapHours) });
      }
      return { lines, readouts, note: 'Geometric line-of-sight only — NOT an RF link budget.' };
    }
    case 4: {
      if (blocked) return blocked;
      const p = w.current.power;
      return {
        lines: [
          { speaker: 'ARIN', text: `Right now a horizontal panel would make ${watts(p.horizontalW)} while a Sun-tracking vertical panel would make ${watts(p.verticalTrackingW)} — same sunlight, different incidence. ${p.verticalTrackingW > p.horizontalW * 1.5 ? 'That gap is the polar grazing-light problem in one sentence.' : 'With the Sun this high the orientation matters less.'}` },
          { speaker: 'MIRA', text: `Current preset: ${w.presetName}. Presets are illustrative planning assumptions, not NASA vehicle specs — every assumption is yours to change and is disclosed in the report.` },
        ],
        readouts: [
          { label: 'Solar flux', value: `${p.fluxWm2.toFixed(0)} W/m²` },
          { label: 'Selected array output', value: watts(p.selectedW) },
          { label: 'Horizontal / vertical-tracking', value: `${watts(p.horizontalW)} / ${watts(p.verticalTrackingW)}` },
        ],
        note: 'Power (W) is a rate; energy (kWh) is that rate accumulated over time.',
      };
    }
    case 5:
      return slipNarrative(w);
    case 6:
      return batteryNarrative(w);
    case 7: {
      if (blocked) return blocked;
      if (w.scenarioCount < 2) {
        return {
          lines: [{ speaker: 'MIRA', text: `${w.scenarioCount === 0 ? 'Nothing pinned yet.' : 'One window pinned.'} Pin the current window, change one assumption — the slip is a good test — and pin again. Two rows make a comparison; one row is just a number.` }],
          readouts: [{ label: 'Pinned scenarios', value: `${w.scenarioCount} / 2 needed` }],
        };
      }
      return {
        lines: [
          { speaker: 'ARIN', text: `You have ${w.scenarioCount} windows on the sheet. Read one meaningful difference — combined visibility or the longest gap — and check it is attributable to the single assumption you changed.` },
          { speaker: 'MIRA', text: `Confidence check: the selected site is ${CONFIDENCE_LABEL[w.site.dataConfidence ?? 'illustrative']}. A higher heuristic score on weaker data never outranks measured terrain.` },
        ],
        readouts: [
          { label: 'Pinned scenarios', value: String(w.scenarioCount) },
          { label: 'Selected-site confidence', value: w.site.dataConfidence ?? 'illustrative' },
        ],
        note: 'The feasibility score is an application-defined heuristic — not a NASA methodology.',
      };
    }
    case 8: {
      if (blocked) {
        const b = blockedNarrative(w.analysis!)!;
        return { ...b, lines: [...b.lines, { speaker: 'MIRA', text: 'The export guard will refuse this window, and that is correct behavior. Resolve the flagged issue or return to a valid region, then file the report.' }] };
      }
      if (!w.summary) {
        return { lines: [{ speaker: 'MIRA', text: 'The report needs a finished mission window. The export control unlocks when the solver is done — it never exports stale or in-flight results.' }], readouts: [], note: 'Waiting for the mission summary…' };
      }
      const s = w.summary;
      return {
        lines: [
          { speaker: 'ARIN', text: `Your report will carry ${s.sampling.sampleCount.toLocaleString()} samples at an effective ${s.sampling.effectiveStepMinutes.toFixed(1)}-minute step${s.sampling.capped ? ' (coarsened evenly to respect the 20,000-sample cap)' : ''}, the frame state, the confidence tier and every config assumption — enough to reproduce this window exactly.` },
          { speaker: 'MIRA', text: 'File it with the real export control. Provenance, sampling, limitations and the verdict reason travel with the numbers — a report without them is just a rumor.' },
        ],
        readouts: [
          { label: 'Samples / effective step', value: `${s.sampling.sampleCount.toLocaleString()} / ${s.sampling.effectiveStepMinutes.toFixed(1)} min` },
          { label: 'Data confidence', value: s.dataConfidence },
          { label: 'Frame verified', value: s.frameVerified ? 'yes (residual disclosed)' : 'not applicable / illustrative' },
        ],
      };
    }
    default:
      return { lines: [], readouts: [] };
  }
}
