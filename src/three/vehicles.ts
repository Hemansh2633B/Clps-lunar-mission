import * as THREE from 'three';

/**
 * Procedural, stylized launch-vehicle & lander models (KSP / Spaceflight-Simulator
 * flavour). These are recognizable massing models built from primitives — NOT
 * engineering CAD. Real-world dimensions are quoted in the spec panel; the scene
 * uses a convenient display scale (~1 unit ≈ 8.6 m for the Starship stack).
 */

export type VehicleId = 'starship-stack' | 'starship-hls' | 'clps-lander';

export interface VehicleSpec {
  id: VehicleId;
  name: string;
  short: string;
  heightM: number;
  diameterM: number;
  stages: number;
  engines: string;
  propellant: string;
  role: string;
  blurb: string;
}

export interface VehiclePart {
  name: string;
  role: string;
  object: THREE.Object3D;
}

export interface BuiltVehicle {
  spec: VehicleSpec;
  group: THREE.Group;
  parts: VehiclePart[];
  /** Movable upper stage for the separation slider (stack only). */
  upperStage: THREE.Object3D | null;
  booster: THREE.Object3D | null;
  /** Local-space engine exhaust anchors (y points down the exhaust). */
  plumeAnchors: { position: THREE.Vector3; scale: number }[];
  /** Overall display height, for camera framing. */
  height: number;
}

export const VEHICLE_SPECS: VehicleSpec[] = [
  {
    id: 'starship-stack', name: 'Starship · Full Stack', short: 'STARSHIP STACK',
    heightM: 121, diameterM: 9, stages: 2, engines: '33 Raptor (booster) + 6 Raptor (ship)',
    propellant: 'LOX / liquid CH₄', role: 'Super Heavy booster + Starship upper stage',
    blurb: 'The fully stacked launch vehicle. Super Heavy lifts the ship out of the atmosphere; the ship presses on to orbit and, as HLS, carries crew to the lunar surface.',
  },
  {
    id: 'starship-hls', name: 'Starship HLS · Lunar Lander', short: 'STARSHIP HLS',
    heightM: 50, diameterM: 9, stages: 1, engines: '6 Raptor (landing burn subset)',
    propellant: 'LOX / liquid CH₄', role: 'Human Landing System — descent & ascent',
    blurb: 'The lunar variant: no heat shield or aero flaps, a high-mounted docking port, and landing legs. It descends from a near-rectilinear halo orbit to the south pole and returns the crew to orbit.',
  },
  {
    id: 'clps-lander', name: 'CLPS Robotic Lander', short: 'CLPS LANDER',
    heightM: 4.5, diameterM: 3.2, stages: 1, engines: '1 throttleable descent engine',
    propellant: 'Storable bi-propellant', role: 'Robotic south-pole science lander',
    blurb: 'A small Commercial Lunar Payload Services lander of the class this desk plans for: vertical solar masts, a direct-to-Earth dish, and a survival battery sized against the polar night.',
  },
];

const steel = () => new THREE.MeshStandardMaterial({ color: 0xb9bec6, metalness: 0.92, roughness: 0.34 });
const darkSteel = () => new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.8, roughness: 0.5 });
const tile = () => new THREE.MeshStandardMaterial({ color: 0x1c1f24, metalness: 0.2, roughness: 0.85 });
const white = () => new THREE.MeshStandardMaterial({ color: 0xe9eaec, metalness: 0.25, roughness: 0.55 });
const goldFoil = () => new THREE.MeshStandardMaterial({ color: 0xc9a24b, metalness: 0.7, roughness: 0.45 });
const amberPanel = () => new THREE.MeshStandardMaterial({ color: 0x2b3a67, metalness: 0.5, roughness: 0.4, emissive: 0x101a33, emissiveIntensity: 0.4 });
const bell = () => new THREE.MeshStandardMaterial({ color: 0x6a6f77, metalness: 0.95, roughness: 0.3 });

function tag(obj: THREE.Object3D, name: string, role: string, parts: VehiclePart[]) {
  obj.name = name;
  obj.traverse((c) => { c.userData.partName = name; c.userData.partRole = role; });
  parts.push({ name, role, object: obj });
}

function engineCluster(count: number, radius: number, y: number, bellR: number): THREE.Group {
  const g = new THREE.Group();
  const mat = bell();
  const geo = new THREE.CylinderGeometry(bellR * 0.55, bellR, bellR * 1.7, 16, 1, true);
  const rings = count > 12 ? [0, radius * 0.45, radius * 0.82] : count > 4 ? [0, radius * 0.6] : [0];
  let placed = 0;
  for (let r = 0; r < rings.length && placed < count; r++) {
    const ringR = rings[r];
    const n = r === 0 ? (count > 12 ? 3 : 1) : Math.min(count - placed, r === 1 ? (count > 12 ? 10 : count - 1) : count - placed);
    for (let i = 0; i < n && placed < count; i++) {
      const a = (i / n) * Math.PI * 2;
      const m = new THREE.Mesh(geo, mat);
      m.position.set(Math.cos(a) * ringR, y, Math.sin(a) * ringR);
      g.add(m);
      placed++;
    }
  }
  return g;
}

function gridFins(y: number, radius: number): THREE.Group {
  const g = new THREE.Group();
  const mat = darkSteel();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.08), mat);
    fin.position.set(Math.cos(a) * (radius + 0.22), y, Math.sin(a) * (radius + 0.22));
    fin.lookAt(0, y, 0);
    g.add(fin);
  }
  return g;
}

function landingLegs(count: number, bodyR: number, bodyBottom: number, spread: number, len: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.PI / count;
    const top = new THREE.Vector3(Math.cos(a) * bodyR * 0.8, bodyBottom + 0.4, Math.sin(a) * bodyR * 0.8);
    const foot = new THREE.Vector3(Math.cos(a) * spread, bodyBottom - len, Math.sin(a) * spread);
    const dir = foot.clone().sub(top);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, dir.length(), 10), mat);
    strut.position.copy(top.clone().add(foot).multiplyScalar(0.5));
    strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    g.add(strut);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.1, 16), mat);
    pad.position.copy(foot);
    g.add(pad);
  }
  return g;
}

function buildStarshipStack(): BuiltVehicle {
  const parts: VehiclePart[] = [];
  const group = new THREE.Group();
  const R = 0.9;

  // ---- Super Heavy booster ----
  const booster = new THREE.Group();
  const boosterBody = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 7, 48), steel());
  boosterBody.position.y = 3.5;
  booster.add(boosterBody);
  const hotStage = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.5, 48, 1, true), darkSteel());
  hotStage.position.y = 7.0;
  booster.add(hotStage);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.04, 0.7, 48), darkSteel());
  skirt.position.y = 0.35;
  booster.add(skirt);
  const fins = gridFins(6.6, R);
  booster.add(fins);
  const boosterEngines = engineCluster(33, R * 0.86, -0.15, 0.16);
  booster.add(boosterEngines);
  tag(booster, 'Super Heavy booster', '33 Raptors · returns to the launch site', parts);
  group.add(booster);

  // ---- Starship upper stage ----
  const ship = new THREE.Group();
  ship.position.y = 7.25;
  const shipBody = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 4.2, 48), steel());
  shipBody.position.y = 2.1;
  ship.add(shipBody);
  // Ogive nose via lathe
  const nosePts: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    nosePts.push(new THREE.Vector2(R * Math.cos(t * Math.PI * 0.5), 4.2 + 2.6 * Math.sin(t * Math.PI * 0.5)));
  }
  const nose = new THREE.Mesh(new THREE.LatheGeometry(nosePts, 48), steel());
  ship.add(nose);
  // Heat-shield belly (dark half)
  const belly = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.005, R * 1.005, 4.2, 48, 1, true, Math.PI * 0.5, Math.PI), tile());
  belly.position.y = 2.1;
  ship.add(belly);
  // Flaps
  const flapMat = tile();
  const fwdFlap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.5, 0.9), flapMat);
  fwdFlap.position.set(R + 0.3, 5.2, 0); fwdFlap.rotation.z = -0.3;
  const fwdFlap2 = fwdFlap.clone(); fwdFlap2.position.x = -(R + 0.3); fwdFlap2.rotation.z = 0.3;
  const aftFlap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.8, 1.1), flapMat);
  aftFlap.position.set(R + 0.35, 0.9, 0); aftFlap.rotation.z = -0.2;
  const aftFlap2 = aftFlap.clone(); aftFlap2.position.x = -(R + 0.35); aftFlap2.rotation.z = 0.2;
  ship.add(fwdFlap, fwdFlap2, aftFlap, aftFlap2);
  const shipEngines = engineCluster(6, R * 0.5, -0.1, 0.18);
  ship.add(shipEngines);
  tag(ship, 'Starship upper stage', '6 Raptors · payload + crew to orbit & beyond', parts);
  group.add(ship);

  const plumeAnchors = [
    { position: new THREE.Vector3(0, -0.4, 0), scale: 1.6 },
    { position: new THREE.Vector3(0, 7.0, 0), scale: 0.9 },
  ];
  return { spec: VEHICLE_SPECS[0], group, parts, upperStage: ship, booster, plumeAnchors, height: 14.2 };
}

function buildStarshipHLS(): BuiltVehicle {
  const parts: VehiclePart[] = [];
  const group = new THREE.Group();
  const R = 0.9;
  const body = new THREE.Group();

  const hull = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 5.2, 48), white());
  hull.position.y = 3.4;
  body.add(hull);
  const nosePts: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    nosePts.push(new THREE.Vector2(R * Math.cos(t * Math.PI * 0.5), 6.0 + 2.2 * Math.sin(t * Math.PI * 0.5)));
  }
  body.add(new THREE.Mesh(new THREE.LatheGeometry(nosePts, 48), white()));
  // Crew window band
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.01, R * 1.01, 0.34, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x14213a, metalness: 0.6, roughness: 0.2, emissive: 0x0a1428, emissiveIntensity: 0.6 }));
  band.position.y = 5.4;
  body.add(band);
  tag(body, 'Crew cabin & hull', 'Pressurized crew volume · no heat shield / flaps', parts);
  group.add(body);

  const dock = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.1, 12, 32), darkSteel());
  ring.rotation.x = Math.PI / 2; ring.position.y = 8.25;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.4, 24), darkSteel());
  collar.position.y = 8.05;
  dock.add(ring, collar);
  tag(dock, 'Docking port', 'High-mounted · crew transfer from Orion', parts);
  group.add(dock);

  const legs = landingLegs(4, R, 0.9, 2.1, 1.5, darkSteel());
  tag(legs, 'Landing legs', 'Four deployable legs · south-pole touchdown', parts);
  group.add(legs);

  const engines = engineCluster(6, R * 0.5, 0.75, 0.18);
  tag(engines, 'Descent engines', 'Raptor subset for the landing burn', parts);
  group.add(engines);

  const cargo = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.5), goldFoil());
  cargo.position.set(R + 0.2, 2.2, 0);
  tag(cargo, 'Cargo / airlock module', 'Surface payloads & EVA', parts);
  group.add(cargo);

  return { spec: VEHICLE_SPECS[1], group, parts, upperStage: null, booster: null, plumeAnchors: [{ position: new THREE.Vector3(0, 0.5, 0), scale: 1.2 }], height: 8.6 };
}

function buildClpsLander(): BuiltVehicle {
  const parts: VehiclePart[] = [];
  const group = new THREE.Group();

  const bus = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.05, 1.3, 8), goldFoil());
  body.position.y = 2.0;
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.12, 8), darkSteel());
  deck.position.y = 2.7;
  bus.add(body, deck);
  tag(bus, 'Octagonal bus', 'Avionics, tanks & survival battery', parts);
  group.add(bus);

  const legs = landingLegs(4, 1.0, 1.4, 1.9, 1.35, darkSteel());
  tag(legs, 'Landing gear', 'Four legs with crushable footpads', parts);
  group.add(legs);

  const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.34, 0.6, 20, 1, true), bell());
  engine.position.y = 1.15;
  tag(engine, 'Descent engine', 'Throttleable bi-propellant', parts);
  group.add(engine);

  // Vertical solar masts (the app's power model)
  const masts = new THREE.Group();
  for (const sx of [-1, 1]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 8), darkSteel());
    mast.position.set(sx * 0.85, 4.0, 0);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 0.05), amberPanel());
    panel.position.set(sx * 0.85, 4.1, 0);
    masts.add(mast, panel);
  }
  tag(masts, 'Vertical solar masts', 'Azimuth-tracked · cos(el) at grazing sun', parts);
  group.add(masts);

  const dish = new THREE.Group();
  const reflector = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.4), white());
  reflector.rotation.x = Math.PI * 0.85; reflector.position.set(0, 3.2, 0.9);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), darkSteel());
  feed.position.set(0, 3.0, 0.6); feed.rotation.x = Math.PI * 0.35;
  dish.add(reflector, feed);
  tag(dish, 'Direct-to-Earth dish', 'High-gain antenna · needs Earth above the mask', parts);
  group.add(dish);

  return { spec: VEHICLE_SPECS[2], group, parts, upperStage: null, booster: null, plumeAnchors: [{ position: new THREE.Vector3(0, 0.9, 0), scale: 0.7 }], height: 5.4 };
}

export function buildVehicle(id: VehicleId): BuiltVehicle {
  switch (id) {
    case 'starship-hls': return buildStarshipHLS();
    case 'clps-lander': return buildClpsLander();
    default: return buildStarshipStack();
  }
}

export function disposeVehicle(v: BuiltVehicle) {
  v.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}
