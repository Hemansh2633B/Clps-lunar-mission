import type { LandingSite, TerrainFeature, TerrainProfile } from '../types/mission';
import type { HorizonMask } from '../terrain/types';
import { buildTerrainProfile, flatProfile } from '../engine/horizonPhysics';
import { terrainProfileFromHorizon } from '../terrain/missionProfile';
import { wrap360 } from '../engine/constants';

interface SiteSeed {
  id: string;
  name: string;
  shortName: string;
  latitude: number;
  longitude: number;
  elevationM: number;
  region: string;
  description: string;
  accent: string;
  features: TerrainFeature[];
  base?: number;
  seed?: number;
}

const polarSeeds: SiteSeed[] = [
  {
    id: 'shackleton-rim',
    name: 'Shackleton Crater Rim',
    shortName: 'Shackleton Rim',
    latitude: -89.9,
    longitude: 0.0,
    elevationM: -1200,
    region: 'Shackleton · 89.9°S',
    description: 'Rim of the 21 km Shackleton crater, whose floor is a permanently shadowed cold trap. A classic peak-of-near-eternal-light candidate with a towering interior rim and an Earth-facing saddle.',
    accent: '#F59E0B',
    base: -0.12,
    seed: 3,
    features: [
      { name: 'Shackleton interior massif', azimuthDeg: 162, elevationDeg: 5.1, widthDeg: 58, kind: 'massif' },
      { name: 'Connecting ridge shoulder', azimuthDeg: 244, elevationDeg: 2.3, widthDeg: 46, kind: 'rim' },
      { name: 'Earth-facing saddle', azimuthDeg: 12, elevationDeg: 0.42, widthDeg: 44, kind: 'saddle' },
      { name: 'Crater drop-off', azimuthDeg: 118, elevationDeg: -0.55, widthDeg: 34, kind: 'drop' },
    ],
  },
  {
    id: 'connecting-ridge',
    name: 'Connecting Ridge',
    shortName: 'Connecting Ridge',
    latitude: -89.5,
    longitude: 222.0,
    elevationM: 650,
    region: 'Shackleton–de Gerlache ridge',
    description: 'The illuminated ridge linking Shackleton and de Gerlache. Broad, relatively benign terrain with long illumination stretches and a low Earth-facing horizon.',
    accent: '#10B981',
    base: -0.05,
    seed: 7,
    features: [
      { name: 'de Gerlache rim', azimuthDeg: 236, elevationDeg: 3.4, widthDeg: 52, kind: 'rim' },
      { name: 'Shackleton shoulder', azimuthDeg: 118, elevationDeg: 2.1, widthDeg: 40, kind: 'rim' },
      { name: 'North saddle', azimuthDeg: 18, elevationDeg: 0.35, widthDeg: 60, kind: 'saddle' },
    ],
  },
  {
    id: 'malapert-massif',
    name: 'Malapert Massif',
    shortName: 'Malapert Massif',
    latitude: -86.0,
    longitude: 0.0,
    elevationM: 4200,
    region: 'Malapert · 86°S',
    description: 'A ~5 km high massif near the south pole. Elevated terrain gives strong Earth visibility and long sunlight, but the summit ridge blocks part of the local sky.',
    accent: '#3B82F6',
    base: 0.1,
    seed: 11,
    features: [
      { name: 'Summit ridge', azimuthDeg: 184, elevationDeg: 4.2, widthDeg: 64, kind: 'massif' },
      { name: 'Western shoulder', azimuthDeg: 268, elevationDeg: 2.0, widthDeg: 44, kind: 'rim' },
      { name: 'Earth-facing slope', azimuthDeg: 4, elevationDeg: 0.25, widthDeg: 70, kind: 'saddle' },
    ],
  },
  {
    id: 'leibnitz-beta',
    name: 'Leibnitz Beta Plateau',
    shortName: 'Leibnitz Beta',
    latitude: -85.5,
    longitude: 32.0,
    elevationM: 3800,
    region: 'Leibnitz β plateau',
    description: 'High plateau on the Moon’s south-polar far-side limb. Elevated, open terrain with favorable Earth geometry and grazing but persistent sunlight.',
    accent: '#A78BFA',
    base: 0.05,
    seed: 15,
    features: [
      { name: 'Plateau scarp', azimuthDeg: 208, elevationDeg: 3.1, widthDeg: 58, kind: 'massif' },
      { name: 'Eastern rim', azimuthDeg: 96, elevationDeg: 1.7, widthDeg: 40, kind: 'rim' },
      { name: 'Earth corridor', azimuthDeg: 32, elevationDeg: 0.2, widthDeg: 66, kind: 'saddle' },
    ],
  },
  {
    id: 'haworth-rim',
    name: 'Haworth Crater Rim',
    shortName: 'Haworth Rim',
    latitude: -86.9,
    longitude: 355.0,
    elevationM: -1800,
    region: 'Haworth · 86.9°S',
    description: 'Rim of Haworth crater, adjacent to permanently shadowed terrain. A raised rim segment provides illumination while the crater interior remains a cold trap.',
    accent: '#F97316',
    base: -0.02,
    seed: 19,
    features: [
      { name: 'Haworth interior rim', azimuthDeg: 142, elevationDeg: 3.8, widthDeg: 56, kind: 'rim' },
      { name: 'Shoemaker shoulder', azimuthDeg: 226, elevationDeg: 2.4, widthDeg: 46, kind: 'rim' },
      { name: 'Earth-facing saddle', azimuthDeg: 356, elevationDeg: 0.55, widthDeg: 48, kind: 'saddle' },
    ],
  },
  {
    id: 'nobile-rim-1',
    name: 'Nobile Rim 1',
    shortName: 'Nobile Rim 1',
    latitude: -85.2,
    longitude: 53.5,
    elevationM: -900,
    region: 'Nobile · Artemis region',
    description: 'A candidate Artemis landing region on the rim of Nobile crater. Mix of illuminated ridges and shadowed floors, with Earth low toward the northeast.',
    accent: '#06B6D4',
    base: 0.0,
    seed: 23,
    features: [
      { name: 'Nobile interior rim', azimuthDeg: 126, elevationDeg: 3.5, widthDeg: 54, kind: 'rim' },
      { name: 'Southern massif', azimuthDeg: 214, elevationDeg: 2.6, widthDeg: 48, kind: 'massif' },
      { name: 'Earth corridor', azimuthDeg: 54, elevationDeg: 0.45, widthDeg: 58, kind: 'saddle' },
    ],
  },
  {
    id: 'de-gerlache-rim-2',
    name: 'de Gerlache Rim 2',
    shortName: 'de Gerlache Rim 2',
    latitude: -88.4,
    longitude: 291.7,
    elevationM: -2100,
    region: 'de Gerlache · Artemis region',
    description: 'Rim segment of de Gerlache crater. Terrain toward the northwest can occult Earth during libration minima, producing recurring DTE blackouts.',
    accent: '#EF4444',
    base: -0.06,
    seed: 29,
    features: [
      { name: 'Northwest ridge', azimuthDeg: 300, elevationDeg: 4.4, widthDeg: 50, kind: 'massif' },
      { name: 'Crater interior rim', azimuthDeg: 156, elevationDeg: 3.0, widthDeg: 52, kind: 'rim' },
      { name: 'Southern saddle', azimuthDeg: 210, elevationDeg: 0.3, widthDeg: 44, kind: 'saddle' },
    ],
  },
];

const referenceSeeds: (SiteSeed & { terrain?: TerrainProfile })[] = [
  {
    id: 'apollo-11',
    name: 'Apollo 11 · Tranquility Base',
    shortName: 'Apollo 11',
    latitude: 0.6741,
    longitude: 23.4729,
    elevationM: -2600,
    region: 'Mare Tranquillitatis',
    description: 'First crewed landing, 20 July 1969. Equatorial mare site: classic ~14-day lunar day/night cycle, high midday Sun, and Earth high in the sky.',
    accent: '#E6EAF2',
    features: [],
  },
  {
    id: 'apollo-17',
    name: 'Apollo 17 · Taurus-Littrow',
    shortName: 'Apollo 17',
    latitude: 20.1908,
    longitude: 30.7717,
    elevationM: -1900,
    region: 'Taurus-Littrow valley',
    description: 'Last crewed Apollo landing, 11 December 1972. Valley floor between massifs; still near-side with strong Earth visibility and a normal diurnal cycle.',
    accent: '#E6EAF2',
    features: [],
  },
  {
    id: 'change-4',
    name: "Chang'e 4 · Von Kármán",
    shortName: "Chang'e 4",
    latitude: -45.4446,
    longitude: 177.5882,
    elevationM: -5900,
    region: 'South Pole–Aitken basin · far side',
    description: 'First far-side soft landing, 3 January 2019. Earth is permanently below the horizon — the mission relied on the Queqiao relay satellite.',
    accent: '#EF4444',
    features: [],
  },
];

function makeSite(seed: SiteSeed, category: LandingSite['category']): LandingSite {
  const terrain = category === 'reference'
    ? flatProfile('Idealized mare / basin horizon')
    : buildTerrainProfile('LOLA-inspired illustrative mask', seed.features, seed.base ?? -0.08, seed.seed ?? 1, 'illustrative', 0.75);
  return {
    id: seed.id,
    name: seed.name,
    shortName: seed.shortName,
    latitude: seed.latitude,
    longitude: wrap360(seed.longitude),
    elevationM: seed.elevationM,
    category,
    region: seed.region,
    description: seed.description,
    terrain,
    accent: seed.accent,
  };
}

export const POLAR_SITES: LandingSite[] = polarSeeds.map((s) => makeSite(s, 'polar'));
export const REFERENCE_SITES: LandingSite[] = referenceSeeds.map((s) => makeSite(s, 'reference'));
export const LANDING_SITES: LandingSite[] = [...POLAR_SITES, ...REFERENCE_SITES];

export function siteById(id: string): LandingSite | undefined {
  return LANDING_SITES.find((s) => s.id === id);
}

export type CustomTerrainPreset = 'flat' | 'ridge' | 'crater-rim' | 'massif';

export function customTerrain(preset: CustomTerrainPreset, sectors?: number[]): TerrainProfile {
  if (sectors && sectors.length === 8) {
    const features: TerrainFeature[] = sectors.map((elev, i) => ({
      name: `Sector ${i * 45}°`,
      azimuthDeg: i * 45,
      elevationDeg: elev,
      widthDeg: 90,
      kind: elev > 2 ? 'massif' : elev < 0 ? 'drop' : 'rim',
    }));
    return buildTerrainProfile('Custom 8-sector horizon', features, -0.08, 5, 'illustrative', 1.0);
  }
  switch (preset) {
    case 'ridge':
      return buildTerrainProfile('Custom ridge horizon', [
        { name: 'Ridge', azimuthDeg: 180, elevationDeg: 3.2, widthDeg: 70, kind: 'rim' },
      ], -0.08, 5);
    case 'crater-rim':
      return buildTerrainProfile('Custom crater-rim horizon', [
        { name: 'Interior rim', azimuthDeg: 150, elevationDeg: 4.0, widthDeg: 60, kind: 'rim' },
        { name: 'Earth saddle', azimuthDeg: 0, elevationDeg: 0.4, widthDeg: 50, kind: 'saddle' },
      ], -0.08, 5);
    case 'massif':
      return buildTerrainProfile('Custom massif horizon', [
        { name: 'Massif', azimuthDeg: 210, elevationDeg: 5.0, widthDeg: 80, kind: 'massif' },
      ], 0.0, 5);
    default:
      return flatProfile('Custom flat horizon');
  }
}

export function makeCustomSite(input: {
  name: string;
  latitude: number;
  longitude: number;
  elevationM: number;
  preset: CustomTerrainPreset;
  sectors?: number[];
  terrainLabel?: string;
  sourceFrame?: string;
  horizon?: HorizonMask;
}): LandingSite {
  const terrain = input.horizon ? terrainProfileFromHorizon(input.horizon) : customTerrain(input.preset, input.sectors);
  if (input.terrainLabel) terrain.label = input.terrainLabel;
  if (input.sourceFrame) terrain.sourceFrame = input.sourceFrame;
  if (!input.horizon && input.terrainLabel) terrain.uncertaintyDeg = 1.5;
  const demDescription = input.horizon?.synthetic
    ? 'Synthetic demo horizon from Terrain Lab. Elevations are procedural, NOT real lunar data; use for interface exploration only.'
    : 'Terrain Lab DEM horizon preserved sample-for-sample. Verify the DEM body-frame realization against the IAU ephemeris frame and confirm coverage before operational use.';
  return {
    id: `custom-${Date.now().toString(36)}`,
    name: input.name || 'Custom site',
    shortName: input.name || 'Custom site',
    latitude: input.latitude,
    longitude: wrap360(input.longitude),
    elevationM: input.elevationM,
    category: Math.abs(input.latitude) >= 80 ? 'polar' : 'reference',
    region: 'User-defined coordinates',
    description: input.horizon ? demDescription : input.terrainLabel
      ? 'Synthesized from a Terrain Lab horizon. Verify source frame and coverage before operational use.'
      : 'Synthesized site. Horizon is an illustrative preset or user-edited 8-sector mask, not a measured DEM.',
    terrain,
    accent: '#10B981',
    custom: true,
  };
}
