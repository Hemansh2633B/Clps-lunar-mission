import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GraduationCap, BookOpen, ListChecks } from 'lucide-react';
import type { AppMode, GuidedScenario, LandingSite, MissionConfig, Scenario, SimulationResult } from './types/mission';
import { LANDING_SITES, makeCustomSite } from './data/landingSites';
import { DEFAULT_CONFIG, analysisWindow, evaluateAt } from './engine/simulation';
import { assessTerrainEligibility } from './engine/analysisStatus';
import { DAY_MS, HOUR_MS, clamp } from './engine/constants';
import { useSimulation } from './hooks/useSimulation';
import { cachedSimulation, requestSimulation, releaseSimulation } from './engine/simulationClient';
import { HeaderBar } from './components/HeaderBar';
import { SiteCatalog } from './components/SiteCatalog';
import { HorizonPanorama, type PanoramaOptions } from './components/HorizonPanorama';
import { PolarMap, type MapLayers } from './components/PolarMap';
import { SiteBrief } from './components/SiteBrief';
import { TelemetryPanel } from './components/TelemetryPanel';
import { TimelineScrubber } from './components/TimelineScrubber';
import { ComparisonMatrix } from './components/ComparisonMatrix';
import { ProvenanceIndicator } from './components/ProvenanceIndicator';
const TerrainLab = lazy(() => import('./components/TerrainLab').then((m) => ({ default: m.TerrainLab })));
import type { TerrainSiteInput } from './components/TerrainLab';
const SpaceView = lazy(() => import('./components/SpaceView').then((m) => ({ default: m.SpaceView })));
import { EducatorOverlay } from './components/EducatorOverlay';
import { Onboarding } from './components/Onboarding';
import { WorkflowGuide } from './components/WorkflowGuide';
import { StoryTutorial, StorySuggestion } from './tutorial/StoryTutorial';
import { useStoryTutorial, type StoryActions, type StorySignals } from './tutorial/useStoryTutorial';
import { loadProgress } from './tutorial/progress';
import { loadSession, saveSession, clearSession, resolveBoot, SESSION_VERSION, type TrainingSession, type WorkspaceSnapshot } from './tutorial/session';
import { scenarioFingerprint, creditsMissionReport, type ScenarioResolution } from './tutorial/witnesses';
import { missionExportGate } from './utils/exportGuard';
import type { StoryWorld, ScenarioOutcome } from './tutorial/narrative';
import { MISSION_PRESETS, CUSTOM_PRESET_ID, matchingPresetId } from './data/missionPresets';
import { formatUtcStamp } from './utils/utc';
import type { WorkflowStepId } from './utils/workflow';
import { CustomSiteModal, SettingsModal, HorizonTableModal, ShortcutsModal, type CustomSiteInput } from './components/Modals';
import { download, missionReportJSON, timeseriesCSV, horizonCSV, summaryCSV, eventsCSV, energyHistoryCSV, comparisonCSV, comparisonJSON, exportInitiatedMessage, type ComparisonRow, type ExportKind } from './utils/export';
import { analysisFingerprint } from './utils/analysisId';

const BASELINE = Date.parse('2026-12-18T00:00:00Z');
const INITIAL_TIME = Date.parse('2026-12-20T08:00:00Z');
const ONBOARD_KEY = 'chandra-onboarded-v1';
function hasOnboarded(): boolean {
  try { return window.localStorage.getItem(ONBOARD_KEY) === '1'; } catch { return true; }
}
function markOnboarded() {
  try { window.localStorage.setItem(ONBOARD_KEY, '1'); } catch { /* storage unavailable */ }
}
const CATALOG_IDS = new Set(LANDING_SITES.map((s) => s.id));
function appStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
const TICKER = [
  '1.54° AXIAL TILT', '709h SYNODIC DAY', '±6.7° LAT LIBRATION', '±7.9° LON LIBRATION',
  '0.0″ AIRLESS REFRACTION', '1361 W/m² SOLAR CONSTANT', 'IAU 2015 MOON ROTATION',
  '360° TERRAIN OCCLUSION', 'DIRECT-TO-EARTH WINDOWS', 'LAUNCH-SLIP ECLIPSES',
];

export default function App() {
  // Refresh-safe training context: a valid persisted session + in-training progress
  // boots straight back into the training workspace; an orphaned session restores
  // the USER workspace; lost context with in-training progress is surfaced by the
  // story hook as an explicit Rebuild/Exit recovery choice — never silent defaults.
  const [boot] = useState(() => {
    const st = appStorage();
    const sess = loadSession(st);
    // A stored payload that FAILED validation is reported, never silently dropped:
    // the user learns what could not be restored (the briefing offers Rebuild/Exit).
    let storedRaw: string | null = null;
    try { storedRaw = st?.getItem('chandra-story-session-v1') ?? null; } catch { /* unavailable */ }
    return { session: sess, sessionRejected: storedRaw !== null && sess === null, ...resolveBoot(sess, loadProgress(st)) };
  });
  const bootWs = boot.workspace;
  const [session, setSession] = useState<TrainingSession | null>(boot.keepSession ? boot.session : null);
  const [sites, setSites] = useState<LandingSite[]>(() => (bootWs ? [...LANDING_SITES, ...bootWs.customSites] : LANDING_SITES));
  const [selectedId, setSelectedId] = useState(bootWs?.selectedId ?? 'shackleton-rim');
  const [baselineMs, setBaselineMs] = useState(bootWs?.baselineMs ?? BASELINE);
  const [slipDays, setSlipDays] = useState(bootWs?.slipDays ?? 0);
  const [viewDays, setViewDays] = useState(bootWs?.viewDays ?? 30);
  const [config, setConfig] = useState<MissionConfig>(bootWs?.config ?? DEFAULT_CONFIG);
  const [timeMs, setTimeMs] = useState(bootWs?.timeMs ?? INITIAL_TIME);
  const [playing, setPlaying] = useState(bootWs?.playing ?? false);
  const [speed, setSpeed] = useState(bootWs?.speed ?? 3600);
  const [mode, setMode] = useState<AppMode>(bootWs?.mode ?? 'planner');
  const [compareMode, setCompareMode] = useState(bootWs?.compareMode ?? false);
  const [terrainView, setTerrainView] = useState(bootWs?.terrainView ?? false);
  const [spaceView, setSpaceView] = useState(bootWs?.spaceView ?? false);
  const [scenarios, setScenarios] = useState<Scenario[]>(bootWs?.scenarios ?? []);
  const [panorama, setPanorama] = useState<PanoramaOptions>({ showTracks: true, showTerrain: true, sector: 'full' });
  const [mapLayers, setMapLayers] = useState<MapLayers>({ grid: true, lighting: true, earthVector: true });
  const [customOpen, setCustomOpen] = useState(false);
  const [customInitial, setCustomInitial] = useState<{ lat: number; lon: number } | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [horizonOpen, setHorizonOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [activeTour, setActiveTour] = useState<GuidedScenario | null>(null);
  const [tourStep, setTourStep] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(() => !hasOnboarded());
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [reportExportCount, setReportExportCount] = useState(0);
  const [glossaryFocus, setGlossaryFocus] = useState<string | undefined>();
  const [scenarioSims, setScenarioSims] = useState<Record<string, { fp: string; result: SimulationResult | 'error' }>>({});

  const site = sites.find((s) => s.id === selectedId) ?? sites[0];
  const win = useMemo(() => analysisWindow(baselineMs, slipDays, config.durationDays, viewDays), [baselineMs, slipDays, config.durationDays, viewDays]);
  const current = useMemo(() => evaluateAt(site, timeMs, config), [site, timeMs, config]);
  // Instantaneous visibility claims must pass the same frame/coverage gate as the
  // window analysis — scrubbing to an unvalidated epoch must not surface Sunlit/DTE
  // claims against an untrusted mask (ephemeris positions remain valid).
  const instantBlocked = useMemo(() => !assessTerrainEligibility(site, timeMs, timeMs).demoEligible, [site, timeMs]);
  const analysisConfig = useMemo(() => ({ ...config, stepMinutes: Math.max(config.stepMinutes, viewDays >= 90 ? 30 : 15) }), [config, viewDays]);
  const activeSim = useSimulation(site, win.startMs, win.endMs, analysisConfig);
  const missionSim = useSimulation(site, win.missionStart, win.missionEnd, config);
  const baselineSim = useSimulation(site, baselineMs, baselineMs + config.durationDays * DAY_MS, config);
  const events = activeSim.data?.events ?? [];
  const presetName = useMemo(() => {
    const id = matchingPresetId(config);
    return id === CUSTOM_PRESET_ID ? 'Custom' : MISSION_PRESETS.find((p) => p.id === id)?.label ?? 'Custom';
  }, [config]);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  }, []);

  const dismissOnboarding = useCallback(() => {
    markOnboarded(); setOnboardingOpen(false);
    window.setTimeout(() => storyRef.current?.suggestAfterOnboarding(), 0);
  }, []);
  const startDemo = useCallback(() => {
    markOnboarded(); setOnboardingOpen(false);
    setTerrainView(false); setSpaceView(false); setCompareMode(false);
    setSelectedId('connecting-ridge');
    setBaselineMs(Date.parse('2026-09-01T00:00:00Z'));
    setSlipDays(0);
    setMode('planner');
    notify('Demo mode — illustrative terrain (not measured flight data). Explore freely, or try the interactive briefing.');
    window.setTimeout(() => storyRef.current?.suggestAfterOnboarding(), 0);
  }, [notify]);
  const startRealDem = useCallback(() => {
    markOnboarded(); setOnboardingOpen(false);
    setSpaceView(false); setCompareMode(false); setTerrainView(true);
    notify('Terrain Lab opened — configure a compatible lunar DEM (MOON_ME/PA · DE421, or IAU 2015). Real mode never silently substitutes synthetic data.');
  }, [notify]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setTimeMs((t) => {
        const next = t + speed * 200;
        return next > win.endMs ? win.startMs : next;
      });
    }, 200);
    return () => window.clearInterval(id);
  }, [playing, speed, win.startMs, win.endMs]);

  useEffect(() => {
    setTimeMs((t) => clamp(t, win.startMs, win.endMs));
  }, [win.startMs, win.endMs, spaceView]);

  const pinCurrent = useCallback(() => {
    setScenarios((prev) => {
      if (prev.length >= 4) { notify('Comparison is limited to 4 scenarios. Remove one first.'); return prev; }
      return [...prev, { id: `sc-${Date.now().toString(36)}`, siteId: site.id, startMs: win.missionStart, config: { ...config }, label: site.shortName }];
    });
    setCompareMode(true);
  }, [site.id, win.missionStart, config, notify]);

  const overlayOpen = customOpen || settingsOpen || horizonOpen || shortcutsOpen || guideOpen || onboardingOpen;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (overlayOpen && e.key !== 'Escape') return;
      if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === '[') setTimeMs((t) => clamp(t - DAY_MS, win.startMs, win.endMs));
      else if (e.key === ']') setTimeMs((t) => clamp(t + DAY_MS, win.startMs, win.endMs));
      else if (e.key === 'ArrowLeft') setTimeMs((t) => clamp(t - HOUR_MS, win.startMs, win.endMs));
      else if (e.key === 'ArrowRight') setTimeMs((t) => clamp(t + HOUR_MS, win.startMs, win.endMs));
      else if (e.key.toLowerCase() === 'c') { setTerrainView(false); setSpaceView(false); setCompareMode((v) => !v); }
      else if (e.key.toLowerCase() === 't') { setSpaceView(false); setTerrainView((v) => !v); }
      else if (e.key.toLowerCase() === 'o') { setTerrainView(false); setCompareMode(false); setSpaceView((v) => !v); }
      else if (e.key.toLowerCase() === 'e') setMode((m) => (m === 'planner' ? 'educator' : 'planner'));
      else if (e.key.toLowerCase() === 'g') setGuideOpen((v) => !v);
      else if (e.key.toLowerCase() === 'p') pinCurrent();
      else if (e.key === '?') setShortcutsOpen(true);
      else if (e.key === 'Escape') {
        const anyModal = customOpen || settingsOpen || horizonOpen || shortcutsOpen || guideOpen || onboardingOpen;
        setCustomOpen(false); setSettingsOpen(false); setHorizonOpen(false); setShortcutsOpen(false); setGuideOpen(false);
        if (!anyModal && storyRef.current?.active) storyRef.current.pause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [win.startMs, win.endMs, pinCurrent, overlayOpen]);

  const placeCustom = useCallback((lat: number, lon: number) => {
    const s = makeCustomSite({ name: `Map ${lat.toFixed(2)}° ${lon.toFixed(1)}°`, latitude: lat, longitude: lon, elevationM: 0, preset: 'flat' });
    setSites((prev) => [...prev, s]);
    setSelectedId(s.id);
    notify(`Custom site synthesized at ${lat.toFixed(2)}°, ${lon.toFixed(1)}°`);
  }, [notify]);

  const createCustom = useCallback((input: CustomSiteInput) => {
    const s = makeCustomSite(input);
    setSites((prev) => [...prev, s]);
    setSelectedId(s.id);
    setCustomOpen(false);
    notify(`Created ${s.name}`);
  }, [notify]);

  const createTerrainSite = useCallback((input: TerrainSiteInput) => {
    const s = makeCustomSite(input);
    setSites((prev) => [...prev, s]);
    setSelectedId(s.id);
    setTerrainView(false);
    notify(input.horizon.synthetic
      ? 'Synthetic demo horizon sent to mission planner — not real lunar data'
      : `DEM horizon preserved + rotated to IAU 2015 · frame ${s.terrain.sourceFrame ?? 'unspecified'} ${s.terrain.frameVerified ? '(verified; residual disclosed)' : '(UNVERIFIED — blocked from mission visibility)'}`);
  }, [notify]);

  const applyGuided = useCallback((s: GuidedScenario) => {
    setSelectedId(s.siteId);
    setBaselineMs(s.startMs);
    setSlipDays(s.slipDays);
    setConfig((c) => ({ ...c, durationDays: s.durationDays, arrayMode: s.arrayMode }));
    setMode('educator');
    setActiveTour(s);
    setTourStep(0);
    setTimeMs(s.startMs + 2 * DAY_MS);
    setViewDays(s.durationDays > 14 ? 90 : 30);
    setTerrainView(s.id === 'terrain-lab');
    notify(`Loaded scenario: ${s.title}`);
  }, [notify]);

  const handleExport = useCallback(async (kind: ExportKind) => {
    // One pure gate for every export: computing / failed / blocked / stale results
    // never leave the app, and the result must match the CURRENT site, window,
    // terrain identity and effective configuration (full simulationKey check).
    const gate = missionExportGate({
      kind, loading: missionSim.loading, error: missionSim.error, sim: missionSim.data,
      expectedSiteId: site.id, expectedStartMs: win.missionStart, expectedEndMs: win.missionEnd,
      expectedSite: site, expectedConfig: config,
      horizonInstantBlocked: instantBlocked,
    });
    if (!gate.ok) { notify(gate.reason); return; }
    const sim = missionSim.data!;
    const stamp = new Date(timeMs).toISOString().slice(0, 10);
    try {
      // Fingerprint over the EFFECTIVE inputs the engine actually used — the same
      // identity the guard verified, linking every CSV to the JSON report.
      const fp = await analysisFingerprint(sim.site, sim.summary!.startMs, sim.summary!.endMs, sim.config);
      if (kind === 'json') download(`chandra-report-${stamp}.json`, await missionReportJSON(site, config, sim, current), 'application/json');
      else if (kind === 'horizon') download(`chandra-horizon-${site.id}.csv`, await horizonCSV(site, current, sim, fp), 'text/csv');
      else if (kind === 'timeseries') download(`chandra-timeseries-${site.id}.csv`, await timeseriesCSV(sim, fp), 'text/csv');
      else if (kind === 'events') download(`chandra-events-${site.id}.csv`, await eventsCSV(sim, fp), 'text/csv');
      else if (kind === 'energy') download(`chandra-energy-${site.id}.csv`, await energyHistoryCSV(sim, fp), 'text/csv');
      else download(`chandra-summary-${site.id}.csv`, await summaryCSV(sim, fp), 'text/csv');
    } catch (err) {
      notify(`Export failed (${err instanceof Error ? err.message : String(err)}) — nothing was filed.`);
      return;
    }
    // ONLY a guard-passing JSON mission report whose download dispatch succeeded
    // earns briefing credit. "Initiated" is deliberate: the browser's save dialog
    // is not observable from page script (E2E asserts real download events).
    if (creditsMissionReport(kind, gate.ok, true)) setReportExportCount((n) => n + 1);
    notify(exportInitiatedMessage(kind));
  }, [site, config, missionSim.data, missionSim.loading, missionSim.error, current, timeMs, win.missionStart, win.missionEnd, instantBlocked, notify]);

  const handleComparisonExport = useCallback(async (kind: 'csv' | 'json', rows: ComparisonRow[]) => {
    // Rows carry per-card loading/error state; refresh the cached result at click
    // time so the export reflects the freshest resolved data. Missing sites are
    // NEVER silently substituted — they export as MISSING_SITE rows.
    const full = rows.map((r) => ({
      ...r,
      sim: r.site ? cachedSimulation(r.site, r.scenario.startMs, r.scenario.startMs + r.scenario.config.durationDays * DAY_MS, r.scenario.config) ?? null : null,
    }));
    try {
      if (kind === 'csv') download('chandra-comparison.csv', await comparisonCSV(full), 'text/csv');
      else download('chandra-comparison.json', await comparisonJSON(full), 'application/json');
    } catch (err) {
      notify(`Comparison export failed (${err instanceof Error ? err.message : String(err)}) — nothing was filed.`);
      return;
    }
    notify('Comparison export initiated — every row carries an explicit resolution state; unresolved rows contain no numbers.');
  }, [notify]);

  // Each guided-workflow step drives the real app, then the guide advances.
  const handleWorkflowAction = useCallback((id: WorkflowStepId) => {
    if (id === 'region') {
      document.querySelector<HTMLElement>('.site-rail .site-item')?.focus();
    } else if (id === 'date') {
      const el = document.getElementById('mission-start-date');
      el?.scrollIntoView({ block: 'nearest' });
      el?.focus();
    } else if (id === 'preset') {
      setSettingsOpen(true);
    } else if (id === 'results') {
      document.querySelector<HTMLElement>('.telemetry-rail')?.scrollIntoView({ block: 'nearest' });
    } else if (id === 'compare') {
      pinCurrent();
    } else if (id === 'report') {
      handleExport('json');
    }
  }, [pinCurrent, handleExport]);

  // ---- THE 14-DAY WINDOW · interactive briefing -------------------------------
  const configKey = useMemo(() => JSON.stringify(config), [config]);

  /** Complete, deep-copied workspace snapshot (custom sites included, catalog excluded). */
  const takeWorkspace = useCallback((): WorkspaceSnapshot => structuredClone({
    selectedId, baselineMs, slipDays, config, viewDays, timeMs, mode, compareMode, terrainView, spaceView,
    scenarios, playing, speed, customSites: sites.filter((s) => !CATALOG_IDS.has(s.id)),
  }), [selectedId, baselineMs, slipDays, config, viewDays, timeMs, mode, compareMode, terrainView, spaceView, scenarios, playing, speed, sites]);

  const applyWorkspace = useCallback((w: WorkspaceSnapshot) => {
    setSites([...LANDING_SITES, ...w.customSites]);
    setSelectedId(w.selectedId); setBaselineMs(w.baselineMs); setSlipDays(w.slipDays);
    setConfig(w.config); setViewDays(w.viewDays); setTimeMs(w.timeMs); setMode(w.mode);
    setCompareMode(w.compareMode); setTerrainView(w.terrainView); setSpaceView(w.spaceView);
    setScenarios(w.scenarios); setPlaying(w.playing); setSpeed(w.speed);
  }, []);

  const loadTrainingMission = useCallback(() => {
    const training: WorkspaceSnapshot = {
      selectedId: 'connecting-ridge', baselineMs: Date.parse('2026-09-01T00:00:00Z'), slipDays: 0,
      config: structuredClone(DEFAULT_CONFIG), viewDays: 30,
      timeMs: Date.parse('2026-09-01T00:00:00Z') + 2 * DAY_MS,
      mode: 'planner', compareMode: false, terrainView: false, spaceView: false,
      scenarios: [], playing: false, speed, customSites: [],
    };
    // Isolated training workspace: the user's pins/sites/playback live in the
    // session snapshot and are restored EXACTLY on exit — never silently deleted.
    setSession((prev) => ({ v: SESSION_VERSION, user: prev?.user ?? takeWorkspace(), training }));
    applyWorkspace(training);
    setWorkflowOpen(false);
    notify('Training mission loaded — an isolated, clearly-labeled workspace. Your own setup (sites, pins, playback) is preserved and restored when you exit.');
  }, [takeWorkspace, applyWorkspace, speed, notify]);

  const restoreMission = useCallback(() => {
    if (!session) return;
    applyWorkspace(session.user);
    setSession(null);
    clearSession(appStorage());
    notify('Briefing closed — your previous mission setup was restored exactly (sites, pins, settings, playback).');
  }, [session, applyWorkspace, notify]);

  // Persist the live training workspace (debounced) + flush synchronously on pagehide
  // so a refresh restores the exact context the user left, pins and slip included.
  const liveTrainingRef = useRef<WorkspaceSnapshot | null>(null);
  liveTrainingRef.current = session ? takeWorkspace() : null;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const persistTraining = useCallback(() => {
    if (sessionRef.current && liveTrainingRef.current) {
      saveSession({ ...sessionRef.current, training: liveTrainingRef.current, baseline: storyRef.current.witnessBaseline }, appStorage());
    }
  }, []);
  useEffect(() => {
    const flush = () => persistTraining();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [persistTraining]);
  useEffect(() => {
    // Orphaned session at boot (progress gone/completed): the user workspace was
    // restored above; drop the stale storage payload once.
    if (boot.boot === 'user') clearSession(appStorage());
    if (boot.sessionRejected) {
      notify('A saved briefing session could not be restored — it failed validation (corrupt, out-of-range settings or inconsistent terrain metadata). Nothing was partially applied; the briefing offers Rebuild / Exit.');
      // The rejected payload is unusable and was never applied; drop it once so it
      // cannot re-trigger on every reload. Briefing progress (separate key) is kept,
      // so resuming still offers the explicit Rebuild / Exit recovery choice.
      clearSession(appStorage());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scenarioResolutions = useMemo(() => {
    const out: Record<string, ScenarioResolution> = {};
    for (const sc of scenarios) {
      const e = scenarioSims[sc.id];
      if (!e || e.fp !== scenarioFingerprint(sc)) { out[sc.id] = { resolved: false, eligible: false }; continue; }
      out[sc.id] = e.result === 'error'
        ? { resolved: true, eligible: false }
        : { resolved: true, eligible: e.result.analysis.demoEligible };
    }
    return out;
  }, [scenarios, scenarioSims]);

  const storySignals: StorySignals = useMemo(() => ({
    selectedId: site.id, timeMs, slipDays, configKey,
    scenarios, userScenarioIds: session?.user.scenarios.map((sc) => sc.id) ?? [],
    trainingActive: session !== null, resolutions: scenarioResolutions,
    compareMode, reportExportCount,
  }), [site.id, timeMs, slipDays, configKey, scenarios, session, scenarioResolutions, compareMode, reportExportCount]);

  const focusStoryTarget = useCallback((key: string) => {
    const el = document.querySelector<HTMLElement>(`[data-tour="${key}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const focusable = el.matches('button, input, select, [tabindex]') ? el : el.querySelector<HTMLElement>('button, input, select, [tabindex]');
    focusable?.focus({ preventScroll: true });
  }, []);

  const storyActions: StoryActions = useMemo(() => ({
    loadTrainingMission,
    restoreMission,
    ensureView: (view) => {
      setTerrainView(false); setSpaceView(false);
      if (view === 'planner') setCompareMode(false);
      else setCompareMode(true);
    },
    focusTarget: focusStoryTarget,
    openSettings: () => setSettingsOpen(true),
    openGlossary: (term) => { setGlossaryFocus(term); setGuideOpen(true); },
    openGuide: () => setGuideOpen(true),
    openTerrainLab: () => { setSpaceView(false); setCompareMode(false); setTerrainView(true); },
    pinCurrent,
    exportReport: () => handleExport('json'),
    notify,
  }), [loadTrainingMission, restoreMission, focusStoryTarget, pinCurrent, handleExport, notify]);

  const story = useStoryTutorial(storySignals, storyActions, { initialBaseline: boot.keepSession ? boot.session?.baseline ?? null : null });
  const storyRef = useRef(story);
  storyRef.current = story;

  // Chapter 7 needs RESOLVED results for every pinned scenario, even before the
  // matrix mounts them. Requests are refcounted alongside the matrix's own hooks.
  const watchComparisons = story.active && !story.debrief && !story.recoveryNeeded && story.chapter.id === 7;
  useEffect(() => {
    if (!watchComparisons) return;
    let alive = true;
    const requested: { site: LandingSite; startMs: number; endMs: number; config: MissionConfig }[] = [];
    for (const sc of scenarios) {
      const sSite = sites.find((x) => x.id === sc.siteId) ?? sites[0];
      const endMs = sc.startMs + sc.config.durationDays * DAY_MS;
      const fp = scenarioFingerprint(sc);
      const cached = cachedSimulation(sSite, sc.startMs, endMs, sc.config);
      if (cached) { setScenarioSims((m) => ({ ...m, [sc.id]: { fp, result: cached } })); continue; }
      requested.push({ site: sSite, startMs: sc.startMs, endMs, config: sc.config });
      requestSimulation(sSite, sc.startMs, endMs, sc.config)
        .then((r) => { if (alive) setScenarioSims((m) => ({ ...m, [sc.id]: { fp, result: r } })); })
        .catch((err) => { if (alive && err?.name !== 'SimulationCancelledError') setScenarioSims((m) => ({ ...m, [sc.id]: { fp, result: 'error' as const } })); });
    }
    return () => {
      alive = false;
      for (const r of requested) releaseSimulation(r.site, r.startMs, r.endMs, r.config);
    };
  }, [watchComparisons, scenarios, sites]);

  // Finishing the briefing restores the user's workspace immediately (the debrief
  // is a summary, not the training mission). Exiting mid-story does the same.
  useEffect(() => {
    if (story.progress?.status === 'completed' && session) restoreMission();
  }, [story.progress?.status, session, restoreMission]);

  // Debounced session persistence (workspace + chapter witness baseline). Runs
  // after every relevant state change; pagehide flushes synchronously for refresh.
  useEffect(() => {
    if (!session) return;
    const id = window.setTimeout(persistTraining, 250);
    return () => window.clearTimeout(id);
  }, [session, selectedId, baselineMs, slipDays, config, viewDays, timeMs, mode, compareMode, terrainView, spaceView, scenarios, playing, speed, sites, story.progress?.chapter, persistTraining]);

  // Per-scenario outcomes for the briefing's comparison chapter: the SAME cached
  // simulations the matrix renders, with honest computing/blocked/error states.
  const scenarioOutcomes = useMemo<ScenarioOutcome[]>(() => scenarios.map((sc) => {
    const sSite = sites.find((x) => x.id === sc.siteId) ?? sites[0];
    const e = scenarioSims[sc.id];
    if (!e || e.fp !== scenarioFingerprint(sc)) return { scenario: sc, site: sSite, state: 'computing', summary: null, analysis: null };
    if (e.result === 'error') return { scenario: sc, site: sSite, state: 'error', summary: null, analysis: null };
    return {
      scenario: sc, site: sSite,
      state: e.result.analysis.demoEligible ? 'valid' : 'blocked',
      summary: e.result.summary, analysis: e.result.analysis,
    };
  }), [scenarios, sites, scenarioSims]);

  const storyWorld: StoryWorld = useMemo(() => ({
    site, current, config, presetName, slipDays, missionStartMs: win.missionStart,
    summary: missionSim.data?.summary ?? null, baselineSummary: baselineSim.data?.summary ?? null,
    analysis: missionSim.data?.analysis ?? null, loading: missionSim.loading,
    scenarioCount: scenarios.length, compareMode,
    scenarioOutcomes, userScenarioIds: session?.user.scenarios.map((sc) => sc.id) ?? [],
  }), [site, current, config, presetName, slipDays, win.missionStart, missionSim.data, missionSim.loading, baselineSim.data, scenarios.length, compareMode, scenarioOutcomes, session]);

  return (
    <div className="app-shell">
      <HeaderBar
        timeMs={timeMs} mode={mode} onMode={setMode} compareMode={compareMode}
        onCompare={() => { setTerrainView(false); setSpaceView(false); setCompareMode((v) => !v); }}
        terrainActive={terrainView} onTerrain={() => { setSpaceView(false); setTerrainView((v) => !v); }}
        spaceActive={spaceView} onSpace={() => { setTerrainView(false); setCompareMode(false); setSpaceView((v) => !v); }}
        onGuide={() => setGuideOpen(true)}
        onHelp={() => setOnboardingOpen(true)}
        onSettings={() => setSettingsOpen(true)} onShortcuts={() => setShortcutsOpen(true)}
        onExport={handleExport} playing={playing}
        subSolar={{ lat: current.subsolarLatitudeDeg, lon: current.subsolarLongitudeDeg }}
        subEarth={{ lat: current.libration.subEarthLatitudeDeg, lon: current.libration.subEarthLongitudeDeg }}
      />
      <div className="ticker" aria-hidden="true">
        <div className="ticker-track">
          {[...TICKER, ...TICKER].map((t, i) => <span key={i}>· {t}</span>)}
        </div>
      </div>
      {mode === 'educator' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', background: '#e7f5ee', borderBottom: '1px solid #a9d3bd', fontSize: 11, color: '#1f7a52' }}>
          <GraduationCap size={13} /> Educator mode active — telemetry is translated into plain English.
          <button className="btn sm ghost" style={{ color: '#1f7a52', marginLeft: 'auto' }} onClick={() => setGuideOpen(true)}><BookOpen size={12} /> Open guided stories</button>
        </div>
      )}
      <div className={`workspace ${compareMode && !terrainView && !spaceView ? 'compare' : ''} ${terrainView ? 'terrain' : ''} ${spaceView ? 'orbital' : ''}`}>
        <aside className="site-rail" data-tour="catalog">
          <SiteCatalog sites={sites} selectedId={site.id} onSelect={setSelectedId}
            onCustom={() => { setCustomInitial(undefined); setCustomOpen(true); }}
            onHorizonTable={() => setHorizonOpen(true)} onPin={pinCurrent} compareMode={compareMode} />
        </aside>
        <main className="center-stack">
          {spaceView ? (
            <Suspense fallback={<div className="panel" style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>Loading 3D space views…</div>}>
              <SpaceView sites={sites} selectedId={site.id} onSelect={setSelectedId} timeMs={timeMs} onTime={setTimeMs} mode={mode} />
            </Suspense>
          ) : terrainView ? (
            <Suspense fallback={<div className="panel" style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>Loading Terrain Lab…</div>}>
              <TerrainLab site={site} timeMs={timeMs} mode={mode} onCreateSite={createTerrainSite} notify={notify} />
            </Suspense>
          ) : compareMode ? (
            <ComparisonMatrix scenarios={scenarios} sites={sites}
              onUpdate={(id, patch) => setScenarios((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))}
              onRemove={(id) => setScenarios((prev) => prev.filter((s) => s.id !== id))}
              onPin={pinCurrent} onClose={() => setCompareMode(false)} onExport={handleComparisonExport} mode={mode} />
          ) : (
            <>
              {story.suggestOpen && !story.active && (
                <StorySuggestion onStart={story.start} onDismiss={story.dismissSuggestion} />
              )}
              {workflowOpen ? (
                <WorkflowGuide onClose={() => setWorkflowOpen(false)} onAction={handleWorkflowAction}
                  context={{
                    siteName: site.shortName, startUtc: formatUtcStamp(win.missionStart), presetName,
                    verdict: missionSim.data?.summary?.verdict ?? null, scenarioCount: scenarios.length,
                    simReady: !!missionSim.data?.summary && !missionSim.loading,
                    exportBlocked: !!missionSim.data?.analysis && !missionSim.data.analysis.demoEligible,
                  }} />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                  <button className="btn sm ghost" onClick={() => setWorkflowOpen(true)}><ListChecks size={12} /> Guided workflow</button>
                  <button className="btn sm ghost" onClick={story.start} data-tour="story-launch"><BookOpen size={12} /> {story.progress && story.progress.status === 'paused' ? 'Resume briefing' : story.progress && story.progress.status === 'completed' ? 'Briefing debrief' : 'Story briefing'}</button>
                  <span style={{ fontSize: 10, color: 'var(--dim)' }}>New here? Follow the six-step path, or join the 14-day-window briefing.</span>
                </div>
              )}
              <HorizonPanorama site={site} current={current} sim={activeSim.data} mode={mode} options={panorama} onOptions={setPanorama} visibilityBlocked={instantBlocked} />
              <div className="lower-grid">
                <PolarMap sites={sites} selected={site} current={current} onSelect={setSelectedId} onPlaceCustom={placeCustom} layers={mapLayers} onLayers={setMapLayers} visibilityBlocked={instantBlocked} />
                <SiteBrief site={site} current={current} onHorizonTable={() => setHorizonOpen(true)} onPin={pinCurrent} visibilityBlocked={instantBlocked} analysis={missionSim.data?.analysis ?? null} />
              </div>
            </>
          )}
        </main>
        <aside className="telemetry-rail" data-tour="telemetry">
          <TelemetryPanel site={site} current={current} sim={missionSim.data} events={events} timeMs={timeMs} mode={mode} config={config} onSettings={() => setSettingsOpen(true)} loading={missionSim.loading} error={missionSim.error} progress={missionSim.progress} visibilityBlocked={instantBlocked} />
        </aside>
      </div>
      {!spaceView && (
        <TimelineScrubber
          sim={activeSim.data} loading={activeSim.loading} window={win} timeMs={timeMs} onTime={setTimeMs}
          baselineMs={baselineMs} onBaseline={setBaselineMs} slipDays={slipDays} onSlip={setSlipDays} durationDays={config.durationDays}
          onDuration={(d) => setConfig((c) => ({ ...c, durationDays: d }))}
          playing={playing} onPlay={() => setPlaying((p) => !p)} speed={speed} onSpeed={setSpeed}
          viewDays={viewDays} onViewDays={setViewDays}
          missionSummary={missionSim.data?.summary ?? null} baselineSummary={baselineSim.data?.summary ?? null}
          missionAnalysis={missionSim.data?.analysis ?? null}
        />
      )}
      <footer className="status-bar">
        <span><span className="dot" style={{ background: 'var(--nominal)' }} />EPHEMERIS · astronomy-engine + IAU 2015 Moon rotation</span>
        <ProvenanceIndicator site={site} summary={missionSim.data?.summary} compact />
        <span>LOS · geometric center-of-disk, no refraction, not an RF link budget</span>
        <span>{activeSim.loading ? 'computing…' : activeSim.error ? 'simulation error' : activeSim.data ? `${activeSim.data.sampling.sampleCount.toLocaleString()} samples · eff ${activeSim.data.sampling.effectiveStepMinutes.toFixed(1)} min · ${activeSim.data.computeMs.toFixed(0)} ms` : 'idle'}</span>
        <span style={{ marginLeft: 'auto' }}>Space play · [ ] days · C compare · T terrain · O space · E educator · G guide · ? help</span>
      </footer>

      {customOpen && <CustomSiteModal onClose={() => setCustomOpen(false)} onCreate={createCustom} initial={customInitial} />}
      {settingsOpen && <SettingsModal config={config} onChange={setConfig} onClose={() => setSettingsOpen(false)} />}
      {horizonOpen && <HorizonTableModal site={site} current={current} onClose={() => setHorizonOpen(false)} onExport={() => handleExport('horizon')} visibilityBlocked={instantBlocked} />}
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} onReopenWelcome={() => { setShortcutsOpen(false); setOnboardingOpen(true); }} />}
      <Onboarding open={onboardingOpen} onClose={dismissOnboarding} onDemo={startDemo} onRealDem={startRealDem} />
      <StoryTutorial controller={story} world={storyWorld} timeMs={timeMs} />
      <EducatorOverlay open={guideOpen} onClose={() => setGuideOpen(false)} active={activeTour} step={tourStep}
        onStart={applyGuided} onStep={(d) => setTourStep((s) => clamp(s + d, 0, (activeTour?.steps.length ?? 1) - 1))} onApply={applyGuided}
        glossaryFocus={glossaryFocus}
        story={{ status: story.progress?.status ?? 'none', chapter: story.progress?.chapter ?? 0, onStart: story.start, onReplay: story.replay }} />
      {toast && (
        <div role="status" aria-live="polite" className="fade-in" style={{ position: 'fixed', bottom: 44, left: '50%', transform: 'translateX(-50%)', background: 'var(--paper-2)', border: '1px solid var(--ink)', borderRadius: 0, padding: '8px 14px', fontSize: 12, zIndex: 80, boxShadow: '4px 4px 0 rgba(28,36,48,.2)' }}>{toast}</div>
      )}
    </div>
  );
}
