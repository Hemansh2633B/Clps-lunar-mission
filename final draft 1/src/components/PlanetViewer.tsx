import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Play, Pause, Globe2, Sun, Earth, Sparkles, Grid3x3, CircleDot } from 'lucide-react';
import type { AppMode, LandingSite } from '../types/mission';
import { computeEphemeris } from '../engine/ephemeris';
import { HOUR_MS, formatUTC, mjd } from '../engine/constants';
import { latLonToVec3 } from '../three/geo';

declare global {
  interface Window {
    __CHANDRA_PLANET__?: {
      timeMs: number; playing: boolean; speedHrsPerSec: number;
      subsolar: [number, number]; subearth: [number, number];
      sunDir: [number, number, number]; sites: number; camera: number[];
    };
  }
}

const SYNODIC_H = 709; // mean lunation, hours
const SPEEDS = [1, 6, 24, 72, 168]; // simulated hours per real second
const SPEED_LABELS = ['1 h/s', '6 h/s', '1 day/s', '3 days/s', '7 days/s'];

interface Props {
  sites: LandingSite[];
  selectedId: string;
  onSelect: (id: string) => void;
  timeMs: number;
  onTime: (ms: number) => void;
  mode: AppMode;
}

interface Three {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
  sun: THREE.DirectionalLight; sunGlow: THREE.Sprite; earthGroup: THREE.Group; earthLine: THREE.Line;
  markers: THREE.Group; selectedRing: THREE.Mesh; subsolarDot: THREE.Mesh; subearthDot: THREE.Mesh;
  terminator: THREE.LineLoop; graticule: THREE.LineSegments; stars: THREE.Points;
  raf: number; lastEphem: number; sunDir: THREE.Vector3; earthDir: THREE.Vector3;
}

export function PlanetViewer({ sites, selectedId, onSelect, timeMs, onTime, mode }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const threeRef = useRef<Three | null>(null);
  const simTimeRef = useRef(timeMs);
  const anchorRef = useRef(timeMs);
  const playingRef = useRef(false);
  const speedRef = useRef(2);
  const togglesRef = useRef({ sites: true, terminator: true, earth: true, stars: true, graticule: false });
  const siteRef = useRef<LandingSite>(sites[0]);
  const labelsRef = useRef<{ site: HTMLDivElement | null; subsolar: HTMLDivElement | null; earth: HTMLDivElement | null }>({ site: null, subsolar: null, earth: null });

  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(2);
  const [toggles, setToggles] = useState(togglesRef.current);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [hud, setHud] = useState({ lat: 0, lon: 0, eLat: 0, eLon: 0 });
  const hudRef = useRef(hud); hudRef.current = hud;
  playingRef.current = playing;
  speedRef.current = speedIdx;
  togglesRef.current = toggles;

  const selectedSite = useMemo(() => sites.find((s) => s.id === selectedId) ?? sites[0], [sites, selectedId]);
  siteRef.current = selectedSite;

  // follow the global clock when paused (scrubbing)
  useEffect(() => { if (!playingRef.current) { simTimeRef.current = timeMs; anchorRef.current = timeMs; } }, [timeMs]);

  // ---- scene bootstrap ----
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { setWebglError('WebGL is unavailable in this browser.'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05060a);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 400);
    camera.position.set(3.1, 1.0, 1.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 1.45; controls.maxDistance = 14; controls.enablePan = false;

    // Moon
    const loader = new THREE.TextureLoader();
    const moonTex = loader.load('/assets/moon_1024.jpg', (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; });
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(1, 128, 128),
      new THREE.MeshStandardMaterial({ map: moonTex, bumpMap: moonTex, bumpScale: 0.004, roughness: 1, metalness: 0 }),
    );
    scene.add(moon);

    // Lighting: a single hard sun (airless terminator) + faint earthshine
    const sun = new THREE.DirectionalLight(0xfff4e0, 3.4);
    scene.add(sun); scene.add(sun.target);
    scene.add(new THREE.AmbientLight(0x223047, 0.10));

    // Sun glow billboard
    const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 128;
    const gctx = glowCanvas.getContext('2d')!;
    const grad = gctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,244,214,1)'); grad.addColorStop(0.25, 'rgba(255,214,140,0.85)'); grad.addColorStop(1, 'rgba(255,180,80,0)');
    gctx.fillStyle = grad; gctx.fillRect(0, 0, 128, 128);
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowCanvas), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sunGlow.scale.setScalar(2.2); scene.add(sunGlow);

    // Earth (direction only — not to scale)
    const earthGroup = new THREE.Group();
    const earthTex = loader.load('/assets/earth_atmos_2048.jpg', (t) => { t.colorSpace = THREE.SRGBColorSpace; });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(0.3, 48, 48), new THREE.MeshStandardMaterial({ map: earthTex, roughness: 0.9, metalness: 0 }));
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(0.33, 48, 48), new THREE.MeshBasicMaterial({ color: 0x6fb7ff, transparent: true, opacity: 0.16, side: THREE.BackSide }));
    earthGroup.add(earth, atmo); scene.add(earthGroup);
    const earthLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: 0x0e7490, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.6 }));
    scene.add(earthLine);

    // Site markers
    const markers = new THREE.Group(); scene.add(markers);
    const selectedRing = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.045, 32), new THREE.MeshBasicMaterial({ color: 0xe09a2b, side: THREE.DoubleSide }));
    scene.add(selectedRing);
    const subsolarDot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 16), new THREE.MeshBasicMaterial({ color: 0xe09a2b }));
    scene.add(subsolarDot);
    const subearthDot = new THREE.Mesh(new THREE.SphereGeometry(0.016, 16, 16), new THREE.MeshBasicMaterial({ color: 0x0e7490 }));
    scene.add(subearthDot);

    // Terminator great-circle (perpendicular to sun)
    const termPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 128; i++) { const a = (i / 128) * Math.PI * 2; termPts.push(new THREE.Vector3(Math.cos(a) * 1.003, Math.sin(a) * 1.003, 0)); }
    const terminator = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(termPts), new THREE.LineBasicMaterial({ color: 0xe09a2b, transparent: true, opacity: 0.55 }));
    scene.add(terminator);

    // Graticule
    const gratPts: THREE.Vector3[] = [];
    for (let lat = -60; lat <= 60; lat += 30) for (let i = 0; i < 96; i++) {
      gratPts.push(latLonToVec3(lat, (i / 96) * 360, 1.002), latLonToVec3(lat, ((i + 1) / 96) * 360, 1.002));
    }
    for (let lon = 0; lon < 360; lon += 30) for (let i = 0; i < 48; i++) {
      gratPts.push(latLonToVec3(-90 + (i / 48) * 180, lon, 1.002), latLonToVec3(-90 + ((i + 1) / 48) * 180, lon, 1.002));
    }
    const graticule = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gratPts), new THREE.LineBasicMaterial({ color: 0x8a5a16, transparent: true, opacity: 0.3 }));
    graticule.visible = false; scene.add(graticule);

    // Stars
    const starPos = new Float32Array(1600 * 3);
    for (let i = 0; i < 1600; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 40);
      starPos.set([v.x, v.y, v.z], i * 3);
    }
    const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xf3e6d0, size: 0.35, sizeAttenuation: true, transparent: true, opacity: 0.8 }));
    scene.add(stars);

    const t: Three = { renderer, scene, camera, controls, sun, sunGlow, earthGroup, earthLine, markers, selectedRing, subsolarDot, subearthDot, terminator, graticule, stars, raf: 0, lastEphem: 0, sunDir: new THREE.Vector3(1, 0, 0), earthDir: new THREE.Vector3(1, 0, 0) };
    threeRef.current = t;

    const resize = () => { const w = mount.clientWidth, h = mount.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(mount);

    // click to select a site marker
    const ray = new THREE.Raycaster(); const ptr = new THREE.Vector2();
    const onClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ptr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1; ptr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(ptr, camera);
      const hits = ray.intersectObjects(markers.children, false);
      if (hits[0]?.object.userData.siteId) onSelect(hits[0].object.userData.siteId as string);
    };
    renderer.domElement.addEventListener('click', onClick);

    let last = performance.now();
    const loop = (now: number) => {
      t.raf = requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, 0.1); last = now;
      const tg = togglesRef.current;
      if (playingRef.current) {
        simTimeRef.current += dt * SPEEDS[speedRef.current] * HOUR_MS;
        if (simTimeRef.current > anchorRef.current + SYNODIC_H * HOUR_MS) simTimeRef.current = anchorRef.current;
      }
      const tt = simTimeRef.current;
      // ephemeris (throttle to ~30 Hz)
      if (now - t.lastEphem > 33) {
        t.lastEphem = now;
        const e = computeEphemeris(siteRef.current, tt);
        t.sunDir = latLonToVec3(e.subsolarLatitudeDeg, e.subsolarLongitudeDeg, 1);
        t.earthDir = latLonToVec3(e.libration.subEarthLatitudeDeg, e.libration.subEarthLongitudeDeg, 1);
        setHud({ lat: e.subsolarLatitudeDeg, lon: e.subsolarLongitudeDeg, eLat: e.libration.subEarthLatitudeDeg, eLon: e.libration.subEarthLongitudeDeg });
      }
      t.sun.position.copy(t.sunDir).multiplyScalar(10); t.sun.target.position.set(0, 0, 0);
      t.sunGlow.position.copy(t.sunDir).multiplyScalar(8);
      t.subsolarDot.position.copy(t.sunDir).multiplyScalar(1.015);
      t.subearthDot.position.copy(t.earthDir).multiplyScalar(1.015);
      t.earthGroup.position.copy(t.earthDir).multiplyScalar(5.5);
      t.earthGroup.rotation.y += dt * 0.05;
      const linePos = t.earthLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      linePos.setXYZ(0, 0, 0, 0); linePos.setXYZ(1, t.earthGroup.position.x, t.earthGroup.position.y, t.earthGroup.position.z); linePos.needsUpdate = true;
      t.earthLine.computeLineDistances();
      t.terminator.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t.sunDir);
      t.markers.visible = tg.sites; t.selectedRing.visible = tg.sites; t.terminator.visible = tg.terminator;
      t.earthGroup.visible = tg.earth; t.earthLine.visible = tg.earth; t.stars.visible = tg.stars; t.graticule.visible = tg.graticule;
      t.subsolarDot.visible = tg.sites; t.subearthDot.visible = tg.earth;

      // selected ring on surface
      const sp = latLonToVec3(siteRef.current.latitude, siteRef.current.longitude, 1.012);
      t.selectedRing.position.copy(sp); t.selectedRing.lookAt(0, 0, 0);

      controls.update();
      renderer.render(scene, camera);

      // project labels
      const project = (v: THREE.Vector3, el: HTMLDivElement | null, visible: boolean) => {
        if (!el) return;
        const p = v.clone().project(camera);
        const behind = p.z > 1;
        if (!visible || behind) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        el.style.left = `${(p.x * 0.5 + 0.5) * mount.clientWidth}px`;
        el.style.top = `${(-p.y * 0.5 + 0.5) * mount.clientHeight}px`;
      };
      project(sp, labelsRef.current.site, tg.sites);
      project(t.subsolarDot.position, labelsRef.current.subsolar, tg.sites);
      project(t.earthGroup.position, labelsRef.current.earth, tg.earth);

      window.__CHANDRA_PLANET__ = {
        timeMs: tt, playing: playingRef.current, speedHrsPerSec: SPEEDS[speedRef.current],
        subsolar: [hudRef.current.lat, hudRef.current.lon], subearth: [hudRef.current.eLat, hudRef.current.eLon],
        sunDir: t.sunDir.toArray() as [number, number, number], sites: markers.children.length, camera: camera.position.toArray(),
      };
    };
    t.raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(t.raf); ro.disconnect();
      renderer.domElement.removeEventListener('click', onClick);
      moonTex.dispose(); earthTex.dispose();
      scene.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); const mat = m.material as THREE.Material | THREE.Material[] | undefined; if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else if (mat) mat.dispose(); });
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      threeRef.current = null; delete window.__CHANDRA_PLANET__;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // rebuild markers when sites change
  useEffect(() => {
    const t = threeRef.current; if (!t) return;
    t.markers.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); const mat = m.material as THREE.Material | undefined; if (mat) mat.dispose(); });
    t.markers.clear();
    for (const s of sites) {
      const p = latLonToVec3(s.latitude, s.longitude, 1.012);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(s.id === selectedId ? 0.02 : 0.012, 12, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(s.accent) }));
      dot.position.copy(p); dot.userData.siteId = s.id;
      t.markers.add(dot);
    }
  }, [sites, selectedId]);

  // sync sim time to the global clock while playing (throttled)
  useEffect(() => {
    const id = window.setInterval(() => { if (playingRef.current) onTime(simTimeRef.current); }, 160);
    return () => window.clearInterval(id);
  }, [onTime]);

  const togglePlay = () => { if (!playing) anchorRef.current = simTimeRef.current; setPlaying((p) => !p); };
  const preset = (kind: 'nearside' | 'south' | 'subsolar' | 'earth') => {
    const t = threeRef.current; if (!t) return;
    if (kind === 'nearside') t.camera.position.set(3.2, 0.7, 0.9);
    else if (kind === 'south') t.camera.position.set(0.01, -3.3, 0.01);
    else if (kind === 'subsolar') t.camera.position.copy(t.sunDir).multiplyScalar(3.4);
    else t.camera.position.copy(t.earthDir).multiplyScalar(3.4);
    t.controls.target.set(0, 0, 0); t.controls.update();
  };
  const setToggle = (k: keyof typeof toggles) => setToggles((s) => ({ ...s, [k]: !s[k] }));

  const scrubH = Math.max(0, Math.min(SYNODIC_H, (simTimeRef.current - anchorRef.current) / HOUR_MS));

  return (
    <section className="panel planet-view" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="panel-header">
        <span className="panel-title"><Globe2 size={13} /> Planet viewer · time-lapse</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={() => preset('nearside')}>Near side</button>
          <button className="btn sm" onClick={() => preset('south')}>South pole</button>
          <button className="btn sm" onClick={() => preset('subsolar')}>Sub-solar</button>
          <button className="btn sm" onClick={() => preset('earth')}>Earth view</button>
        </div>
      </div>
      <div className="planet-stage">
        <div ref={mountRef} className="planet-viewport" />
        {webglError && <div role="alert" className="terrain-loading">{webglError}</div>}
        <div ref={(el) => { labelsRef.current.site = el; }} className="planet-label site">{selectedSite.name}</div>
        <div ref={(el) => { labelsRef.current.subsolar = el; }} className="planet-label solar">SUB-SOLAR</div>
        <div ref={(el) => { labelsRef.current.earth = el; }} className="planet-label earth">EARTH · direction only</div>

        <div className="planet-hud-top">
          <span className="stamp brass">BODY-FIXED MOON · REAL EPHEMERIS</span>
          <span className="hint" style={{ color: '#cbb894' }}>{mode === 'educator' ? 'Watch the terminator sweep as the lunation advances. Sizes & distances are not to scale.' : 'SUN & EARTH FROM DE421 + IAU MOON · NOT TO SCALE'}</span>
        </div>
        <div className="planet-toggles">
          <button className={`btn sm icon ${toggles.sites ? 'active' : ''}`} title="Site markers" onClick={() => setToggle('sites')}><CircleDot size={13} /></button>
          <button className={`btn sm icon ${toggles.terminator ? 'active' : ''}`} title="Terminator" onClick={() => setToggle('terminator')}><Sun size={13} /></button>
          <button className={`btn sm icon ${toggles.earth ? 'active' : ''}`} title="Earth direction" onClick={() => setToggle('earth')}><Earth size={13} /></button>
          <button className={`btn sm icon ${toggles.stars ? 'active' : ''}`} title="Stars" onClick={() => setToggle('stars')}><Sparkles size={13} /></button>
          <button className={`btn sm icon ${toggles.graticule ? 'active' : ''}`} title="Graticule" onClick={() => setToggle('graticule')}><Grid3x3 size={13} /></button>
        </div>
      </div>

      <div className="timelapse-bar">
        <button className={`btn ${playing ? 'active' : ''}`} onClick={togglePlay} style={{ flex: '0 0 auto' }}>{playing ? <Pause size={13} /> : <Play size={13} />} {playing ? 'Pause' : 'Time-lapse'}</button>
        <select className="btn sm" value={speedIdx} onChange={(e) => setSpeedIdx(Number(e.target.value))} style={{ flex: '0 0 auto' }} aria-label="Time-lapse speed">
          {SPEED_LABELS.map((l, i) => <option key={l} value={i}>{l}</option>)}
        </select>
        <input type="range" min={0} max={SYNODIC_H} step={1} value={scrubH} aria-label="Lunation scrub"
          onChange={(e) => { setPlaying(false); const t = anchorRef.current + Number(e.target.value) * HOUR_MS; simTimeRef.current = t; onTime(t); }} />
        <div className="timelapse-read mono">
          <span>{formatUTC(timeMs)}</span>
          <span className="brass-text">MJD {mjd(timeMs).toFixed(3)}</span>
          <span>☉ {hud.lat.toFixed(1)}° {hud.lon.toFixed(1)}°</span>
          <span>⊕ {hud.eLat.toFixed(1)}° {hud.eLon.toFixed(1)}°</span>
        </div>
      </div>
      {mode === 'educator' && (
        <div className="planet-caption">The Moon is shown body-fixed: the surface stays put while the Sun direction moves, so the bright/dark terminator sweeps across the pole once every ~29.5 days. The amber dot is the sub-solar point; the teal dot and dashed line show where Earth sits in the lunar sky. A polar site survives by catching low, grazing sunlight between long nights.</div>
      )}
    </section>
  );
}
