import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Rocket, RotateCcw, Layers, Flame, Move3d, Camera, Info } from 'lucide-react';
import type { AppMode } from '../types/mission';
import { buildVehicle, disposeVehicle, VEHICLE_SPECS, type BuiltVehicle, type VehicleId, type VehiclePart } from '../three/vehicles';

declare global {
  interface Window {
    __CHANDRA_FLEET__?: {
      vehicle: string; parts: number; separation: number; plume: boolean;
      camera: number[]; autoRotate: boolean; hovered: string | null;
    };
  }
}

interface Props { mode: AppMode; }

interface Three {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  controls: OrbitControls; vehicleRoot: THREE.Group; plumes: THREE.Group;
  hoverBox: THREE.BoxHelper; raycaster: THREE.Raycaster; pointer: THREE.Vector2;
  built: BuiltVehicle | null; raf: number; clock: THREE.Clock;
}

export function FleetViewer({ mode }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const threeRef = useRef<Three | null>(null);
  const [vehicleId, setVehicleId] = useState<VehicleId>('starship-stack');
  const [separation, setSeparation] = useState(0);
  const [plume, setPlume] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [hovered, setHovered] = useState<{ name: string; role: string; x: number; y: number } | null>(null);
  const [builtParts, setBuiltParts] = useState<VehiclePart[]>([]);
  const [webglError, setWebglError] = useState<string | null>(null);
  const stateRef = useRef({ separation, plume, autoRotate });
  stateRef.current = { separation, plume, autoRotate };
  const hoveredNameRef = useRef<string | null>(null);
  hoveredNameRef.current = hovered?.name ?? null;

  const spec = VEHICLE_SPECS.find((s) => s.id === vehicleId)!;
  const isStack = vehicleId === 'starship-stack';

  // ---- scene bootstrap ----
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setWebglError('WebGL is unavailable in this browser.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x12100c);
    scene.fog = new THREE.Fog(0x12100c, 40, 90);

    // Image-based lighting so stainless steel reads as bright, reflective metal.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const envRT = pmrem.fromScene(room, 0.04);
    room.dispose();
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.55;

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
    camera.position.set(16, 10, 20);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 5;
    controls.maxDistance = 70;
    controls.maxPolarAngle = Math.PI * 0.52;
    controls.autoRotateSpeed = 1.1;

    // Studio lighting: warm key, cool rim, soft fill.
    scene.add(new THREE.HemisphereLight(0xf3e6d0, 0x1a1712, 0.55));
    const key = new THREE.DirectionalLight(0xfff2dc, 2.2); key.position.set(12, 18, 10); scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fb4d6, 1.1); rim.position.set(-14, 8, -12); scene.add(rim);
    const fill = new THREE.DirectionalLight(0xe09a2b, 0.5); fill.position.set(0, 4, 16); scene.add(fill);

    // Floor + pad grid
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(40, 64),
      new THREE.MeshStandardMaterial({ color: 0x171410, metalness: 0.1, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; scene.add(floor);
    const grid = new THREE.GridHelper(60, 60, 0x8a5a16, 0x2c2620);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    scene.add(grid);
    const pad = new THREE.Mesh(new THREE.RingGeometry(3.4, 3.7, 48), new THREE.MeshBasicMaterial({ color: 0xe09a2b, side: THREE.DoubleSide }));
    pad.rotation.x = -Math.PI / 2; pad.position.y = 0.01; scene.add(pad);

    const vehicleRoot = new THREE.Group(); scene.add(vehicleRoot);
    const plumes = new THREE.Group(); scene.add(plumes);
    const hoverBox = new THREE.BoxHelper(new THREE.Object3D(), 0xe09a2b);
    hoverBox.visible = false; scene.add(hoverBox);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(-2, -2);

    const t: Three = { renderer, scene, camera, controls, vehicleRoot, plumes, hoverBox, raycaster, pointer, built: null, raf: 0, clock: new THREE.Clock() };
    threeRef.current = t;

    const resize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(mount);

    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const built = t.built;
      if (!built) return;
      const hits = raycaster.intersectObject(built.group, true);
      const hit = hits.find((h) => h.object.userData.partName);
      if (hit) {
        const name = hit.object.userData.partName as string;
        const part = built.parts.find((p) => p.name === name);
        if (part) {
          hoverBox.setFromObject(part.object); hoverBox.visible = true;
          setHovered({ name, role: part.role, x: e.clientX - rect.left, y: e.clientY - rect.top });
          return;
        }
      }
      hoverBox.visible = false; setHovered(null);
    };
    const onLeave = () => { hoverBox.visible = false; setHovered(null); };
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);

    const loop = () => {
      t.raf = requestAnimationFrame(loop);
      const dt = t.clock.getDelta();
      const st = stateRef.current;
      controls.autoRotate = st.autoRotate;
      controls.update();
      // separation
      if (t.built?.upperStage) {
        const baseY = (t.built.upperStage.userData.baseY as number) ?? t.built.upperStage.position.y;
        t.built.upperStage.position.y = baseY + st.separation * 5;
        t.built.upperStage.rotation.z = st.separation * 0.06;
      }
      // plumes
      plumes.visible = st.plume;
      if (st.plume) {
        const flick = 0.85 + Math.sin(performance.now() * 0.03) * 0.15 + Math.random() * 0.05;
        plumes.children.forEach((c) => { c.scale.set(1, flick, 1); });
      }
      if (hoverBox.visible && t.built) hoverBox.update();
      renderer.render(scene, camera);
      window.__CHANDRA_FLEET__ = {
        vehicle: t.built?.spec.id ?? '', parts: t.built?.parts.length ?? 0,
        separation: st.separation, plume: st.plume,
        camera: camera.position.toArray(), autoRotate: st.autoRotate,
        hovered: hoverBox.visible ? (hoveredNameRef.current) : null,
      };
      void dt;
    };
    loop();

    return () => {
      cancelAnimationFrame(t.raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      if (t.built) disposeVehicle(t.built);
      plumes.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
      envRT.dispose(); pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      threeRef.current = null;
      delete window.__CHANDRA_FLEET__;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- (re)build vehicle ----
  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;
    if (t.built) { t.vehicleRoot.remove(t.built.group); disposeVehicle(t.built); }
    t.plumes.clear();
    const built = buildVehicle(vehicleId);
    // ground the model
    const box = new THREE.Box3().setFromObject(built.group);
    built.group.position.y = -box.min.y;
    if (built.upperStage) built.upperStage.userData.baseY = built.upperStage.position.y;
    t.vehicleRoot.add(built.group);
    t.built = built;
    setBuiltParts(built.parts);

    // plumes
    const plumeMat = new THREE.MeshBasicMaterial({ color: 0x9cc4ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff4d6, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const a of built.plumeAnchors) {
      const g = new THREE.Group();
      const outer = new THREE.Mesh(new THREE.ConeGeometry(0.5 * a.scale, 3.4 * a.scale, 20, 1, true), plumeMat);
      outer.rotation.x = Math.PI; outer.position.y = -1.7 * a.scale;
      const core = new THREE.Mesh(new THREE.ConeGeometry(0.22 * a.scale, 2.2 * a.scale, 16, 1, true), coreMat);
      core.rotation.x = Math.PI; core.position.y = -1.1 * a.scale;
      g.add(outer, core);
      g.position.copy(a.position).add(new THREE.Vector3(0, built.group.position.y, 0));
      t.plumes.add(g);
    }
    t.plumes.visible = stateRef.current.plume;

    // frame camera
    const h = built.height;
    t.camera.position.set(h * 1.15, h * 0.75, h * 1.55);
    t.controls.target.set(0, h * 0.45, 0);
    t.controls.update();
    setSeparation(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  const preset = (kind: 'side' | 'top' | 'detail') => {
    const t = threeRef.current; if (!t || !t.built) return;
    const h = t.built.height;
    if (kind === 'side') t.camera.position.set(h * 1.7, h * 0.5, 0.01);
    else if (kind === 'top') t.camera.position.set(0.01, h * 2.1, 0.01);
    else t.camera.position.set(h * 0.7, h * 0.9, h * 0.9);
    t.controls.target.set(0, h * 0.45, 0);
    t.controls.update();
  };

  return (
    <section className="panel fleet-view" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="panel-header">
        <span className="panel-title"><Rocket size={13} /> Fleet hangar · 3D vehicles</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {VEHICLE_SPECS.map((s) => (
            <button key={s.id} className={`btn sm ${vehicleId === s.id ? 'active' : ''}`} onClick={() => setVehicleId(s.id)}>{s.short}</button>
          ))}
        </div>
      </div>
      <div className="fleet-body">
        <div className="fleet-stage">
          <div ref={mountRef} className="fleet-viewport" />
          {webglError && <div role="alert" className="terrain-loading">{webglError}</div>}
          {hovered && (
            <div className="fleet-tooltip" style={{ left: Math.min(hovered.x + 14, 260), top: hovered.y + 10 }}>
              <strong>{hovered.name}</strong><span>{hovered.role}</span>
            </div>
          )}
          <div className="fleet-hud-top">
            <span className="stamp brass">{spec.short}</span>
            <span className="hint" style={{ color: '#cbb894' }}>{mode === 'educator' ? 'Drag to orbit · scroll to zoom · hover a part' : 'ORBIT / ZOOM · HOVER PARTS FOR CALLOUTS'}</span>
          </div>
          <div className="fleet-view-tools">
            <button className="btn sm" title="Side view" onClick={() => preset('side')}><Camera size={12} /> Side</button>
            <button className="btn sm" title="Top view" onClick={() => preset('top')}><Camera size={12} /> Top</button>
            <button className="btn sm" title="Detail view" onClick={() => preset('detail')}><Move3d size={12} /> Detail</button>
            <button className="btn sm icon" title="Reset turntable" onClick={() => { setAutoRotate(true); preset('detail'); }}><RotateCcw size={12} /></button>
          </div>
        </div>
        <aside className="fleet-controls">
          <div>
            <div className="display" style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.15 }}>{spec.name}</div>
            <p className="small" style={{ marginTop: 6 }}>{mode === 'educator' ? spec.blurb : spec.role}</p>
          </div>

          <div className="fleet-spec">
            {[['Height', `${spec.heightM} m`], ['Diameter', `${spec.diameterM} m`], ['Stages', String(spec.stages)], ['Engines', spec.engines], ['Propellant', spec.propellant]].map(([k, v]) => (
              <div key={k} className="row"><span className="k">{k}</span><span className="v">{v}</span></div>
            ))}
          </div>

          {isStack && (
            <div className="field">
              <label><Layers size={11} style={{ display: 'inline', marginRight: 4 }} />Stage separation · {(separation * 100).toFixed(0)}%</label>
              <input type="range" min={0} max={1} step={0.01} value={separation} onChange={(e) => setSeparation(Number(e.target.value))} />
              <span className="hint">Slide to stage Super Heavy away from the ship.</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className={`btn sm ${plume ? 'active' : ''}`} onClick={() => setPlume((v) => !v)}><Flame size={12} /> {plume ? 'Engines lit' : 'Ignite engines'}</button>
            <button className={`btn sm ${autoRotate ? 'active' : ''}`} onClick={() => setAutoRotate((v) => !v)}><RotateCcw size={12} /> Turntable</button>
          </div>

          <div>
            <div className="panel-title" style={{ marginBottom: 6 }}>Parts · hover in 3D</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {builtParts.map((p) => (
                <div key={p.name} className="fleet-part" style={{ borderColor: hovered?.name === p.name ? 'var(--amber)' : 'var(--line)' }}>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--brass)' }}>{p.name}</span>
                  <span style={{ fontSize: 10, color: 'var(--ink-soft)' }}>{p.role}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="fleet-disclaimer"><Info size={12} /> Stylized massing models for visualization — not engineering CAD. Dimensions are approximate public figures.</div>
        </aside>
      </div>
    </section>
  );
}
