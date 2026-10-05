import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createTerrain, disposeTerrain, setExaggeration, createAnnotations, disposeAnnotations, interpolateSample } from '/frontend/terrain.js';
import { sampleLonLat } from '/frontend/coordinates.js';
import { LightingController } from '/frontend/lighting.js';

const $ = id => document.getElementById(id);
const viewport = $('viewport');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
} catch {
  $('error-panel').textContent = 'This browser could not start WebGL. Enable browser hardware acceleration and reopen the prototype.';
  $('error-panel').hidden = false;
  $('build').disabled = true;
  throw new Error('WebGL initialization failed.');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setClearColor(0x090c11);
viewport.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(43, 1, 0.01, 500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.maxPolarAngle = Math.PI * 0.495;
const lighting = new LightingController(scene, renderer);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let terrain = null;
let annotations = null;
let data = null;
let pinned = false;
let pendingInspection = false;
let framePending = false;
let pointerDown = null;
let lastPick = 0;

function requestRender() {
  if (!framePending) {
    framePending = true;
    requestAnimationFrame(render);
  }
}

function render() {
  framePending = false;
  const controlsChanged = controls.update();
  camera.updateMatrixWorld();
  if (pendingInspection && terrain && !pinned) {
    pendingInspection = false;
    inspectTerrain();
  }
  if (data) {
    const tagPosition = new THREE.Vector3(0, 0, 0).project(camera);
    const visible = tagPosition.z >= -1 && tagPosition.z <= 1
      && Math.abs(tagPosition.x) <= 1 && Math.abs(tagPosition.y) <= 1;
    $('site-tag').hidden = !visible;
    $('site-tag').style.left = `${(tagPosition.x + 1) * 0.5 * viewport.clientWidth}px`;
    $('site-tag').style.top = `${(1 - tagPosition.y) * 0.5 * viewport.clientHeight}px`;
  }
  renderer.render(scene, camera);
  if (controlsChanged) requestRender();
}

controls.addEventListener('change', requestRender);
new ResizeObserver(() => {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  requestRender();
}).observe(viewport);

function recenter() {
  if (!data) return;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = true;
  const radius = data.radius_km;
  const relief = data.statistics.range_m / 1000 * Number($('exaggeration').value);
  const distance = Math.max(radius, relief * 0.75);
  camera.position.set(distance * 1.35, distance * 1.25, distance * 1.75);
  controls.target.set(0, 0, 0);
  controls.minDistance = radius * 0.03;
  controls.maxDistance = Math.max(radius * 12, relief * 4);
  controls.update();
  requestRender();
}
$('recenter').addEventListener('click', recenter);

function refreshAnnotations() {
  if (annotations) {
    scene.remove(annotations);
    disposeAnnotations(annotations);
  }
  annotations = createAnnotations(data, Number($('exaggeration').value));
  scene.add(annotations);
}

function applyExaggeration() {
  const factor = Number($('exaggeration').value);
  $('exaggeration-value').textContent = `${factor}×`;
  $('scale-note').textContent = factor === 1
    ? 'True vertical scale · curvature included'
    : `${factor}× relief · elevations remain unchanged`;
  $('scale-note').dataset.active = factor > 1;
  if (terrain) {
    setExaggeration(terrain, factor);
    refreshAnnotations();
    updateLighting();
  }
  requestRender();
}
$('exaggeration').addEventListener('input', applyExaggeration);
$('radius').addEventListener('input', () => {
  $('radius-value').textContent = `${Number($('radius').value).toFixed(1).replace(/\.0$/, '')} km`;
});

function updateLighting() {
  const azimuthDeg = Number($('azimuth').value);
  const elevationDeg = Number($('elevation').value);
  $('azimuth-value').textContent = `${azimuthDeg}°`;
  $('elevation-value').textContent = `${elevationDeg}°`;
  if (terrain) lighting.update(terrain, data, { azimuthDeg, elevationDeg }, $('shadows').checked);
  requestRender();
}
for (const id of ['azimuth', 'elevation', 'shadows']) $(id).addEventListener('input', updateLighting);

function showPoint(hit) {
  const sample = interpolateSample(hit);
  const coordinate = sampleLonLat(sample.east_m, sample.north_m, data);
  $('inspect-east').textContent = `${sample.east_m.toFixed(1)} m`;
  $('inspect-north').textContent = `${sample.north_m.toFixed(1)} m`;
  $('inspect-height').textContent = `${sample.elevation_m.toFixed(1)} m`;
  $('inspect-distance').textContent = `${(sample.distance_m / 1000).toFixed(3)} km`;
  $('inspect-lat').textContent = `LAT ${coordinate.latitude.toFixed(5)}°`;
  $('inspect-lon').textContent = `LON ${coordinate.longitude.toFixed(5)}° E`;
}

function inspectTerrain() {
  if (!terrain) return;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(terrain, false)[0];
  if (!hit) return;
  showPoint(hit);
}

renderer.domElement.addEventListener('pointermove', event => {
  if (!terrain || event.buttons || pinned || performance.now() - lastPick < 80) return;
  lastPick = performance.now();
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1);
  pendingInspection = true;
  requestRender();
});
renderer.domElement.addEventListener('pointerdown', event => {
  pointerDown = [event.clientX, event.clientY];
});
renderer.domElement.addEventListener('click', event => {
  if (pointerDown && Math.hypot(event.clientX - pointerDown[0], event.clientY - pointerDown[1]) > 5) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = terrain && raycaster.intersectObject(terrain, false)[0];
  if (hit) {
    pinned = !pinned;
    $('pin-state').textContent = pinned ? 'PINNED · CLICK TO RELEASE' : 'HOVER / CLICK TO PIN';
    showPoint(hit);
  } else {
    pinned = false;
    $('pin-state').textContent = 'HOVER / CLICK TO PIN';
  }
});

function updateReadout(result) {
  const stats = result.statistics;
  $('read-lat').textContent = `${result.latitude.toFixed(3)}°`;
  $('read-lon').textContent = `${result.longitude.toFixed(3)}° E`;
  $('read-landing').textContent = result.landing_elevation_m.toFixed(1);
  $('read-min').textContent = `${stats.minimum_m.toFixed(1)} m`;
  $('read-max').textContent = `${stats.maximum_m.toFixed(1)} m`;
  $('read-range').textContent = `${stats.range_m.toFixed(1)} m`;
  $('coverage').textContent = `${stats.coverage_percent.toFixed(1)}% COVERAGE`;
  const span = Math.max(Math.abs(stats.minimum_m), Math.abs(stats.maximum_m), 1);
  $('range-marker').style.left = `${(stats.maximum_m - result.landing_elevation_m) / Math.max(stats.range_m, 1) * 100}%`;
  $('range-fill').style.background = `linear-gradient(90deg,#73818e,${stats.coverage_percent < 100 ? '#c89e62' : '#bbefce'})`;
  $('model-state').innerHTML = '<i></i>MODEL READY';
  $('model-state').dataset.loaded = 'true';
  $('source-badge').textContent = result.synthetic ? 'SYNTHETIC DEMO' : 'LOLA / REAL DEM';
  $('source-badge').dataset.synthetic = result.synthetic ? 'true' : 'false';
  $('source-badge').dataset.real = result.synthetic ? 'false' : 'true';
  $('source-name').textContent = result.source.filename;
  $('source-description').textContent = `${(result.source.lunar_radius_m / 1000).toFixed(3)} km CRS sphere · ${result.source.lunar_reference_frame || 'Demo frame'} · ${result.source.elevation_reference}`;
  $('scene-note').textContent = `${result.radius_km} km analysis radius · ${result.grid.size} × ${result.grid.size} terrain grid · ${stats.coverage_percent}% valid coverage`;
  $('site-title').textContent = `${result.latitude.toFixed(2)}° / ${result.longitude.toFixed(2)}° E`;
  if (result.synthetic) {
    $('synthetic-alert').hidden = false;
    $('synthetic-alert').textContent = result.source.warning || 'SYNTHETIC TERRAIN — NOT REAL LUNAR DATA';
  } else {
    $('synthetic-alert').hidden = true;
  }
}

async function buildTerrain() {
  $('error-panel').hidden = true;
  $('viewport-loading').hidden = false;
  $('build').disabled = true;
  $('model-state').innerHTML = '<i></i>BUILDING MODEL';
  $('model-state').dataset.loaded = 'false';
  try {
    const response = await fetch('/api/terrain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latitude: Number($('latitude').value),
        longitude: Number($('longitude').value),
        radius_km: Number($('radius').value),
        quality: $('quality').value,
        mode: $('mode').value,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Terrain extraction failed.');

    const nextTerrain = createTerrain(result);
    if (terrain) {
      scene.remove(terrain);
      disposeTerrain(terrain);
    }
    terrain = nextTerrain;
    data = result;
    scene.add(terrain);
    setExaggeration(terrain, Number($('exaggeration').value));
    refreshAnnotations();
    $('viewport-empty').hidden = true;
    $('recenter').hidden = false;
    pinned = false;
    $('pin-state').textContent = 'HOVER / CLICK TO PIN';
    $('inspect-east').textContent = '—';
    $('inspect-north').textContent = '—';
    $('inspect-height').textContent = '—';
    $('inspect-distance').textContent = '—';
    $('inspect-lat').textContent = 'Hover over the terrain to read a point.';
    $('inspect-lon').textContent = '';
    updateReadout(result);
    recenter();
    updateLighting();
  } catch (error) {
    $('error-panel').textContent = error.message;
    $('error-panel').hidden = false;
    $('model-state').innerHTML = '<i></i>MODEL UNAVAILABLE';
    $('model-state').dataset.loaded = 'false';
  } finally {
    $('viewport-loading').hidden = true;
    $('build').disabled = false;
  }
}
$('build').addEventListener('click', buildTerrain);

try {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error('The local terrain backend is not available.');
  const config = await response.json();
  $('mode').value = config.dem_ready ? 'real' : 'synthetic';
  $('dem-status').textContent = config.dem_ready ? config.source.filename : config.dem_error;
  $('source-badge').textContent = config.dem_ready ? 'LOCAL DEM READY' : 'DEMO MODE AVAILABLE';
  $('source-badge').dataset.real = String(config.dem_ready);
  $('source-name').textContent = config.dem_ready ? config.source.filename : 'No real DEM configured';
  $('source-description').textContent = config.dem_ready
    ? `${(config.source.lunar_radius_m / 1000).toFixed(3)} km CRS sphere · ${config.source.lunar_reference_frame}`
    : config.dem_error;
  await buildTerrain();
} catch (error) {
  $('error-panel').textContent = error.message;
  $('error-panel').hidden = false;
  $('viewport-empty').querySelector('strong').textContent = 'Local backend unavailable';
}
