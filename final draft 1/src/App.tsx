import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { GraduationCap, BookOpen } from 'lucide-react';
import type { AppMode, GuidedScenario, LandingSite, MissionConfig, Scenario } from './types/mission';
import { LANDING_SITES, makeCustomSite } from './data/landingSites';
import { DEFAULT_CONFIG, analysisWindow, evaluateAt } from './engine/simulation';
import { DAY_MS, HOUR_MS, clamp } from './engine/constants';
import { useSimulation } from './hooks/useSimulation';
import { cachedSimulation } from './engine/simulationClient';
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
import { CustomSiteModal, SettingsModal, HorizonTableModal, ShortcutsModal, type CustomSiteInput } from './components/Modals';
import { download, missionReportJSON, timeseriesCSV, horizonCSV, summaryCSV, comparisonCSV, type ComparisonRow } from './utils/export';

const BASELINE = Date.parse('2026-12-18T00:00:00Z');
const INITIAL_TIME = Date.parse('2026-12-20T08:00:00Z');
const TICKER = [
  '1.54° AXIAL TILT', '709h SYNODIC DAY', '±6.7° LAT LIBRATION', '±7.9° LON LIBRATION',
  '0.0″ AIRLESS REFRACTION', '1361 W/m² SOLAR CONSTANT', 'IAU 2015 MOON ROTATION',
  '360° TERRAIN OCCLUSION', 'DIRECT-TO-EARTH WINDOWS', 'LAUNCH-SLIP ECLIPSES',
];

export default function App() {
  const [sites, setSites] = useState<LandingSite[]>(LANDING_SITES);
  const [selectedId, setSelectedId] = useState('shackleton-rim');
  const [baselineMs, setBaselineMs] = useState(BASELINE);
  const [slipDays, setSlipDays] = useState(0);
  const [viewDays, setViewDays] = useState(30);
  const [config, setConfig] = useState<MissionConfig>(DEFAULT_CONFIG);
  const [timeMs, setTimeMs] = useState(INITIAL_TIME);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(3600);
  const [mode, setMode] = useState<AppMode>('planner');
  const [compareMode, setCompareMode] = useState(false);
  const [terrainView, setTerrainView] = useState(false);
  const [spaceView, setSpaceView] = useState(false);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
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

  const site = sites.find((s) => s.id === selectedId) ?? sites[0];
  const win = useMemo(() => analysisWindow(baselineMs, slipDays, config.durationDays, viewDays), [baselineMs, slipDays, config.durationDays, viewDays]);
  const current = useMemo(() => evaluateAt(site, timeMs, config), [site, timeMs, config]);
  const analysisConfig = useMemo(() => ({ ...config, stepMinutes: Math.max(config.stepMinutes, viewDays >= 90 ? 30 : 15) }), [config, viewDays]);
  const activeSim = useSimulation(site, win.startMs, win.endMs, analysisConfig);
  const missionSim = useSimulation(site, win.missionStart, win.missionEnd, config);
  const baselineSim = useSimulation(site, baselineMs, baselineMs + config.durationDays * DAY_MS, config);
  const events = activeSim.data?.events ?? [];

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  }, []);

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

  const overlayOpen = customOpen || settingsOpen || horizonOpen || shortcutsOpen || guideOpen;

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
      else if (e.key === 'Escape') { setCustomOpen(false); setSettingsOpen(false); setHorizonOpen(false); setShortcutsOpen(false); setGuideOpen(false); }
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

  const handleExport = useCallback((kind: 'json' | 'timeseries' | 'horizon' | 'summary') => {
    // Never export stale or in-flight results: the mission window must match the
    // current site/date/config (the hook returns null until the active key resolves).
    if (missionSim.loading) { notify('Mission window is still computing — export blocked to avoid stale results.'); return; }
    if (missionSim.error) { notify(`Mission window failed (${missionSim.error}) — nothing to export.`); return; }
    if (missionSim.data?.analysis && !missionSim.data.analysis.demoEligible) {
      notify(`Export blocked — analysis is ${missionSim.data.analysis.status}. Resolve the flagged issue before exporting.`);
      return;
    }
    const stamp = new Date(timeMs).toISOString().slice(0, 10);
    if (kind === 'json') download(`chandra-report-${stamp}.json`, missionReportJSON(site, config, missionSim.data, current), 'application/json');
    else if (kind === 'horizon') download(`chandra-horizon-${site.id}.csv`, horizonCSV(site, current), 'text/csv');
    else if (!missionSim.data) { notify('Mission window is still computing.'); return; }
    else if (kind === 'timeseries') download(`chandra-timeseries-${site.id}.csv`, timeseriesCSV(missionSim.data), 'text/csv');
    else download(`chandra-summary-${site.id}.csv`, summaryCSV(missionSim.data), 'text/csv');
    notify(`Exported ${kind}`);
  }, [site, config, missionSim.data, missionSim.loading, missionSim.error, current, timeMs, notify]);

  const handleComparisonExport = useCallback((kind: 'csv' | 'json', rows: ComparisonRow[]) => {
    const full = rows.map((r) => ({ ...r, sim: cachedSimulation(r.site, r.scenario.startMs, r.scenario.startMs + r.scenario.config.durationDays * DAY_MS, r.scenario.config) ?? null }));
    if (kind === 'csv') download('chandra-comparison.csv', comparisonCSV(full), 'text/csv');
    else download('chandra-comparison.json', JSON.stringify(full.map((r) => ({ scenario: r.scenario, site: r.site, summary: r.sim?.summary ?? null })), null, 2), 'application/json');
    notify('Comparison exported');
  }, [notify]);

  return (
    <div className="app-shell">
      <HeaderBar
        timeMs={timeMs} mode={mode} onMode={setMode} compareMode={compareMode}
        onCompare={() => { setTerrainView(false); setSpaceView(false); setCompareMode((v) => !v); }}
        terrainActive={terrainView} onTerrain={() => { setSpaceView(false); setTerrainView((v) => !v); }}
        spaceActive={spaceView} onSpace={() => { setTerrainView(false); setCompareMode(false); setSpaceView((v) => !v); }}
        onGuide={() => setGuideOpen(true)}
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
        <aside className="site-rail">
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
              <HorizonPanorama site={site} current={current} sim={activeSim.data} mode={mode} options={panorama} onOptions={setPanorama} />
              <div className="lower-grid">
                <PolarMap sites={sites} selected={site} current={current} onSelect={setSelectedId} onPlaceCustom={placeCustom} layers={mapLayers} onLayers={setMapLayers} />
                <SiteBrief site={site} current={current} onHorizonTable={() => setHorizonOpen(true)} onPin={pinCurrent} />
              </div>
            </>
          )}
        </main>
        <aside className="telemetry-rail">
          <TelemetryPanel site={site} current={current} sim={missionSim.data} events={events} timeMs={timeMs} mode={mode} config={config} onSettings={() => setSettingsOpen(true)} loading={missionSim.loading} error={missionSim.error} />
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
      {horizonOpen && <HorizonTableModal site={site} current={current} onClose={() => setHorizonOpen(false)} onExport={() => handleExport('horizon')} />}
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
      <EducatorOverlay open={guideOpen} onClose={() => setGuideOpen(false)} active={activeTour} step={tourStep}
        onStart={applyGuided} onStep={(d) => setTourStep((s) => clamp(s + d, 0, (activeTour?.steps.length ?? 1) - 1))} onApply={applyGuided} />
      {toast && (
        <div role="status" aria-live="polite" className="fade-in" style={{ position: 'fixed', bottom: 44, left: '50%', transform: 'translateX(-50%)', background: 'var(--paper-2)', border: '1px solid var(--ink)', borderRadius: 0, padding: '8px 14px', fontSize: 12, zIndex: 80, boxShadow: '4px 4px 0 rgba(28,36,48,.2)' }}>{toast}</div>
      )}
    </div>
  );
}
