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
  AnalysisAssessment, EvaluatedSample, LandingSite, MissionConfig, MissionSummary, Scenario,
} from '../types/mission';
import type { DialogueLine } from './story';
import { explainClearance, explainEarthLos, explainIllumination, explainVerdict } from '../utils/explain';
import { scenarioFingerprint } from './witnesses';
import { DAY_MS } from '../engine/constants';

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
  /** Resolved per-scenario results for the comparison chapter (matrix = source of truth). */
  scenarioOutcomes: ScenarioOutcome[];
  /** The user's pre-briefing pins — never narrated as tutorial work. */
  userScenarioIds: string[];
}

/** One pinned scenario with its REAL resolved state (never a guessed summary). */
export interface ScenarioOutcome {
  scenario: Scenario;
  site: LandingSite;
  state: 'computing' | 'error' | 'blocked' | 'valid';
  summary: MissionSummary | null;
  analysis: AnalysisAssessment | null;
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

/** Human labels + units for every config knob a comparison can differ in. */
const CONFIG_DIFF_LABELS: { key: keyof MissionConfig; label: string; unit: string }[] = [
  { key: 'durationDays', label: 'duration', unit: 'd' },
  { key: 'arrayMode', label: 'array mode', unit: '' },
  { key: 'arrayAreaM2', label: 'array area', unit: 'm²' },
  { key: 'cellEfficiency', label: 'cell efficiency', unit: '' },
  { key: 'systemDerate', label: 'system derate', unit: '' },
  { key: 'fixedPanelAzimuthDeg', label: 'fixed panel azimuth', unit: '°' },
  { key: 'loadW', label: 'load', unit: 'W' },
  { key: 'batteryCapacityKWh', label: 'battery', unit: 'kWh' },
  { key: 'initialSocPct', label: 'initial charge', unit: '%' },
  { key: 'commsMarginDeg', label: 'comms margin', unit: '°' },
  { key: 'stepMinutes', label: 'sampling step', unit: 'min' },
];

/** Every setting that actually differs between two resolved scenarios. */
export function describeSettingDifferences(a: ScenarioOutcome, b: ScenarioOutcome): string[] {
  const diffs: string[] = [];
  if (a.scenario.siteId !== b.scenario.siteId) diffs.push(`site ${a.site.shortName} → ${b.site.shortName}`);
  const dDays = (b.scenario.startMs - a.scenario.startMs) / DAY_MS;
  if (Math.abs(dDays) > 1e-9) diffs.push(`window start ${dDays > 0 ? '+' : ''}${dDays.toFixed(2)} d`);
  for (const { key, label, unit } of CONFIG_DIFF_LABELS) {
    const va = a.scenario.config[key];
    const vb = b.scenario.config[key];
    if (va !== vb) diffs.push(`${label} ${String(va)} → ${String(vb)}${unit ? ` ${unit}` : ''}`);
  }
  return diffs;
}

const pp = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)} pp`;

/**
 * Chapter 7 narrative, derived ONLY from resolved scenario results — the same
 * simulations the comparison matrix renders (the matrix stays the source of
 * truth). Branches: missing pins → guidance; computing → wait; blocked/failed →
 * explanation without numbers; two valid → actual setting differences and deltas.
 * Cross-confidence comparisons are flagged and never ranked.
 */
export function comparisonNarrative(outcomes: ScenarioOutcome[], userScenarioIds: string[] = []): ChapterNarrative {
  const user = new Set(userScenarioIds);
  const seen = new Set<string>();
  const fresh: ScenarioOutcome[] = [];
  for (const o of outcomes) {
    if (user.has(o.scenario.id)) continue;
    const fp = scenarioFingerprint(o.scenario);
    if (seen.has(fp)) continue;
    seen.add(fp);
    fresh.push(o);
  }
  const valid = fresh.filter((o) => o.state === 'valid' && o.summary);
  const pending = fresh.filter((o) => o.state === 'computing');
  const blockedOrFailed = fresh.filter((o) => o.state === 'blocked' || o.state === 'error');

  if (fresh.length < 2) {
    return {
      lines: [{ speaker: 'MIRA', text: `${fresh.length === 0 ? 'Nothing pinned in this briefing yet.' : 'One briefing window pinned.'} Pin the current window, change one assumption — the slip is a good test — and pin again. Two DIFFERENT windows make a comparison; identical repeats and pre-briefing pins do not count.` }],
      readouts: [{ label: 'Distinct briefing scenarios', value: `${fresh.length} / 2 needed` }],
    };
  }
  if (valid.length < 2) {
    if (pending.length > 0) {
      return {
        lines: [{ speaker: 'ARIN', text: `${valid.length} of ${fresh.length} distinct windows resolved. The solver is still computing the rest — I will read differences only when at least two results are in. No guessed numbers.` }],
        readouts: [{ label: 'Resolved / pinned', value: `${valid.length} / ${fresh.length}` }],
        note: 'Waiting for scenario simulations…',
      };
    }
    const first = blockedOrFailed[0];
    const why = first.state === 'error'
      ? 'a scenario computation failed — remove and re-pin that window'
      : `a scenario analysis is blocked (${first.analysis?.status ?? 'unknown'}): ${first.analysis && 'reason' in first.analysis ? first.analysis.reason : ''}`;
    return {
      lines: [
        { speaker: 'ARIN', text: `No fair pair to read yet — ${why}.` },
        { speaker: 'MIRA', text: `Blocked windows get explanations, not deltas. ${first.analysis && 'resolution' in first.analysis ? first.analysis.resolution : 'Adjust the scenario and pin a valid replacement.'} The matrix shows each row's state.` },
      ],
      readouts: [{ label: 'Valid / pinned', value: `${valid.length} / ${fresh.length}` }],
      note: 'No quantitative comparison across blocked or failed results.',
    };
  }

  const [a, b] = valid;
  const sa = a.summary!;
  const sb = b.summary!;
  const diffs = describeSettingDifferences(a, b);
  const confA = sa.dataConfidence;
  const confB = sb.dataConfidence;
  const sameTier = confA === confB;
  const lines: DialogueLine[] = [
    { speaker: 'ARIN', text: `Comparing your first two resolved windows. What differs: ${diffs.length > 0 ? diffs.join('; ') : 'nothing recorded — treat any output difference as noise'}. The solver puts simultaneous Sun + Earth at ${pct(sa.combinedPct)} → ${pct(sb.combinedPct)} (${pp(sb.combinedPct - sa.combinedPct)}), and the longest stretch without both at ${hours(sa.longestCombinedGapHours)} → ${hours(sb.longestCombinedGapHours)}.` },
    { speaker: 'MIRA', text: `Illumination moves ${pp(sb.illuminationPct - sa.illuminationPct)} and geometric Earth line-of-sight ${pp(sb.dtePct - sa.dtePct)} — LOS is still not an RF link budget. Selected-array energy: ${sa.selectedEnergyKWh.toFixed(1)} → ${sb.selectedEnergyKWh.toFixed(1)} kWh, minimum charge ${pct(sa.minBatterySocPct)} → ${pct(sb.minBatterySocPct)}. Energy balance only — not thermal or survival.` },
    { speaker: 'MIRA', text: sameTier
      ? `Both windows use ${CONFIDENCE_LABEL[confA] ?? confA} — same confidence tier, so the difference is attributable to the settings above. The matrix remains the source of truth; the score is our heuristic, not a NASA methodology.`
      : `Confidence mismatch: ${confA} versus ${confB}. These rows are NOT comparable for ranking — a higher heuristic score on weaker data never outranks stronger data. Read the deltas as indicative only.` },
  ];
  return {
    lines,
    readouts: [
      { label: 'Windows compared', value: `${a.site.shortName} → ${b.site.shortName}` },
      { label: 'Sun + Earth', value: `${pct(sa.combinedPct)} → ${pct(sb.combinedPct)} (${pp(sb.combinedPct - sa.combinedPct)})` },
      { label: 'Longest combined gap', value: `${hours(sa.longestCombinedGapHours)} → ${hours(sb.longestCombinedGapHours)}` },
      { label: 'Illumination / DTE Δ', value: `${pp(sb.illuminationPct - sa.illuminationPct)} / ${pp(sb.dtePct - sa.dtePct)}` },
      { label: 'Selected energy', value: `${sa.selectedEnergyKWh.toFixed(1)} → ${sb.selectedEnergyKWh.toFixed(1)} kWh` },
      { label: 'Confidence tiers', value: sameTier ? `${confA} (matched)` : `${confA} vs ${confB} — not rankable` },
    ],
    note: sameTier
      ? 'The comparison matrix is the source of truth. Heuristic score ≠ NASA methodology.'
      : 'Mixed confidence tiers — indicative comparison only, never a ranking. The matrix is the source of truth.',
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
      // A blocked CURRENT analysis is explained first — pinning this window cannot
      // earn comparison credit, and the narrative must say so rather than coach
      // pinning against a gate. Valid pinned rows remain readable in the matrix.
      if (blocked) return blocked;
      return comparisonNarrative(w.scenarioOutcomes, w.userScenarioIds);
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
