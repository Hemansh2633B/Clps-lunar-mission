import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Box, Crosshair, Download, Layers, Mountain, Play, RotateCcw, Sun, AlertTriangle, MapPin } from 'lucide-react';
import type { AppMode, LandingSite } from '../types/mission';
import type { HorizonMask, SurfaceInspection, SunPosition, TerrainConfig, TerrainData, TerrainExample, TerrainMode, TerrainQuality } from '../terrain/types';
import { terrainApi } from '../terrain/api';
import { syntheticTerrain, SYNTHETIC_WARNING } from '../terrain/synthetic';
import { horizonFromGrid } from '../terrain/horizon';
import { createTerrain, disposeTerrain, setExaggeration, createAnnotations, disposeAnnotations, interpolateSample, type TerrainMesh } from '../terrain/terrainMesh';
import { LightingController, sunDirection } from '../terrain/lighting';
import { horizonImportBlocked } from '../terrain/missionProfile';
import { classifyFrame } from '../engine/lunarFrame';
import { sampleLonLat } from '../terrain/coordinates';
import { computeEphemeris } from '../engine/ephemeris';
import { formatCoord, formatUTC } from '../engine/constants';
import { download, toCSV } from '../utils/export';
import type { CustomSiteInput } from './Modals';

export type TerrainSiteInput = CustomSiteInput & { horizon: HorizonMask };

interface Props {
  site: LandingSite;
  timeMs: number;
  mode: AppMode;
  onCreateSite: (input: TerrainSiteInput) => void;
  notify: (msg: string) => void;
}

interface Ctx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  lighting: LightingController;
  mesh: TerrainMesh | null;
  annotations: THREE.Group | null;
  requestRender: () => void;
  resetCamera: () => void;
  setCameraPreset: (preset: 'top' | 'oblique') => void;
  orbitBy: (azDeg: number, elDeg: number) => void;
  zoomBy: (factor: number) => void;
  rebuildAnnotations: () => void;
  updateLighting: () => void;
}

const DEFAULT_EXAMPLES: TerrainExample[] = [
  { label: 'South-pole example', latitude: -89.5, longitude: 45, radius_km: 5, notes: 'Default prototype example; optional NASA LOLA subset.' },
  { label: 'Near-pole inspection', latitude: -89.9, longitude: 0, radius_km: 2, notes: 'Shackleton vicinity; requires a covered subset.' },
  { label: 'Exact south pole', latitude: -90, longitude: 45, radius_km: 1, notes: 'Longitude defines the local meridian at the pole.' },
  { label: 'North-pole reference', latitude: 89.5, longitude: 45, radius_km: 5, notes: 'Requires a north-pole DEM.' },
];

declare global {
  interface Window {
    __CHANDRA_TERRAIN__?: {
      mode: string; gridSize: number; triangles: number; landingPosition: number[] | null;
      exaggeration: number; shadows: boolean; sun: SunPosition | null; sunDirection: number[]; camera: number[];
      shadowMapSize: number[]; calls: number;
      horizon: { bins: number; coverage: number; importBlocked: string | null } | null;
    };
  }
}

export function TerrainLab({ site, timeMs, mode, onCreateSite, notify }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const dataRef = useRef<TerrainData | null>(null);
  const exaggerationRef = useRef(1);
  const shadowsRef = useRef(true);
  const sunRef = useRef<SunPosition>({ azimuthDeg: 103, elevationDeg: 2.5, source: 'manual' });
  const pinnedRef = useRef(false);
  const inspectRef = useRef<(hit: THREE.Intersection | null, pin: boolean) => void>(() => {});
  const [webglError, setWebglError] = useState<string | null>(null);
  const [backend, setBackend] = useState<TerrainConfig | null>(null);
  const [backendOnline, setBackendOnline] = useState(false);
  const [examples, setExamples] = useState<TerrainExample[]>(DEFAULT_EXAMPLES);
  const [form, setForm] = useState({ mode: 'synthetic' as TerrainMode, latitude: -89.5, longitude: 45, radius: 5, quality: 'medium' as TerrainQuality });
  const [data, setData] = useState<TerrainData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exaggeration, setExaggerationState] = useState(1);
  const [shadows, setShadowsState] = useState(true);
  const [sunMode, setSunMode] = useState<'manual' | 'ephemeris'>('manual');
  const [manualAz, setManualAz] = useState(103);
  const [manualEl, setManualEl] = useState(2.5);
  const [inspection, setInspection] = useState<SurfaceInspection | null>(null);
  const [horizon, setHorizon] = useState<HorizonMask | null>(null);
  const [horizonLoading, setHorizonLoading] = useState(false);
  const [azStep, setAzStep] = useState(2);
  const [eyeHeight, setEyeHeight] = useState(2);
  const [autoReal, setAutoReal] = useState(false);
  const buildSeqRef = useRef(0);

  dataRef.current = data;
  exaggerationRef.current = exaggeration;
  shadowsRef.current = shadows;

  const sunPosition = useMemo<SunPosition>(() => {
    if (sunMode === 'manual') return { azimuthDeg: manualAz, elevationDeg: manualEl, source: 'manual' };
    const lat = data?.latitude ?? form.latitude;
    const lon = data?.longitude ?? form.longitude;
    const elev = data?.landing_elevation_m ?? 0;
    const eph = computeEphemeris({ latitude: lat, longitude: lon, elevationM: elev } as LandingSite, timeMs);
    return { azimuthDeg: eph.sun.azimuthDeg, elevationDeg: eph.sun.elevationDeg, source: 'ephemeris' };
  }, [sunMode, manualAz, manualEl, data, form.latitude, form.longitude, timeMs]);
  sunRef.current = sunPosition;

  inspectRef.current = (hit, pin) => {
    const d = dataRef.current;
    if (!hit || !d) { if (!pinnedRef.current) setInspection(null); return; }
    const sample = interpolateSample(hit);
    if (!sample) return;
    const coord = sampleLonLat(sample.east_m, sample.north_m, d);
    setInspection({ ...sample, latitude: coord.latitude, longitude: coord.longitude, pinned: pin });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    } catch {
      setWebglError('WebGL is unavailable. Enable hardware acceleration or use a browser with WebGL2 support.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x090b0e);
    container.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
    camera.position.set(9, 7, 11);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.495;
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('aria-label', '3D terrain viewport. Arrow keys orbit, plus and minus zoom, Home resets the view.');
    renderer.domElement.style.outline = 'none';
    const lighting = new LightingController(scene, renderer);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let framePending = false;
    let inspectPending = false;
    let lastPick = 0;
    let down: [number, number] | null = null;

    const render = () => {
      framePending = false;
      const changed = controls.update();
      camera.updateMatrixWorld();
      const ctx = ctxRef.current;
      if (inspectPending && ctx?.mesh && !pinnedRef.current) {
        inspectPending = false;
        raycaster.setFromCamera(pointer, camera);
        inspectRef.current(raycaster.intersectObject(ctx.mesh, false)[0] ?? null, false);
      }
      if (dataRef.current && labelRef.current) {
        const p = new THREE.Vector3(0, 0, 0).project(camera);
        const visible = p.z >= -1 && p.z <= 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
        labelRef.current.style.display = visible ? 'block' : 'none';
        labelRef.current.style.left = `${((p.x + 1) / 2) * container.clientWidth}px`;
        labelRef.current.style.top = `${((1 - p.y) / 2) * container.clientHeight}px`;
      }
      renderer.render(scene, camera);
      if (window.__CHANDRA_TERRAIN__) {
        window.__CHANDRA_TERRAIN__.camera = camera.position.toArray();
        window.__CHANDRA_TERRAIN__.calls = renderer.info.render.calls;
      }
      if (changed) requestRender();
    };
    const requestRender = () => {
      if (!framePending) { framePending = true; requestAnimationFrame(render); }
    };
    const resetCamera = () => {
      const d = dataRef.current;
      if (!d) return;
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = true;
      const r = d.radius_km;
      const relief = (d.statistics.range_m / 1000) * exaggerationRef.current;
      const distance = Math.max(r, relief * 0.75);
      camera.position.set(distance * 1.35, distance * 1.25, distance * 1.75);
      controls.target.set(0, 0, 0);
      controls.minDistance = r * 0.03;
      controls.maxDistance = Math.max(r * 12, relief * 4);
      controls.update();
      requestRender();
    };
    const setCameraPreset = (preset: 'top' | 'oblique') => {
      const d = dataRef.current;
      if (!d) return;
      if (preset === 'oblique') { resetCamera(); return; }
      const distance = Math.max(d.radius_km * 2.2, (d.statistics.range_m / 1000) * exaggerationRef.current);
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = true;
      camera.position.set(0, distance, 0.0001);
      controls.target.set(0, 0, 0);
      controls.update();
      requestRender();
    };
    const orbitBy = (azDeg: number, elDeg: number) => {
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta += THREE.MathUtils.degToRad(azDeg);
      spherical.phi = THREE.MathUtils.clamp(spherical.phi + THREE.MathUtils.degToRad(elDeg), 0.05, controls.maxPolarAngle);
      offset.setFromSpherical(spherical);
      camera.position.copy(controls.target).add(offset);
      controls.update();
      requestRender();
    };
    const zoomBy = (factor: number) => {
      const offset = camera.position.clone().sub(controls.target);
      const length = THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance);
      offset.setLength(length);
      camera.position.copy(controls.target).add(offset);
      controls.update();
      requestRender();
    };
    const onCanvasKey = (event: KeyboardEvent) => {
      const step = event.shiftKey ? 15 : 5;
      if (event.key === 'ArrowLeft') orbitBy(-step, 0);
      else if (event.key === 'ArrowRight') orbitBy(step, 0);
      else if (event.key === 'ArrowUp') orbitBy(0, -step);
      else if (event.key === 'ArrowDown') orbitBy(0, step);
      else if (event.key === '+' || event.key === '=') zoomBy(0.85);
      else if (event.key === '-' || event.key === '_') zoomBy(1.18);
      else if (event.key === 'Home') resetCamera();
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    renderer.domElement.addEventListener('keydown', onCanvasKey);
    const rebuildAnnotations = () => {
      const ctx = ctxRef.current;
      const d = dataRef.current;
      if (!ctx || !d) return;
      if (ctx.annotations) { scene.remove(ctx.annotations); disposeAnnotations(ctx.annotations); }
      ctx.annotations = createAnnotations(d, exaggerationRef.current);
      scene.add(ctx.annotations);
    };
    const updateLighting = () => {
      const ctx = ctxRef.current;
      const d = dataRef.current;
      if (!ctx?.mesh || !d) return;
      ctx.lighting.applySunPosition(ctx.mesh, d, sunRef.current, shadowsRef.current);
      requestRender();
    };
    const ctx: Ctx = { renderer, scene, camera, controls, lighting, mesh: null, annotations: null, requestRender, resetCamera, setCameraPreset, orbitBy, zoomBy, rebuildAnnotations, updateLighting };
    ctxRef.current = ctx;

    controls.addEventListener('change', requestRender);
    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      requestRender();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const locate = (event: PointerEvent | MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    };
    const onMove = (event: PointerEvent) => {
      if (!ctxRef.current?.mesh || event.buttons || pinnedRef.current || performance.now() - lastPick < 80) return;
      lastPick = performance.now();
      locate(event);
      inspectPending = true;
      requestRender();
    };
    const onDown = (event: PointerEvent) => { down = [event.clientX, event.clientY]; };
    const onClick = (event: MouseEvent) => {
      if (down && Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return;
      locate(event);
      raycaster.setFromCamera(pointer, camera);
      const mesh = ctxRef.current?.mesh;
      const hit = mesh ? raycaster.intersectObject(mesh, false)[0] ?? null : null;
      pinnedRef.current = hit ? !pinnedRef.current : false;
      inspectRef.current(hit, pinnedRef.current);
      requestRender();
    };
    const onLeave = () => { if (!pinnedRef.current) setInspection(null); };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('click', onClick);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    requestRender();

    return () => {
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('click', onClick);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      renderer.domElement.removeEventListener('keydown', onCanvasKey);
      if (ctx.mesh) { scene.remove(ctx.mesh); disposeTerrain(ctx.mesh); }
      if (ctx.annotations) { scene.remove(ctx.annotations); disposeAnnotations(ctx.annotations); }
      renderer.dispose();
      renderer.domElement.remove();
      ctxRef.current = null;
    };
  }, []);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !data) return;
    if (ctx.mesh) { ctx.scene.remove(ctx.mesh); disposeTerrain(ctx.mesh); }
    ctx.mesh = createTerrain(data);
    ctx.scene.add(ctx.mesh);
    setExaggeration(ctx.mesh, exaggerationRef.current);
    ctx.rebuildAnnotations();
    ctx.resetCamera();
    ctx.updateLighting();
    pinnedRef.current = false;
    setInspection(null);
    ctx.requestRender();
  }, [data]);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx?.mesh) return;
    setExaggeration(ctx.mesh, exaggeration);
    ctx.rebuildAnnotations();
    ctx.updateLighting();
    ctx.requestRender();
  }, [exaggeration]);

  useEffect(() => {
    ctxRef.current?.updateLighting();
  }, [sunPosition, shadows]);

  useEffect(() => {
    let active = true;
    terrainApi.config()
      .then(async (config) => {
        if (!active) return;
        setBackend(config);
        setBackendOnline(true);
        setForm((f) => ({ ...f, mode: config.dem_ready ? 'real' : 'synthetic' }));
        if (config.dem_ready) setAutoReal(true);
        try {
          const ex = await terrainApi.examples();
          if (active && ex.examples?.length) setExamples(ex.examples);
        } catch { /* keep defaults */ }
      })
      .catch(() => { if (active) setBackendOnline(false); });
    return () => { active = false; };
  }, []);

  const build = useCallback(async (override?: Partial<typeof form>) => {
    const f = { ...form, ...override };
    const seq = ++buildSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      let result: TerrainData;
      if (f.mode === 'synthetic') {
        result = syntheticTerrain(f.latitude, f.longitude, f.radius, f.quality);
      } else {
        if (!backendOnline) throw new Error('Real lunar DEM requires the local backend. Run npm run dev:api (or npm run dev:full), then retry. Real mode never falls back to synthetic data.');
        result = await terrainApi.terrain({ latitude: f.latitude, longitude: f.longitude, radius_km: f.radius, quality: f.quality, mode: 'real' });
      }
      if (seq !== buildSeqRef.current) return; // a newer request won
      setData(result);
      setHorizon(null);
      setForm(f);
    } catch (err) {
      if (seq === buildSeqRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === buildSeqRef.current) setLoading(false);
    }
  }, [form, backendOnline]);

  useEffect(() => {
    if (!autoReal || !backendOnline) return;
    setAutoReal(false);
    void build({ mode: 'real' });
  }, [autoReal, backendOnline, build]);

  useEffect(() => {
    // Initial demo model so the lab is never an empty placeholder.
    void build({ mode: 'synthetic' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const computeHorizon = useCallback(async () => {
    if (!data) return;
    setHorizonLoading(true);
    setError(null);
    try {
      const quality: TerrainQuality = data.grid.size <= 129 ? 'low' : data.grid.size <= 257 ? 'medium' : 'high';
      const mask = data.mode === 'real' && backendOnline
        ? await terrainApi.horizon({ latitude: data.latitude, longitude: data.longitude, radius_km: data.radius_km, quality, mode: 'real', az_step_deg: azStep, eye_height_m: eyeHeight })
        : horizonFromGrid(data, azStep, eyeHeight);
      setHorizon(mask);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setHorizonLoading(false);
    }
  }, [data, backendOnline, azStep, eyeHeight]);

  const exportHorizon = useCallback(() => {
    if (!horizon) return;
    const rows = horizon.azimuths_deg.map((az, i) => ({
      azimuth_deg: az,
      horizon_elevation_deg: horizon.elevations_deg[i],
      ray_coverage_percent: horizon.ray_coverage_percent[i],
      max_obstacle_range_km: horizon.max_obstacle_range_km[i],
    }));
    download(`chandra-dem-horizon-${horizon.latitude.toFixed(2)}-${horizon.longitude.toFixed(1)}.csv`, toCSV(rows), 'text/csv');
    notify('DEM horizon mask exported');
  }, [horizon, notify]);

  const sendToMission = useCallback(() => {
    if (!data || !horizon || horizonImportBlocked(horizon)) return;
    onCreateSite({
      name: `${horizon.synthetic ? 'Demo' : 'DEM'} ${data.latitude.toFixed(2)}° ${data.longitude.toFixed(1)}°`,
      latitude: data.latitude,
      longitude: data.longitude,
      elevationM: data.landing_elevation_m,
      preset: 'flat',
      horizon,
    });
  }, [data, horizon, onCreateSite]);

  useEffect(() => {
    const ctx = ctxRef.current;
    const d = data;
    const n = d?.grid.size ?? 0;
    const center = n ? Math.floor(n / 2) * n + Math.floor(n / 2) : 0;
    window.__CHANDRA_TERRAIN__ = {
      mode: d?.synthetic ? 'synthetic' : 'real',
      gridSize: n,
      triangles: ctx?.mesh ? ctx.mesh.geometry.index!.count / 3 : 0,
      landingPosition: ctx?.mesh ? Array.from(ctx.mesh.geometry.attributes.position.array.slice(center * 3, center * 3 + 3)) as number[] : null,
      exaggeration,
      shadows,
      sun: sunPosition,
      sunDirection: sunDirection(sunPosition.azimuthDeg, sunPosition.elevationDeg).toArray(),
      camera: ctx?.camera.position.toArray() ?? [],
      shadowMapSize: ctx?.lighting.sun.shadow.mapSize.toArray() ?? [],
      calls: ctx?.renderer.info.render.calls ?? 0,
      horizon: horizon ? { bins: horizon.elevations_deg.length, coverage: horizon.mean_coverage_percent, importBlocked: horizonImportBlocked(horizon) } : null,
    };
  }, [data, exaggeration, shadows, sunPosition, inspection, horizon]);

  const educator = mode === 'educator';
  const stats = data?.statistics;
  const importBlock = horizon ? horizonImportBlocked(horizon) : null;
  const formError = !Number.isFinite(form.latitude) || form.latitude < -90 || form.latitude > 90
    ? 'Latitude must be between −90° and +90°.'
    : !Number.isFinite(form.longitude) || form.longitude < -180 || form.longitude > 360
      ? 'Longitude must be in −180…180 or 0…360°E.'
      : !Number.isFinite(form.radius) || form.radius < 0.5 || form.radius > 20
        ? 'Radius must be between 0.5 and 20 km.'
        : null;
  const eyeError = !Number.isFinite(eyeHeight) || eyeHeight < 0 || eyeHeight > 50 ? 'Eye height must be 0–50 m.' : null;

  return (
    <section className="panel terrain-lab" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="panel-header">
        <span className="panel-title"><Box size={13} /> Terrain Lab · 3D DEM inspector</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`chip ${backendOnline ? 'nominal' : 'solar'}`}>{backendOnline ? (backend?.dem_ready ? 'DEM ready' : 'API online · no DEM') : 'API offline · demo only'}</span>
          <span className={`chip ${data?.synthetic ? 'solar' : 'earth'}`}>{data ? (data.synthetic ? 'Synthetic demo' : 'Real DEM') : 'No model'}</span>
        </div>
      </div>

      <div className="terrain-lab-toolbar" style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'flex-end', background: 'var(--panel-2)' }}>
        <div className="field"><label htmlFor="terrain-mode">Source</label>
          <select id="terrain-mode" className="input" style={{ width: 150 }} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as TerrainMode })}>
            <option value="synthetic">Synthetic demo</option>
            <option value="real">Real lunar DEM</option>
          </select>
        </div>
        <div className="field"><label htmlFor="terrain-lat">Latitude °</label><input id="terrain-lat" className="input mono" style={{ width: 90 }} type="number" step="any" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: Number(e.target.value) })} /></div>
        <div className="field"><label htmlFor="terrain-lon">Longitude °E</label><input id="terrain-lon" className="input mono" style={{ width: 90 }} type="number" step="any" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: Number(e.target.value) })} /></div>
        <div className="field"><label htmlFor="terrain-radius">Radius km</label><input id="terrain-radius" className="input mono" style={{ width: 80 }} type="number" min={0.5} max={20} step={0.5} value={form.radius} onChange={(e) => setForm({ ...form, radius: Number(e.target.value) })} /></div>
        <div className="field"><label htmlFor="terrain-quality">Grid</label>
          <select id="terrain-quality" className="input" style={{ width: 130 }} value={form.quality} onChange={(e) => setForm({ ...form, quality: e.target.value as TerrainQuality })}>
            <option value="low">Low · 129²</option>
            <option value="medium">Medium · 257²</option>
            <option value="high">High · 513²</option>
          </select>
        </div>
        <button className="btn primary" disabled={loading || !!webglError || !!formError} onClick={() => void build()}><Play size={13} /> {loading ? 'Building…' : 'Build terrain'}</button>
        <button className="btn" disabled={loading} onClick={() => void build({ latitude: site.latitude, longitude: site.longitude, radius: 5 })}><MapPin size={13} /> Load selected site</button>
        <button className="btn ghost" onClick={() => ctxRef.current?.resetCamera()}><RotateCcw size={13} /> Reset view</button>
      </div>

      {formError && <div role="alert" style={{ padding: '6px 12px', background: '#fdf0d5', borderBottom: '1px solid #d9b877', color: 'var(--brass)', fontSize: 11, display: 'flex', gap: 8 }}><AlertTriangle size={13} /> {formError}</div>}
      {error && <div role="alert" style={{ padding: '8px 12px', background: '#fbe9e7', borderBottom: '1px solid #e0a99f', color: '#c23b32', fontSize: 12, display: 'flex', gap: 8 }}><AlertTriangle size={14} /> {error}</div>}
      {webglError && <div role="alert" style={{ padding: '8px 12px', background: '#fbe9e7', color: '#c23b32', fontSize: 12 }}>{webglError}</div>}

      <div className="terrain-lab-body">
        <aside className="terrain-lab-controls">
          <div>
            <div className="panel-title" style={{ marginBottom: 6 }}>Example locations</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {examples.map((ex) => (
                <button key={ex.label} className="btn sm ghost" disabled={loading} style={{ justifyContent: 'flex-start', height: 'auto', padding: '6px 8px', textAlign: 'left' }} title={ex.notes}
                  onClick={() => void build({ latitude: ex.latitude, longitude: ex.longitude, radius: ex.radius_km })}>
                  <span>{ex.label}<br /><span className="mono" style={{ fontSize: 9, color: 'var(--dim)' }}>{ex.latitude}°, {ex.longitude}° · {ex.radius_km} km</span></span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="panel-title" style={{ marginBottom: 6 }}><Sun size={12} color="var(--solar)" /> Solar direction</div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              <button className={`btn sm ${sunMode === 'manual' ? 'active' : 'ghost'}`} style={{ flex: 1 }} onClick={() => setSunMode('manual')}>Manual</button>
              <button className={`btn sm ${sunMode === 'ephemeris' ? 'active' : 'ghost'}`} style={{ flex: 1 }} onClick={() => setSunMode('ephemeris')}>Ephemeris</button>
            </div>
            {sunMode === 'manual' ? (
              <>
                <div className="field"><label htmlFor="terrain-sun-az">Azimuth · {manualAz}°</label><input id="terrain-sun-az" type="range" className="solar" min={0} max={360} step={1} value={manualAz} onChange={(e) => setManualAz(Number(e.target.value))} /></div>
                <div className="field" style={{ marginTop: 6 }}><label htmlFor="terrain-sun-el">Elevation · {manualEl.toFixed(1)}°</label><input id="terrain-sun-el" type="range" className="solar" min={-10} max={90} step={0.1} value={manualEl} onChange={(e) => setManualEl(Number(e.target.value))} /></div>
              </>
            ) : (
              <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>
                <div className="mono" style={{ color: 'var(--solar)' }}>{sunPosition.azimuthDeg.toFixed(1)}° az · {sunPosition.elevationDeg.toFixed(2)}° el</div>
                {formatUTC(timeMs)}<br />IAU 2015 ephemeris preview. Verify DEM body frame before operational use.
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>
              <input type="checkbox" checked={shadows} onChange={(e) => setShadowsState(e.target.checked)} /> Terrain self-shadowing
            </label>
          </div>

          <div>
            <div className="panel-title" style={{ marginBottom: 6 }}><Layers size={12} /> Vertical relief · {exaggeration}×</div>
            <input aria-label="Vertical relief exaggeration" type="range" min={1} max={10} step={0.5} value={exaggeration} onChange={(e) => setExaggerationState(Number(e.target.value))} />
            <div style={{ fontSize: 10, color: exaggeration > 1 ? 'var(--solar)' : 'var(--dim)', marginTop: 4 }}>
              {exaggeration === 1 ? 'True vertical scale. Lunar curvature included.' : `${exaggeration}× relief. Reported elevations remain unchanged.`}
            </div>
          </div>

          <div>
            <div className="panel-title" style={{ marginBottom: 6 }}><Mountain size={12} /> Horizon mask</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
              <div className="field"><label htmlFor="terrain-az-step">Azimuth bin</label>
                <select id="terrain-az-step" className="input" value={azStep} onChange={(e) => setAzStep(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 15].map((s) => <option key={s} value={s}>{s}° · {360 / s} rays</option>)}
                </select>
              </div>
              <div className="field"><label htmlFor="terrain-eye-height">Eye height m</label>
                <input id="terrain-eye-height" className="input mono" type="number" min={0} max={50} step={0.5} value={eyeHeight} onChange={(e) => setEyeHeight(Number(e.target.value))} />
              </div>
            </div>
            {eyeError && <div role="alert" style={{ fontSize: 9, color: 'var(--solar)', marginBottom: 4 }}>{eyeError}</div>}
            <button className="btn sm" style={{ width: '100%' }} disabled={!data || horizonLoading || !!eyeError} onClick={() => void computeHorizon()}>{horizonLoading ? 'Ray-marching…' : 'Compute 360° horizon'}</button>
            {horizon && (
              <div style={{ marginTop: 8 }}>
                <svg viewBox="0 0 360 80" style={{ width: '100%', height: 70, background: '#fffdf7', borderRadius: 4 }}>
                  {horizon.azimuths_deg.map((az, i) => {
                    const h = horizon.elevations_deg[i];
                    const y = 60 - Math.max(-10, Math.min(30, h)) * 1.5;
                    const cov = horizon.ray_coverage_percent[i];
                    return <rect key={az} x={az} y={Math.min(60, y)} width={horizon.azimuth_step_deg} height={Math.abs(60 - y) + 1} fill={cov < 100 ? '#c23b32' : h > 0 ? '#5c5348' : '#0e7490'} opacity={0.8} />;
                  })}
                  <line x1={0} x2={360} y1={60} y2={60} stroke="#b39b73" strokeWidth={0.75} />
                  <text x={2} y={10} fontSize={7} fill="#8a7358" fontFamily="JetBrains Mono">+30°</text>
                  <text x={2} y={76} fontSize={7} fill="#8a7358" fontFamily="JetBrains Mono">−10°</text>
                </svg>
                <div style={{ fontSize: 9, color: 'var(--dim)', marginTop: 4 }}>Ray coverage {horizon.mean_coverage_percent.toFixed(1)}% · eye {horizon.eye_height_m} m · {horizon.azimuth_step_deg}° bins</div>
                <div style={{ fontSize: 9, color: 'var(--dim)', marginTop: 2 }}>Horizon radius {horizon.horizon_radius_km.toFixed(3)} km · edge inset {horizon.edge_inset_m.toFixed(1)} m · step {horizon.sampling_step_m.toFixed(1)} m</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                  <button className="btn sm" onClick={exportHorizon}><Download size={11} /> CSV</button>
                  <button className="btn sm primary" disabled={!!importBlock} onClick={sendToMission}>Use in mission</button>
                </div>
                {importBlock && <div role="alert" style={{ fontSize: 9, color: 'var(--blocked)', marginTop: 6, lineHeight: 1.4 }}>{importBlock}</div>}
                {horizon.synthetic && <div style={{ fontSize: 9, color: 'var(--solar)', marginTop: 6, lineHeight: 1.4 }}>Synthetic demo mask — importing it creates a clearly labeled demo site, not a real DEM site.</div>}
                <div style={{ fontSize: 9, color: 'var(--solar)', marginTop: 6, lineHeight: 1.4 }}>{horizon.frame_note}</div>
              </div>
            )}
          </div>
        </aside>

        <div className="terrain-lab-main">
          <div ref={containerRef} className="terrain-viewport">
            {data?.synthetic && <div className="terrain-synthetic-banner">{SYNTHETIC_WARNING}</div>}
            {loading && <div className="terrain-loading pulse">Extracting terrain…</div>}
            {!data && !loading && <div className="terrain-loading">Build a terrain model to begin.</div>}
            <div ref={labelRef} className="terrain-landing-label" style={{ display: 'none' }}>LANDING SITE</div>
            <div className="terrain-view-tools">
              <button className="btn sm ghost" onClick={() => ctxRef.current?.setCameraPreset('top')} title="Top-down view">Top</button>
              <button className="btn sm ghost" onClick={() => ctxRef.current?.setCameraPreset('oblique')} title="Oblique view">Oblique</button>
              <button className="btn sm ghost" onClick={() => ctxRef.current?.zoomBy(0.85)} title="Zoom in">+</button>
              <button className="btn sm ghost" onClick={() => ctxRef.current?.zoomBy(1.18)} title="Zoom out">−</button>
            </div>
            <div className="terrain-guide">DRAG orbit · RIGHT DRAG pan · SCROLL zoom · CLICK pin sample · ARROWS orbit · +/− zoom · HOME reset</div>
            {inspection && (
              <div className="terrain-inspection mono">
                <div style={{ color: inspection.pinned ? 'var(--nominal)' : 'var(--muted)', fontSize: 9, letterSpacing: '.08em' }}>{inspection.pinned ? 'PINNED · CLICK TO RELEASE' : 'SURFACE INSPECTOR'}</div>
                <div>E {inspection.east_m.toFixed(1)} m · N {inspection.north_m.toFixed(1)} m</div>
                <div>Elev {inspection.elevation_m.toFixed(1)} m · Dist {(inspection.distance_m / 1000).toFixed(3)} km</div>
                <div>{formatCoord(inspection.latitude, inspection.longitude)}</div>
              </div>
            )}
            {educator && <div className="terrain-educator">This is a 3D elevation model. Drag to orbit; the green dot is the exact landing coordinate. Shadows are a visual preview, not a certified illumination solver.</div>}
          </div>

          <div className="terrain-stats">
            {([
              ['Landing elev', data ? `${data.landing_elevation_m.toFixed(1)} m` : '—'],
              ['Minimum', stats ? `${stats.minimum_m.toFixed(1)} m` : '—'],
              ['Maximum', stats ? `${stats.maximum_m.toFixed(1)} m` : '—'],
              ['Range', stats ? `${stats.range_m.toFixed(1)} m` : '—'],
              ['Radius', data ? `${data.radius_km} km` : '—'],
              ['Grid', data ? `${data.grid.size}²` : '—'],
              ['Coverage', stats ? `${stats.coverage_percent.toFixed(1)}%` : '—'],
            ] as const).map(([label, value]) => (
              <div className="metric sm" key={label}><span className="label">{label}</span><span className="value" style={{ fontSize: 13 }}>{value}</span></div>
            ))}
          </div>
          {data && (
            <div style={{ padding: '6px 12px', fontSize: 10, color: 'var(--dim)', borderTop: '1px solid var(--border)', lineHeight: 1.5 }}>
              <Crosshair size={10} style={{ display: 'inline', marginRight: 4 }} />
              {data.source.filename} · {data.grid.spacing_m.toFixed(1)} m spacing · CRS sphere {(data.source.lunar_radius_m / 1000).toFixed(3)} km · Frame {data.source.lunar_reference_frame || 'demo'} · Datum: {data.source.elevation_reference}
              {!backendOnline && <span style={{ color: 'var(--solar)' }}> · Backend offline: start npm run dev:api for real DEM loading.</span>}
              {!data.synthetic && (() => {
                const cls = classifyFrame(data.source.lunar_reference_frame);
                return (
                  <div style={{ marginTop: 3, color: cls.recognized ? 'var(--nominal)' : 'var(--blocked)' }}>
                    {cls.recognized
                      ? `Frame compatibility: ${cls.note}`
                      : `Frame compatibility: UNVERIFIED — ${cls.note}`}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
