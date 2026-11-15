/**
 * v1.12 Data Hub: catalogue integrity (no invented metadata, HTTPS-only links,
 * CSA references kept apart from terrain data), dataset workflow rules, and the
 * provenance carried into exports (report schema 2.1.0, additive).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  AVAILABILITY_LABEL, BUNDLED_BASEMAP_ID, CATALOGUE, EXTERNAL_VIEWERS, INTEGRATION_LABEL, MAP_LAYER_SOURCES, coordinateText, matchesSource, sourceById,
} from '../src/data/catalogue';
import { CONFIGURED_DATASET, datasetParam, formatBytes, modelEligibility, pickDataset, tiffCompressionLabel, tiffPredictorLabel } from '../src/terrain/datasets';
import { describeSourceProvenance, terrainProfileFromHorizon } from '../src/terrain/missionProfile';
import { dataProvenance, missionReportJSON, REPORT_SCHEMA_VERSION } from '../src/utils/export';
import { RECORDED_HORIZONS } from '../src/verification/recordedMeta';
import recorded from '../src/verification/recordedHorizons.json';
import { simulateMission, DEFAULT_CONFIG, evaluateAt } from '../src/engine/simulation';
import { makeCustomSite, siteById } from '../src/data/landingSites';
import { DAY_MS } from '../src/engine/constants';
import type { DatasetsResponse, HorizonMask, TerrainData } from '../src/terrain/types';

// Exactly the hosts the catalogue links to today. Adding a link to a new host must be a deliberate edit here.
const ALLOWED_HOSTS = new Set([
  'data.asc-csa.gc.ca', 'data.lroc.im-ldi.com', 'github.com', 'lroc.asu.edu', 'lroc.im-ldi.com', 'lunaserv.im-ldi.com', 'ntrs.nasa.gov', 'pds-geosciences.wustl.edu', 'pgda.gsfc.nasa.gov', 'quickmap.lroc.asu.edu', 'ssd-api.jpl.nasa.gov', 'ssd.jpl.nasa.gov', 'trek.nasa.gov', 'wms.im-ldi.com', 'wms.lroc.asu.edu', 'www.asc-csa.gc.ca',
]);

describe('source catalogue integrity', () => {
  it('has unique ids, known categories and labelled enums', () => {
    const ids = CATALOGUE.sources.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const categories = new Set(CATALOGUE.categories.map((c) => c.id));
    for (const s of CATALOGUE.sources) {
      expect(categories.has(s.category), s.id).toBe(true);
      expect(AVAILABILITY_LABEL[s.availability], s.id).toBeTruthy();
      expect(INTEGRATION_LABEL[s.integration], s.id).toBeTruthy();
      expect(s.provider.length, s.id).toBeGreaterThan(3);
      expect(s.product_name.length, s.id).toBeGreaterThan(3);
    }
    expect(CATALOGUE.sources.length).toBeGreaterThanOrEqual(20);
  });

  it('represents unknown metadata as null, never as an empty or placeholder string', () => {
    const optional = ['product_id', 'version', 'spatial_resolution', 'coverage', 'coordinate_system', 'reference_frame', 'vertical_datum',
      'publication_date', 'retrieval_date', 'attribution', 'usage_terms', 'documentation_url', 'access_url', 'verification', 'notes'] as const;
    let nulls = 0;
    for (const s of CATALOGUE.sources) {
      for (const k of optional) {
        const v = s[k];
        if (v === null) { nulls++; continue; }
        expect(typeof v, `${s.id}.${k}`).toBe('string');
        expect((v as string).trim().length, `${s.id}.${k}`).toBeGreaterThan(0);
        expect(/^(unknown|n\/a|none|tbd|todo|\?+)$/i.test((v as string).trim()), `${s.id}.${k} must be null when unknown`).toBe(false);
      }
      for (const k of ['publication_date', 'retrieval_date'] as const) {
        if (s[k] !== null) expect(s[k], `${s.id}.${k}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
    // The catalogue is honest about what was not confirmed: usage terms were not verified for any source.
    expect(nulls).toBeGreaterThan(20);
    expect(CATALOGUE.sources.every((s) => s.usage_terms === null)).toBe(true);
    expect(CATALOGUE.disclaimer).toMatch(/null/i);
  });

  it('links only to HTTPS pages on known provider hosts', () => {
    const urls: [string, string][] = [];
    for (const s of CATALOGUE.sources) for (const k of ['documentation_url', 'access_url'] as const) if (s[k]) urls.push([`${s.id}.${k}`, s[k]!]);
    for (const r of CATALOGUE.csa) urls.push([r.id, r.url]);
    urls.push(['csa_landing', CATALOGUE.csa_landing.url]);
    for (const v of Object.values(EXTERNAL_VIEWERS)) urls.push([v.label, v.url]);
    expect(urls.length).toBeGreaterThan(25);
    for (const [where, url] of urls) {
      const u = new URL(url);
      expect(u.protocol, where).toBe('https:');
      expect(ALLOWED_HOSTS.has(u.hostname), `${where}: unexpected host ${u.hostname}`).toBe(true);
    }
  });

  it('never classifies imagery or mission references as elevation data', () => {
    for (const s of CATALOGUE.sources) {
      if (s.category === 'imagery' || s.category === 'lighting' || s.category === 'mission') {
        expect(s.data_kind, s.id).not.toBe('elevation');
        expect(s.integration, s.id).not.toBe('acquire');
      }
      if (s.integration === 'acquire') {
        expect(s.category, s.id).toBe('dem');
        expect(s.data_kind, s.id).toBe('elevation');
        expect(s.reference_frame, s.id).toMatch(/MOON_ME/);
        expect(s.access_url, s.id).toMatch(/^https:\/\/pgda\.gsfc\.nasa\.gov\/data\/.+\.TIF$/);
      }
    }
  });

  it('keeps Canadian Space Agency material as mission reference only', () => {
    expect(CATALOGUE.csa.length).toBeGreaterThanOrEqual(8);
    expect(CATALOGUE.csa_notice).toMatch(/mission reference only/i);
    expect(CATALOGUE.csa_notice).toMatch(/never stand in for LOLA or LROC/i);
    for (const r of CATALOGUE.csa) {
      expect(r.classification, r.id).toBe('mission-reference');
      expect(r.provider, r.id).toMatch(/Canadian Space Agency/);
      expect(new URL(r.url).hostname.endsWith('asc-csa.gc.ca'), r.id).toBe(true);
      // No publication date was present in the retrieved pages, so none is claimed.
      expect(r.publication_date, r.id).toBeNull();
      expect(r.verification.length, r.id).toBeGreaterThan(20);
    }
    // No CSA entry leaks into the source list as terrain, DEM or lighting data.
    expect(CATALOGUE.sources.some((s) => /Canadian Space Agency|CSA/.test(s.provider))).toBe(false);
  });

  it('offers the bundled mosaic first and describes every remote map layer completely', () => {
    expect(MAP_LAYER_SOURCES[0].id).toBe(BUNDLED_BASEMAP_ID);
    expect(MAP_LAYER_SOURCES[0].layer.type).toBe('bundled');
    expect(MAP_LAYER_SOURCES.length).toBe(4);
    for (const s of MAP_LAYER_SOURCES.slice(1)) {
      if (s.layer.type === 'wmts') {
        expect(s.layer.url_template).toMatch(/^https:\/\/trek\.nasa\.gov\/tiles\/Moon\/SP\/.+\{z\}\/\{row\}\/\{col\}\.png$/);
        expect(s.layer.max_level).toBeGreaterThan(s.layer.min_level);
        expect(s.layer.bbox[0]).toBeLessThan(s.layer.bbox[2]);
      } else if (s.layer.type === 'wms') {
        expect(s.layer.endpoint).toBe('https://wms.im-ldi.com/');
        expect(s.layer.srs).toBe('IAU2000:30120');
      }
      expect(s.attribution, s.id).toBeTruthy();
    }
  });

  it('searches the fields a user would type and formats coordinates unambiguously', () => {
    expect(CATALOGUE.sources.filter((s) => matchesSource(s, 'horizons')).map((s) => s.id)).toContain('jpl-horizons');
    expect(CATALOGUE.sources.filter((s) => matchesSource(s, 'MOON_ME')).length).toBeGreaterThanOrEqual(5);
    expect(CATALOGUE.sources.filter((s) => matchesSource(s, 'zzz-no-such-thing'))).toHaveLength(0);
    expect(CATALOGUE.sources.filter((s) => matchesSource(s, '  '))).toHaveLength(CATALOGUE.sources.length);
    expect(coordinateText(-89.9, 359.4505)).toBe('-89.9000, -0.5495 (lat, lon east-positive; 359.4505°E)');
    expect(coordinateText(-85, 45)).toContain('-85.0000, 45.0000');
    expect(sourceById('lola-ldem-80s-20mpp-adj')?.file_size).toBe('2.6 GB');
  });

  it('is the same file the native backend embeds and serves', () => {
    const disk = JSON.parse(readFileSync('backend/catalog/catalogue.json', 'utf8'));
    expect(disk.sources.length).toBe(CATALOGUE.sources.length);
    expect(disk.schema_version).toBe(CATALOGUE.schema_version);
  });
});

describe('Terrain Lab dataset rules', () => {
  const entry = (id: string, kind: 'configured' | 'acquired', ready: boolean) => ({ id, kind, ready, source: null, error: ready ? null : 'No DEM configured.' });
  const response = (list: ReturnType<typeof entry>[]): DatasetsResponse => ({
    datasets: list, storage: { kind: 'local', persistent: true }, acquisition: { enabled: true, products: [], max_subset_pixels: 1 },
  });

  it('keeps the v1.11 request shape for the configured DEM and names acquired datasets explicitly', () => {
    expect(datasetParam(CONFIGURED_DATASET)).toBeUndefined();
    expect(datasetParam(undefined)).toBeUndefined();
    expect(datasetParam('lola-abc')).toBe('lola-abc');
  });

  it('prefers the current dataset, falls back to a ready one, and never invents one', () => {
    const r = response([entry('configured', 'configured', false), entry('lola-a', 'acquired', true), entry('lola-b', 'acquired', true)]);
    expect(pickDataset(r, 'lola-b')?.id).toBe('lola-b');
    expect(pickDataset(r, 'configured')?.id).toBe('lola-a');
    expect(pickDataset(response([entry('configured', 'configured', false)]), 'configured')).toBeNull();
    expect(pickDataset(null, 'configured')).toBeNull();
  });

  it('formats byte counts for the download estimate', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.50 KB');
    expect(formatBytes(2.6 * 1024 ** 3)).toBe('2.60 GB');
    expect(formatBytes(NaN)).toBe('unknown size');
    expect([1, 5, 8, 32946, 32773, 50000].map(tiffCompressionLabel)).toEqual(['none', 'LZW', 'Deflate', 'Deflate (legacy code)', 'PackBits', 'TIFF code 50000']);
    expect([1, 2, 3, 9].map(tiffPredictorLabel)).toEqual(['none', 'horizontal differencing', 'floating-point', 'TIFF code 9']);
  });

  const model = (over: Partial<TerrainData> & { frame?: string; coverage?: number; synthetic?: boolean }): TerrainData => ({
    mode: 'real', synthetic: over.synthetic ?? false, latitude: -89.5, longitude: 45, radius_km: 5,
    grid: { size: 129, spacing_m: 78, order: 'row-major', elevations_m: [] }, landing_elevation_m: 0,
    statistics: { minimum_m: 0, maximum_m: 1, range_m: 1, coverage_percent: over.coverage ?? 100 },
    source: { filename: 'x.tif', lunar_radius_m: 1737400, elevation_reference_radius_m: 1737400, elevation_reference: 'sphere', lunar_reference_frame: over.frame ?? 'MOON_ME (JPL DE421)', synthetic: over.synthetic ?? false },
  });

  it('explains eligibility without ever upgrading it', () => {
    expect(modelEligibility(null).level).toBe('none');
    expect(modelEligibility(model({ synthetic: true })).level).toBe('demo');
    expect(modelEligibility(model({})).level).toBe('eligible');
    expect(modelEligibility(model({ coverage: 97.5 })).level).toBe('partial');
    expect(modelEligibility(model({ coverage: 97.5 })).detail).toMatch(/blocked from the mission planner/);
    const unknown = modelEligibility(model({ frame: 'SOME_OTHER_FRAME' }));
    expect(unknown.level).toBe('blocked');
    expect(unknown.detail).toMatch(/blocked from mission visibility/);
    // An undeclared frame is blocked even with perfect coverage.
    expect(modelEligibility(model({ frame: '' })).level).toBe('blocked');
  });
});

function mask(extra: Partial<HorizonMask['source']> = {}, processing?: HorizonMask['processing']): HorizonMask {
  const n = 72;
  return {
    latitude: -89.5, longitude: 45, radius_km: 5, horizon_radius_km: 4.9, edge_inset_m: 55, sampling_step_m: 20, grid_size: 257, grid_spacing_m: 39,
    eye_height_m: 2, azimuth_step_deg: 5, azimuths_deg: Array.from({ length: n }, (_, i) => i * 5), elevations_deg: new Array(n).fill(1),
    ray_coverage_percent: new Array(n).fill(100), max_obstacle_range_km: new Array(n).fill(1), mean_coverage_percent: 100, synthetic: false,
    source: { filename: 'subset.tif', lunar_radius_m: 1737400, elevation_reference_radius_m: 1737400, elevation_reference: 'sphere', lunar_reference_frame: 'MOON_ME (JPL DE421)', synthetic: false, ...extra },
    model: 'test', frame_note: '', processing,
  };
}

describe('provenance carried from the backend into exports', () => {
  const acquired = mask({
    dataset_id: 'lola-ldem-80s-20mpp-adj-abc123',
    provenance: { product_id: 'lola-ldem-80s-20mpp-adj', source_url: 'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF',
      subset_provenance: { sha256: 'deadbeef'.repeat(8), downloaded_utc: '2026-11-14T10:00:00Z' } },
  }, { engine: 'chandra-native-go', resampling: 'bilinear', kernel: 'tent', kernel_scale: [1, 1], transform: 'exact per-cell' });

  it('describes only what the backend reported', () => {
    const text = describeSourceProvenance(acquired)!;
    expect(text).toContain('dataset lola-ldem-80s-20mpp-adj-abc123');
    expect(text).toContain('product lola-ldem-80s-20mpp-adj');
    expect(text).toContain('source https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF');
    expect(text).toContain('retrieved 2026-11-14T10:00:00Z');
    expect(text).toContain(`checksum ${'deadbeef'.repeat(8)}`);
    expect(text).toContain('resampled by chandra-native-go');
    // Nothing reported → nothing claimed. Synthetic demos never get source provenance.
    expect(describeSourceProvenance(mask())).toBeUndefined();
    expect(describeSourceProvenance({ ...acquired, synthetic: true })).toBeUndefined();
    // Hostile / oversized values are ignored rather than echoed.
    expect(describeSourceProvenance(mask({ provenance: { product_id: 'x'.repeat(5000), source_url: 42 } }))).toBeUndefined();
  });

  it('stores it on the imported terrain profile and in the 2.1.0 report', async () => {
    const profile = terrainProfileFromHorizon(acquired);
    expect(profile.sourceProvenance).toContain('lola-ldem-80s-20mpp-adj');
    expect(terrainProfileFromHorizon(mask()).sourceProvenance).toBeUndefined();
    const site = makeCustomSite({ name: 'Acquired LOLA', latitude: -89.5, longitude: 45, elevationM: 0, preset: 'flat', horizon: acquired });
    const p = dataProvenance(site);
    expect(p.terrainSource.nature).toBe('measured-dem');
    expect(p.terrainSource.acquisition).toContain('checksum');
    expect(p.terrainSource.referenceFrame).toBe('MOON_ME (JPL DE421)');
  });

  it('never implies that a report was verified against Horizons, or that imagery was an input', () => {
    const ridge = dataProvenance(siteById('connecting-ridge')!);
    expect(ridge.ephemerisVerification.coversThisSite).toBe(false);
    expect(ridge.ephemerisVerification.role).toMatch(/never an input/);
    expect(ridge.ephemerisVerification.note).toMatch(/not itself checked against Horizons/);
    expect(ridge.ephemerisVerification.note).toMatch(/cannot verify terrain/);
    expect(ridge.terrainSource.nature).toBe('illustrative');
    expect(ridge.terrainSource.note).toMatch(/Not a measured lunar DEM/);
    expect(ridge.displayImagery).toMatch(/display-only/);
    expect(dataProvenance(siteById('shackleton-rim')!).ephemerisVerification.coversThisSite).toBe(true);
  });

  it('keeps the recorded-reference constants in step with the recorded table', () => {
    const rows = recorded.targets.sun.rows;
    expect(RECORDED_HORIZONS.recordedUtc).toBe(recorded.recorded_utc);
    expect(RECORDED_HORIZONS.siteId).toBe(recorded.site.chandra_site_id);
    expect(RECORDED_HORIZONS.ephemeris).toBe(recorded.targets.sun.ephemeris_source);
    expect(RECORDED_HORIZONS.firstUtc).toBe(rows[0].utc);
    expect(RECORDED_HORIZONS.lastUtc).toBe(rows[rows.length - 1].utc);
    expect(RECORDED_HORIZONS.samplesPerTarget).toBe(rows.length);
    expect(recorded.targets.earth.rows.length).toBe(rows.length);
  });
});

describe('report schema 2.1.0 is an additive extension of 2.0.0', () => {
  // Top-level keys of the 2.0.0 report (v1.10/v1.11). Every one must survive with the same JSON type.
  const V2_0_0: Record<string, 'string' | 'object' | 'boolean' | 'array' | 'nullable'> = {
    product: 'string', applicationVersion: 'string', reportSchemaVersion: 'string', schemaVersionPolicy: 'string', generatedAt: 'string',
    timeReference: 'string', analysisFingerprint: 'string', analysisFingerprintShort: 'string', fingerprintMethod: 'string', disclaimer: 'string',
    site: 'object', config: 'object', effectiveConfig: 'object', requestedConfig: 'object', configWasClamped: 'boolean', clampedFields: 'array',
    current: 'object', summary: 'object', events: 'array', energyHistory: 'nullable', energyHistoryMethod: 'string', horizonProfile: 'object',
    reproducibility: 'object',
  };

  it('keeps every 2.0.0 field and adds dataProvenance', async () => {
    const site = siteById('connecting-ridge')!;
    const start = Date.parse('2026-12-18T00:00:00Z');
    const cfg = { ...DEFAULT_CONFIG, stepMinutes: 60, durationDays: 5 };
    const sim = simulateMission(site, start, start + 5 * DAY_MS, cfg);
    const r = JSON.parse(await missionReportJSON(site, cfg, sim, evaluateAt(site, start, cfg)));
    expect(REPORT_SCHEMA_VERSION).toBe('2.1.0');
    expect(r.reportSchemaVersion).toBe('2.1.0');
    for (const [key, type] of Object.entries(V2_0_0)) {
      expect(key in r, `2.0.0 field "${key}" must still be present`).toBe(true);
      const v = r[key];
      if (type === 'array') expect(Array.isArray(v), key).toBe(true);
      else if (type === 'nullable') expect(v === null || typeof v === 'object', key).toBe(true);
      else expect(typeof v, key).toBe(type);
    }
    // The only new top-level key.
    expect(Object.keys(r).filter((k) => !(k in V2_0_0))).toEqual(['dataProvenance']);
    expect(r.dataProvenance.catalogue.schemaVersion).toBe(CATALOGUE.schema_version);
    expect(r.dataProvenance.ephemerisEngine.catalogueId).toBe('astronomy-engine');
    expect(r.dataProvenance.ephemerisVerification.catalogueId).toBe('jpl-horizons');
    expect(sourceById(r.dataProvenance.ephemerisEngine.catalogueId)).toBeTruthy();
    expect(sourceById(r.dataProvenance.ephemerisVerification.catalogueId)).toBeTruthy();
    // The engine is described as what it is, and both independent checks are cited.
    expect(r.reproducibility.ephemeris.model).not.toMatch(/DE4\d\d-class/);
    expect(r.reproducibility.ephemeris.model).toMatch(/not a JPL DE numerical ephemeris/);
    expect(r.reproducibility.ephemeris.independentValidation).toMatch(/SPICE DE421/);
    expect(r.reproducibility.ephemeris.independentValidation).toMatch(/Horizons DE441/);
  });
});
