import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createTerrain, disposeTerrain, setExaggeration, createAnnotations, disposeAnnotations, interpolateSample } from './terrain.js';
import { sampleLonLat } from './coordinates.js';
import { LightingController } from './lighting.js';

const $ = id => document.getElementById(id);
const viewport = $('viewport');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
} catch (error) {
  $('error').textContent = 'WebGL is unavailable. Enable hardware acceleration or use a browser with WebGL support.';
  $('error').hidden = false;
  $('generate').disabled = true;
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setClearColor(0x080c10);
viewport.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
camera.position.set(9, 7, 11);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
const lighting = new LightingController(scene, renderer);
let mesh = null, annotations = null, terrainData = null;
let pinned = false, inspectPending = false, framePending = false;
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();

function requestRender() {
  if (!framePending) { framePending = true; requestAnimationFrame(render); }
}
function render() {
  framePending = false;
  const changed = controls.update();
  camera.updateMatrixWorld();
  if (inspectPending && mesh && !pinned) { inspectPending = false; inspectTerrain(); }
  if (terrainData) {
    const p = new THREE.Vector3(0, 0, 0).project(camera);
    $('landing-label').hidden = p.z < -1 || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1;
    $('landing-label').style.left = `${(p.x + 1) / 2 * viewport.clientWidth}px`;
    $('landing-label').style.top = `${(1 - p.y) / 2 * viewport.clientHeight}px`;
  }
  renderer.render(scene, camera);
  if (changed) requestRender();
}
controls.addEventListener('change', requestRender);
new ResizeObserver(() => {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  requestRender();
}).observe(viewport);

function resetCamera() {
  if (!terrainData) return;
  // Consume pending OrbitControls damping before restoring the requested view.
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = true;
  const r = terrainData.radius_km;
  const relief = terrainData.statistics.range_m / 1000 * Number($('exaggeration').value);
  const distance = Math.max(r, relief * 0.75);
  camera.position.set(distance * 1.35, distance * 1.25, distance * 1.75);
  controls.target.set(0, 0, 0);
  controls.minDistance = r * 0.03;
  controls.maxDistance = Math.max(r * 12, relief * 4);
  controls.update();
  requestRender();
}
$('reset-view').addEventListener('click', resetCamera);

function rebuildAnnotations() {
  if (annotations) { scene.remove(annotations); disposeAnnotations(annotations); }
  annotations = createAnnotations(terrainData, Number($('exaggeration').value));
  scene.add(annotations);
}
function updateScale() {
  const factor = Number($('exaggeration').value);
  $('exaggeration-value').textContent = `${factor}×`;
  $('exaggeration-note').textContent = factor === 1 ? 'True vertical scale. Lunar curvature included.' : `${factor}× relief exaggeration. Lighting and shadows use this displayed geometry.`;
  $('exaggeration-note').dataset.active = factor > 1;
  if (mesh) { setExaggeration(mesh, factor); rebuildAnnotations(); updateViewMetadata(); updateLighting(); }
  requestRender();
}
$('exaggeration').addEventListener('input', updateScale);

function updateLighting() {
  const azimuthDeg = Number($('sun-azimuth').value);
  const elevationDeg = Number($('sun-elevation').value);
  $('sun-azimuth-value').textContent = `${azimuthDeg}°`;
  $('sun-elevation-value').textContent = `${elevationDeg}°`;
  $('sun-note').textContent = `${elevationDeg < 0 ? 'Sun is below the landing site’s tangent horizon.\n' : ''}Azimuth clockwise from local north. Local geometry only; terrain outside the crop can cast additional shadows.`;
  if (mesh) lighting.update(mesh, terrainData, { azimuthDeg, elevationDeg }, $('shadows').checked);
  requestRender();
}
for (const id of ['sun-azimuth', 'sun-elevation', 'shadows']) $(id).addEventListener('input', updateLighting);

function updateViewMetadata() {
  $('view-metadata').textContent = `Analysis radius: ${terrainData.radius_km} km\nVertical scale: ${$('exaggeration').value}× · Plan X=east / Y=north\nCoverage: ${terrainData.statistics.coverage_percent}%`;
  $('view-metadata').style.top = terrainData.synthetic ? '62px' : '18px';
  $('view-metadata').hidden = false;
}

function locatePointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
}
function inspectTerrain() {
  if (!mesh) return;
  camera.updateMatrixWorld();
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(mesh, false)[0];
  if (!hit) {
    $('inspection-text').textContent = 'Hover on terrain · click to pin a sample.';
    return;
  }
  const sample = interpolateSample(hit);
  const coordinate = sampleLonLat(sample.east_m, sample.north_m, terrainData);
  $('inspection-text').textContent = `${pinned ? 'PINNED · click to release\n' : ''}X / east  ${sample.east_m.toFixed(1)} m\nY / north ${sample.north_m.toFixed(1)} m\nElevation ${sample.elevation_m.toFixed(1)} m\nDistance  ${(sample.distance_m / 1000).toFixed(3)} km\nLat ${coordinate.latitude.toFixed(5)}°\nLon ${coordinate.longitude.toFixed(5)}° E`;
}
let lastInspectionTime = 0, down = null;
renderer.domElement.addEventListener('pointermove', event => {
  if (pinned || event.buttons || performance.now() - lastInspectionTime < 80) return;
  lastInspectionTime = performance.now();
  locatePointer(event);
  inspectPending = true;
  requestRender();
});
renderer.domElement.addEventListener('pointerdown', event => { down = [event.clientX, event.clientY]; });
renderer.domElement.addEventListener('click', event => {
  if (down && Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return;
  locatePointer(event);
  pinned = !pinned;
  inspectTerrain();
  requestRender();
});
renderer.domElement.addEventListener('pointerleave', () => {
  if (!pinned) $('inspection-text').textContent = 'Hover on terrain · click to pin a sample.';
});

async function generate(event) {
  event?.preventDefault();
  $('error').hidden = true;
  $('loading').hidden = false;
  $('generate').disabled = true;
  try {
    const response = await fetch('/api/terrain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      latitude: Number($('latitude').value), longitude: Number($('longitude').value),
      radius_km: Number($('radius').value), quality: $('quality').value, mode: $('mode').value,
    }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Terrain extraction failed.');
    const next = createTerrain(data);
    if (mesh) { scene.remove(mesh); disposeTerrain(mesh); }
    mesh = next;
    terrainData = data;
    scene.add(mesh);
    setExaggeration(mesh, Number($('exaggeration').value));
    rebuildAnnotations();
    resetCamera();
    pinned = false;
    $('inspection-text').textContent = 'Hover on terrain · click to pin a sample.';
    $('empty').hidden = true;
    $('source-banner').hidden = !data.synthetic;
    $('source-banner').textContent = 'SYNTHETIC TERRAIN — NOT REAL LUNAR DATA';
    $('render-status').textContent = data.synthetic ? 'Synthetic demo' : 'Real DEM';
    $('view-title').textContent = `${data.latitude.toFixed(2)}° · ${data.longitude.toFixed(2)}° E`;
    $('reset-view').hidden = false;
    const values = [data.landing_elevation_m, data.statistics.minimum_m, data.statistics.maximum_m, data.statistics.range_m];
    const strongs = $('stats').querySelectorAll('strong');
    values.forEach((v, i) => { strongs[i].textContent = `${v.toFixed(1)} m`; });
    strongs[4].textContent = `${data.radius_km} km`;
    strongs[5].textContent = `${data.grid.size} × ${data.grid.size}`;
    $('data-details').textContent = `${data.source.filename} · ${data.grid.spacing_m.toFixed(1)} m display spacing · Datum: ${data.source.elevation_reference} · CRS sphere: ${(data.source.lunar_radius_m / 1000).toFixed(3)} km · Frame: ${data.source.lunar_reference_frame || 'Artificial demo'}. Statistics use the resampled disk; missing samples remain gaps.`;
    updateViewMetadata();
    updateLighting();
    requestRender();
  } catch (error) {
    $('error').textContent = error.message;
    $('error').hidden = false;
  } finally {
    $('loading').hidden = true;
    $('generate').disabled = false;
  }
}
$('terrain-form').addEventListener('submit', generate);
try {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error('Cannot read backend configuration.');
  const config = await response.json();
  $('mode').value = config.dem_ready ? 'real' : 'synthetic';
  $('source-status').textContent = config.dem_ready ? config.source.filename : config.dem_error;
  await generate();
} catch (error) { $('error').textContent = error.message; $('error').hidden = false; }

// Read-only diagnostics for integration checks; contains no filesystem paths.
export function getDiagnostics() {
  const n = terrainData?.grid.size;
  const center = n ? Math.floor(n / 2) * n + Math.floor(n / 2) : 0;
  return { mode: terrainData?.synthetic ? 'synthetic' : 'real', gridSize: n,
    triangles: mesh ? mesh.geometry.index.count / 3 : 0,
    landingPosition: mesh ? Array.from(mesh.geometry.attributes.position.array.slice(center * 3, center * 3 + 3)) : null,
    landingElevation: terrainData?.landing_elevation_m,
    exaggeration: Number($('exaggeration').value),
    camera: camera.position.toArray(), calls: renderer.info.render.calls,
    shadows: renderer.shadowMap.enabled, sun: lighting.position,
    sunDirection: lighting.position ? lighting.sun.position.clone().sub(lighting.sun.target.position).normalize().toArray() : null,
    shadowMapSize: lighting.sun.shadow.mapSize.toArray(),
  };
}
