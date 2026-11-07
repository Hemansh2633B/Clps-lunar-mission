import type { LandingSite, TerrainFeature, TerrainProfile } from '../types/mission';
import type { HorizonMask } from '../terrain/types';
import { buildTerrainProfile, flatProfile } from '../engine/horizonPhysics';
import { terrainProfileFromHorizon } from '../terrain/missionProfile';
import { classifyFrame, convertSite } from '../engine/lunarFrame';
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
  // Provenance metadata (audit): never present approximate region centers as
  // surveyed landing points, and never present illustrative relief as measured.
  program?: string;
  coordinateType?: LandingSite['coordinateType'];
  coordinateProvenance?: string;
  coordinateUncertaintyDeg?: number;
  elevationProvenance?: string;
  sourceUrl?: string;
  sourceDate?: string;
  dataConfidence?: LandingSite['dataConfidence'];
}

// Authoritative source for the nine Artemis III candidate regions (Oct 2024 LEAG
// announcement; downselection from thirteen to nine). NASA publishes regions
// (~15 km across), NOT precise landing coordinates — centers below are approximate.
const ARTEMIS3_SOURCE = 'https://ntrs.nasa.gov/citations/20250011660';
const ARTEMIS3_DATE = '2024-10-28';
const ARTEMIS3_PROVENANCE = 'Approximate center of a NASA Artemis III candidate region (~15 km across); not a surveyed landing point. Region centers are rounded for visualization.';
const ILLUSTRATIVE_ELEV = 'Illustrative relief synthesized for visualization; not a measured elevation.';

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
    accent: '#c4842a',
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
    accent: '#1f7a52',
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
    accent: '#1e3a5f',
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
    accent: '#8a4b6b',
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
    name: 'Haworth',
    shortName: 'Haworth',
    latitude: -86.9,
    longitude: 355.0,
    elevationM: -1800,
    region: 'Haworth · 86.9°S',
    description: 'Rim of Haworth crater, adjacent to permanently shadowed terrain. A raised rim segment provides illumination while the crater interior remains a cold trap.',
    accent: '#c4533a',
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
    accent: '#0e7490',
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
    accent: '#c23b32',
    base: -0.06,
    seed: 29,
    features: [
      { name: 'Northwest ridge', azimuthDeg: 300, elevationDeg: 4.4, widthDeg: 50, kind: 'massif' },
      { name: 'Crater interior rim', azimuthDeg: 156, elevationDeg: 3.0, widthDeg: 52, kind: 'rim' },
      { name: 'Southern saddle', azimuthDeg: 210, elevationDeg: 0.3, widthDeg: 44, kind: 'saddle' },
    ],
  },
  {
    id: 'cabeus-b-peak',
    name: 'Peak near Cabeus B',
    shortName: 'Cabeus B Peak',
    latitude: -82.5,
    longitude: -50.0,
    elevationM: 1500,
    region: 'Cabeus B · Artemis III region',
    description: 'Artemis III candidate region near a peak beside Cabeus B. Lower-latitude polar terrain with access to nearby permanently shadowed cold traps; Earth and Sun geometry vary strongly with libration.',
    accent: '#7a5c1e',
    base: 0.0,
    seed: 31,
    features: [
      { name: 'Cabeus B shoulder', azimuthDeg: 150, elevationDeg: 3.2, widthDeg: 56, kind: 'rim' },
      { name: 'Peak crest', azimuthDeg: 240, elevationDeg: 2.4, widthDeg: 48, kind: 'massif' },
      { name: 'Earth-facing slope', azimuthDeg: 20, elevationDeg: 0.4, widthDeg: 62, kind: 'saddle' },
    ],
  },
  {
    id: 'mons-mouton-plateau',
    name: 'Mons Mouton Plateau',
    shortName: 'Mouton Plateau',
    latitude: -84.5,
    longitude: 28.0,
    elevationM: 2800,
    region: 'Mons Mouton · Artemis III region',
    description: 'The broadest Artemis III candidate region: a high plateau near Mons Mouton. Elevated, open terrain favors long illumination and Earth visibility, with gentle relief across the plateau surface.',
    accent: '#3a6b8a',
    base: 0.08,
    seed: 37,
    features: [
      { name: 'Plateau scarp', azimuthDeg: 196, elevationDeg: 2.6, widthDeg: 60, kind: 'massif' },
      { name: 'Eastern rise', azimuthDeg: 92, elevationDeg: 1.5, widthDeg: 44, kind: 'rim' },
      { name: 'Earth corridor', azimuthDeg: 30, elevationDeg: 0.25, widthDeg: 68, kind: 'saddle' },
    ],
  },
  {
    id: 'mons-mouton',
    name: 'Mons Mouton',
    shortName: 'Mons Mouton',
    latitude: -84.6,
    longitude: 30.5,
    elevationM: 3600,
    region: 'Mons Mouton · Artemis III region',
    description: 'Artemis III candidate region on the Mons Mouton massif itself. A prominent south-polar mountain with strong Earth line-of-sight from its flanks and grazing, persistent sunlight on raised terrain.',
    accent: '#1e3a5f',
    base: 0.12,
    seed: 41,
    features: [
      { name: 'Mons Mouton summit', azimuthDeg: 188, elevationDeg: 4.6, widthDeg: 62, kind: 'massif' },
      { name: 'Western shoulder', azimuthDeg: 262, elevationDeg: 2.2, widthDeg: 46, kind: 'rim' },
      { name: 'Earth-facing flank', azimuthDeg: 8, elevationDeg: 0.3, widthDeg: 66, kind: 'saddle' },
    ],
  },
  {
    id: 'nobile-rim-2',
    name: 'Nobile Rim 2',
    shortName: 'Nobile Rim 2',
    latitude: -85.6,
    longitude: 49.0,
    elevationM: -700,
    region: 'Nobile · Artemis III region',
    description: 'A second Artemis III candidate region on the rim of Nobile crater, offset from Nobile Rim 1. Illuminated rim segments alternate with shadowed interior floors; Earth sits low toward the northeast.',
    accent: '#0e7490',
    base: -0.02,
    seed: 43,
    features: [
      { name: 'Nobile rim crest', azimuthDeg: 132, elevationDeg: 3.3, widthDeg: 52, kind: 'rim' },
      { name: 'Interior massif', azimuthDeg: 220, elevationDeg: 2.5, widthDeg: 48, kind: 'massif' },
      { name: 'Earth corridor', azimuthDeg: 50, elevationDeg: 0.5, widthDeg: 56, kind: 'saddle' },
    ],
  },
  {
    id: 'slater-plain',
    name: 'Slater Plain',
    shortName: 'Slater Plain',
    latitude: -88.5,
    longitude: -137.0,
    elevationM: -1400,
    region: 'Slater · Artemis III region',
    description: 'Artemis III candidate region on a plain near Slater crater. Relatively level terrain close to permanently shadowed regions; low, grazing Sun and libration-driven Earth visibility make window timing critical.',
    accent: '#6b4a8a',
    base: -0.04,
    seed: 47,
    features: [
      { name: 'Slater rim shoulder', azimuthDeg: 160, elevationDeg: 2.8, widthDeg: 54, kind: 'rim' },
      { name: 'Plain scarp', azimuthDeg: 250, elevationDeg: 1.6, widthDeg: 46, kind: 'rim' },
      { name: 'Earth-facing saddle', azimuthDeg: 16, elevationDeg: 0.45, widthDeg: 60, kind: 'saddle' },
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
    accent: '#8a7358',
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
    accent: '#8a7358',
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
    accent: '#c23b32',
    features: [],
  },
];

// Per-site provenance. Artemis III regions use approximate region centers (NASA
// publishes ~15 km regions, not precise points). Historical polar candidates are
// illustrative. Apollo/Chang'e coordinates are published landing points, but their
// horizon here is an idealized flat model (terrain confidence stays illustrative).
const SITE_PROVENANCE: Record<string, Partial<LandingSite>> = {
  'shackleton-rim': { program: 'Historical polar candidate', coordinateType: 'representative-point', coordinateProvenance: 'Illustrative rim location near Shackleton crater (≈89.9°S); representative point, not a surveyed landing site.', coordinateUncertaintyDeg: 0.3, elevationProvenance: ILLUSTRATIVE_ELEV, dataConfidence: 'illustrative' },
  'connecting-ridge': { program: 'Historical polar candidate', coordinateType: 'representative-point', coordinateProvenance: 'Illustrative location on the Shackleton–de Gerlache connecting ridge; representative point, not surveyed.', coordinateUncertaintyDeg: 0.4, elevationProvenance: ILLUSTRATIVE_ELEV, dataConfidence: 'illustrative' },
  'leibnitz-beta': { program: 'Historical polar candidate', coordinateType: 'representative-point', coordinateProvenance: 'Illustrative location on the Leibnitz β plateau; representative point, not surveyed.', coordinateUncertaintyDeg: 0.5, elevationProvenance: ILLUSTRATIVE_ELEV, dataConfidence: 'illustrative' },
  'malapert-massif': { program: 'Artemis III candidate (2024)', coordinateType: 'region-center', coordinateProvenance: ARTEMIS3_PROVENANCE, coordinateUncertaintyDeg: 0.5, elevationProvenance: ILLUSTRATIVE_ELEV, sourceUrl: ARTEMIS3_SOURCE, sourceDate: ARTEMIS3_DATE, dataConfidence: 'region-approximate' },
  'haworth-rim': { program: 'Artemis III candidate (2024)', coordinateType: 'region-center', coordinateProvenance: ARTEMIS3_PROVENANCE, coordinateUncertaintyDeg: 0.5, elevationProvenance: ILLUSTRATIVE_ELEV, sourceUrl: ARTEMIS3_SOURCE, sourceDate: ARTEMIS3_DATE, dataConfidence: 'region-approximate' },
  'nobile-rim-1': { program: 'Artemis III candidate (2024)', coordinateType: 'region-center', coordinateProvenance: ARTEMIS3_PROVENANCE, coordinateUncertaintyDeg: 0.5, elevationProvenance: ILLUSTRATIVE_ELEV, sourceUrl: ARTEMIS3_SOURCE, sourceDate: ARTEMIS3_DATE, dataConfidence: 'region-approximate' },
  'nobile-rim-2': { program: 'Artemis III candidate (2024)', coordinateType: 'region-center', coordinateProvenance: ARTEMIS3_PROVENANCE, coordinateUncertaintyDeg: 0.5, elevationProvenance: ILLUSTRATIVE_ELEV, sourceUrl: ARTEMIS3_SOURCE, sourceDate: ARTEMIS3_DATE, dataConfidence: 'region-approximate' },
  'de-gerlache-rim-2': { program: 'Artemis III candidate (2024)', coordinateType: 'region-center', coordinateProvenance: ARTEMIS3_PROVENANCE, coordinateUncertaintyDeg: 0.5, elevationProvenance: ILLUSTRATIVE_ELEV, sourceUrl: ARTEMIS3_SOURCE, sourceDate: ARTEMIS3_DATE, dataConfidence: 'region-approximate' },
  'cabeus-b-peak': { program: 'Artemis III candidate (2024)', coordinateType: 'region-center', coordinateProvenance: ARTEMIS3_PROVENANCE, coordinateUncertaintyDeg: 0.5, elevationProvenance: ILLUSTRATIVE_ELEV, sourceUrl: ARTEMIS3_SOURCE, sourceDate: ARTEMIS3_DATE, dataConfidence: 'region-approximate' },
  'mons-mouton-plateau': { program: 'Artemis III candidate (2024)', coordinateType: 'region-center', coordinateProvenance: ARTEMIS3_PROVENANCE, coordinateUncertaintyDeg: 0.5, elevationProvenance: ILLUSTRATIVE_ELEV, sourceUrl: ARTEMIS3_SOURCE, sourceDate: ARTEMIS3_DATE, dataConfidence: 'region-approximate' },
  'mons-mouton': { program: 'Artemis III candidate (2024)', coordinateType: 'region-center', coordinateProvenance: ARTEMIS3_PROVENANCE, coordinateUncertaintyDeg: 0.5, elevationProvenance: ILLUSTRATIVE_ELEV, sourceUrl: ARTEMIS3_SOURCE, sourceDate: ARTEMIS3_DATE, dataConfidence: 'region-approximate' },
  'slater-plain': { program: 'Artemis III candidate (2024)', coordinateType: 'region-center', coordinateProvenance: ARTEMIS3_PROVENANCE, coordinateUncertaintyDeg: 0.5, elevationProvenance: ILLUSTRATIVE_ELEV, sourceUrl: ARTEMIS3_SOURCE, sourceDate: ARTEMIS3_DATE, dataConfidence: 'region-approximate' },
  'apollo-11': { program: 'Apollo 11 (1969)', coordinateType: 'surveyed', coordinateProvenance: 'Published Apollo 11 landing coordinates (Tranquility Base, 20 Jul 1969). Horizon here is an idealized flat model.', coordinateUncertaintyDeg: 0.001, elevationProvenance: 'Approximate published elevation; horizon idealized.', sourceUrl: 'https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1969-059C', sourceDate: '1969-07-20', dataConfidence: 'illustrative' },
  'apollo-17': { program: 'Apollo 17 (1972)', coordinateType: 'surveyed', coordinateProvenance: 'Published Apollo 17 landing coordinates (Taurus-Littrow, 11 Dec 1972). Horizon here is an idealized flat model.', coordinateUncertaintyDeg: 0.001, elevationProvenance: 'Approximate published elevation; horizon idealized.', sourceUrl: 'https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1972-096C', sourceDate: '1972-12-11', dataConfidence: 'illustrative' },
  'change-4': { program: "Chang'e 4 (2019)", coordinateType: 'surveyed', coordinateProvenance: "Published Chang'e 4 landing coordinates (Von Kármán crater, 3 Jan 2019). Horizon here is an idealized flat model.", coordinateUncertaintyDeg: 0.001, elevationProvenance: 'Approximate published elevation; horizon idealized.', sourceUrl: 'https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=2018-103A', sourceDate: '2019-01-03', dataConfidence: 'illustrative' },
};

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
    ...SITE_PROVENANCE[seed.id],
  };
}

export const POLAR_SITES: LandingSite[] = polarSeeds.map((s) => makeSite(s, 'polar'));
export const REFERENCE_SITES: LandingSite[] = referenceSeeds.map((s) => makeSite(s, 'reference'));
export const LANDING_SITES: LandingSite[] = [...POLAR_SITES, ...REFERENCE_SITES];

export function siteById(id: string): LandingSite | undefined {
  return LANDING_SITES.find((s) => s.id === id);
}

export type CustomTerrainPreset = 'flat' | 'ridge' | 'crater-rim' | 'massif';

/** User-edited 8-sector mask: sector values are exact at 0/45/…/315°, periodic linear between. */
export function customSectorProfile(sectors: number[]): TerrainProfile {
  if (sectors.length !== 8 || sectors.some((v) => !Number.isFinite(v))) {
    throw new Error('An 8-sector horizon needs eight finite elevation values.');
  }
  const elevations: number[] = [];
  for (let az = 0; az <= 360; az += 1) {
    const x = (az % 360) / 45;
    const i0 = Math.floor(x) % 8;
    const i1 = (i0 + 1) % 8;
    const f = x - Math.floor(x);
    elevations.push(sectors[i0] * (1 - f) + sectors[i1] * f);
  }
  elevations[360] = elevations[0];
  const features: TerrainFeature[] = sectors.map((elev, i) => ({
    name: `Sector ${i * 45}°`,
    azimuthDeg: i * 45,
    elevationDeg: elev,
    widthDeg: 45,
    kind: elev > 2 ? 'massif' : elev < 0 ? 'drop' : 'rim',
  }));
  return {
    label: 'User-edited 8-sector horizon',
    kind: 'custom',
    resolutionDeg: 1,
    elevations,
    features,
    uncertaintyDeg: 1.0,
    eyeHeightM: 2,
    accuracyNote: 'User-edited sector values are exact at the eight cardinal/intercardinal azimuths; interpolation between them is not a measured terrain product.',
  };
}

export function customTerrain(preset: CustomTerrainPreset, sectors?: number[]): TerrainProfile {
  if (sectors && sectors.length === 8) return customSectorProfile(sectors);
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

let customSiteSeq = 0;

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

  // Convert site coordinates from the DEM source frame into the IAU 2015 ephemeris
  // frame (recognized frames only) and record the provenance of any shift. The
  // horizon mask is rotated by the matching azimuth offset in terrainProfileFromHorizon.
  let latitude = input.latitude;
  let longitude = wrap360(input.longitude);
  let coordinateProvenance = 'User-supplied coordinates (illustrative horizon).';
  if (input.horizon && !input.horizon.synthetic) {
    const cls = classifyFrame(input.horizon.source.lunar_reference_frame);
    if (cls.recognized && cls.transform && cls.transform !== 'iau') {
      const conv = convertSite(input.latitude, input.longitude, cls.transform);
      latitude = conv.latitude;
      longitude = wrap360(conv.longitude);
      coordinateProvenance = `Converted from ${input.horizon.source.lunar_reference_frame} (${input.latitude.toFixed(5)}°, ${input.longitude.toFixed(5)}°) to the IAU 2015 ephemeris frame via a SPICE-verified constant rotation (residual ≤0.0039°).`;
    } else if (cls.recognized) {
      coordinateProvenance = `Coordinates interpreted in the declared ${input.horizon.source.lunar_reference_frame} frame (compatible with IAU 2015; no rotation applied).`;
    } else {
      coordinateProvenance = `Source frame "${input.horizon.source.lunar_reference_frame || 'unspecified'}" is unverified; coordinates are NOT frame-corrected and quantitative mission visibility is blocked.`;
    }
  }
  const demDescription = input.horizon?.synthetic
    ? 'Synthetic demo horizon from Terrain Lab. Elevations are procedural, NOT real lunar data; use for interface exploration only.'
    : 'Terrain Lab DEM horizon preserved sample-for-sample and rotated into the IAU 2015 ephemeris frame. Frame residual and ray coverage are disclosed; verify before operational use.';
  return {
    // Monotonic suffix: two sites created in the same millisecond must not collide
    // (the persisted-session validator rejects duplicate IDs).
    id: `custom-${Date.now().toString(36)}-${(customSiteSeq++).toString(36)}`,
    name: input.name || 'Custom site',
    shortName: input.name || 'Custom site',
    latitude,
    longitude,
    elevationM: input.elevationM,
    category: Math.abs(input.latitude) >= 80 ? 'polar' : 'reference',
    region: 'User-defined coordinates',
    description: input.horizon ? demDescription : input.terrainLabel
      ? 'Synthesized from a Terrain Lab horizon. Verify source frame and coverage before operational use.'
      : 'Synthesized site. Horizon is an illustrative preset or user-edited 8-sector mask, not a measured DEM.',
    terrain,
    accent: '#1f7a52',
    custom: true,
    coordinateType: 'custom',
    coordinateProvenance,
    dataConfidence: input.horizon ? (input.horizon.synthetic ? 'synthetic' : 'measured') : 'illustrative',
  };
}
