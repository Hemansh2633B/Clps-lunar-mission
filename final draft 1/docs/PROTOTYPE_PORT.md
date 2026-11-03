# Prototype → SELENE feature port

This document maps every working capability from the repository’s `prototype/` directory into the integrated application in `final draft 1/`. The original prototype is left untouched; the new console keeps its mission-planning workspace and adds the prototype’s terrain tooling as **Terrain Lab**.

| Prototype capability | Integrated location | Notes |
|---|---|---|
| Local single-band lunar DEM loading (Rasterio/GDAL, PyProj) | `backend/dem_loader.py`, `backend/terrain_crop.py` | Ported unchanged in behavior; lunar CRS, spherical radius, datum/frame/units validation preserved. |
| Bounded bilinear landing-centered extraction | `backend/terrain_crop.py` | 0.5–20 km radius; low/medium/high = 129/257/513; exact center vertex; NoData gaps preserved. |
| Real vs synthetic mode with no silent fallback | `backend/server.py`, `src/components/TerrainLab.tsx` | Real mode returns actionable errors when no DEM is configured. Synthetic mode is always labeled. |
| Synthetic demo terrain | `backend/synthetic.py`, `src/terrain/synthetic.ts` | Backend formula preserved; a matching built-in client demo lets Terrain Lab work even when the API is offline. |
| Three.js elevation mesh, OrbitControls | `src/terrain/terrainMesh.ts`, `src/terrain/lighting.ts`, `TerrainLab.tsx` | Orbit/pan/zoom, landing marker, analysis boundary, curved tangent frame. |
| Hover/click surface inspection | `TerrainLab.tsx`, `src/terrain/coordinates.ts` | East/north, elevation, distance, lat/lon; click to pin/release. |
| 1×–10× vertical exaggeration | `TerrainLab.tsx`, `setExaggeration` | Reported elevations/statistics unchanged; curvature included. |
| Manual Sun azimuth/elevation + shadow maps | `src/terrain/lighting.ts`, `TerrainLab.tsx` | Directional light, two-sided terrain shadows, quality-scaled shadow maps, shadow toggle. |
| Ephemeris lighting hook | `TerrainLab.tsx` + `src/engine/ephemeris.ts` | The prototype’s “future provider” is now implemented: manual or real mission-time Sun preview. Frame mismatch is disclosed. |
| Elevation statistics / coverage / source metadata | `TerrainLab.tsx` stats row + source line | Landing/min/max/range/radius/grid/coverage; CRS sphere, frame, datum. |
| Example locations | `backend/server.py /api/examples`, `TerrainLab.tsx` | South-pole example, near-pole, exact pole, north-pole reference; plus “Load selected site”. |
| Optional NASA LOLA COG subset downloader | `backend/download_lola_subset.py` | Range-read probe, native-resolution crop, provenance JSON, SHA-256, landing-elevation preservation check. |
| DEM configuration template | `dem_config.example.json`, `data/README.md` | Unfilled `REPLACE` fields rejected. |
| Python API/coordinate/crop/downloader tests | `tests/python/` | 67 tests, including new horizon-mask tests. |
| Node geometry checks | `scripts/geometry-check.ts` | Curvature, pole coordinates, Sun directions, mesh topology, NoData, synthetic demo, horizon ray-marching. |
| Browser/WebGL integration checks | `scripts/browser-test.mjs` | Mission console + Terrain Lab: inspection, exaggeration, shadow pixel change, manual Sun, horizon, real-mode safeguard. |
| Isolated planning-console prototype UI | `TerrainLab.tsx` | Re-homed into the SELENE aerospace design system rather than served as a separate page. |

## New integration beyond the prototype

- **360° horizon ray-marching** from the loaded DEM grid (`backend/horizon.py`, `src/terrain/horizon.ts`), with per-ray coverage and CSV export.
- **Send DEM horizon to mission planner**: creates a custom landing site whose terrain mask is derived from the DEM, with an explicit source-frame warning.
- **Educator story** “From DEM to Horizon Mask” in the Field Guide.
- **Single-command full stack**: `npm run dev:full` starts the Flask API and Vite console together.

## Scientific boundary

The prototype’s caution remains: GPU shadow maps are a visualization, not a validated illumination solver. DEM body-frame realizations (e.g. MOON_ME/DE421) and the console’s IAU 2015 ephemeris frame are not automatically reconciled. Terrain Lab labels this, and mission sites created from DEM masks carry a frame-check warning.
