# Lunar Terrain Simulator

A local Python + Three.js program for inspecting **real lunar elevation data** around a selected landing coordinate. Enter latitude, east-positive longitude, and a 0.5–20 km analysis radius; orbit, pan, and zoom around an actual 3D elevation mesh. Adjust the manual Sun to see terrain cast shadows onto itself.

This is a mission-planning development MVP, **not scientifically validated flight software**. It does not compute SPICE ephemerides, Earth visibility, illumination schedules, or landing safety.

## What works

- Local single-band lunar DEM loading, projected or geographic, using Rasterio/GDAL and PyProj.
- Bounded, bilinearly resampled extraction into a landing-centered local grid. No procedural terrain in real mode and no full-Moon download requirement.
- Interactive Three.js mesh with OrbitControls; a landing marker at the exact center sample and a circular analysis boundary.
- Low / Medium / High grids: **129 / 257 / 513** samples per side. Odd dimensions retain an exact center vertex. Medium is the default, approximately 102,000 triangles inside the disk; High is approximately 410,000.
- Elevation statistics, source/datum information, valid-data coverage, and hover/click inspection of east/north position, elevation, distance, latitude, and longitude.
- 1×–10× vertical relief exaggeration without modifying reported elevations; spherical lunar curvature is included.
- Manual Sun azimuth 0–360° and elevation −10–90°, with genuine Three.js terrain shadow maps and a shadow toggle.
- A separate, prominently labeled **SYNTHETIC TERRAIN — NOT REAL LUNAR DATA** mode.
- Explicit Sun/Earth ephemeris interfaces for later integration. No fake Earth-visibility output or inactive feature buttons.

## Requirements

- Python **3.11 or newer**, preferably 64-bit Python 3.12.
- Node.js **20 or newer** and npm, for installing Three.js locally. No JavaScript framework or build process is needed.
- A modern browser with WebGL2 and hardware acceleration enabled.
- Internet for initial package installation and optional NASA subset download; once installed, the viewer and local DEM processing work offline. Fonts use system fallbacks, with no CDN dependency.

The application serves the API, frontend, and Three.js from one Python process. Do not open `index.html` directly with `file://`, and do not start a second frontend server.

## Installation: Linux / macOS

From this project directory:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
npm ci
```

If `python3 -m venv` is unavailable on Linux, install your distribution's Python venv package. Rasterio and PyProj normally install prebuilt wheels; a supported 64-bit Python release avoids requiring a GDAL source build.

## Installation: Windows PowerShell

Install 64-bit Python and Node.js, then open PowerShell in the project directory:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
npm ci
```

You can optionally activate with `.\.venv\Scripts\Activate.ps1`. If your PowerShell policy blocks activation, use the explicit `.venv` Python executable as shown below; activation is not required and no execution-policy change is needed.

## Start immediately in demo mode

```bash
python -m backend.server
```

Windows without activation:

```powershell
.\.venv\Scripts\python.exe -m backend.server
```

Open **http://127.0.0.1:8000**. If no valid DEM is configured, startup selects the clearly labeled Synthetic Demo Mode. Choosing Real lunar DEM still returns an actionable error; a real-mode request never silently falls back to synthetic data.

The frontend is served at `/`, not on an npm development server. Use `--port 8001` if port 8000 is occupied. The server binds to localhost by default. `--host 0.0.0.0` permits access from other machines; this development server has no authentication and should be used on a trusted local network.

An isolated planning-console UI prototype is available at **http://127.0.0.1:8000/prototype/** while the same backend is running. It reuses the DEM API, real Three.js terrain, and manual lighting controller. The original application stays at `/`. See [`prototype/README.md`](prototype/README.md) for the prototype overview.

## Obtain actual lunar data

Recommended south-pole source: NASA Goddard's [A New View of the Lunar South Pole from LOLA](https://pgda.gsfc.nasa.gov/products/90). Its **LDEM** GeoTIFFs contain surface heights in meters, use a lunar south polar stereographic projection, and are cloud-optimized. The product page identifies the body reference frame as **MOON_ME in the JPL DE421 realization**.

Use an elevation product such as `LDEM_80S_20MPP_ADJ.TIF`, not a similarly named hillshade, error raster, observation-count map, or slope product. Those are useful companion products but are not elevations.

Other sources:

- [NASA PDS LRO LOLA archive](https://pds-geosciences.wustl.edu/missions/lro/lola.htm): LOLA products, labels, and software interface documentation.
- [LROC RDR product selection](https://wms.lroc.asu.edu/lroc/rdr_product_select): regional LROC digital terrain models. Coverage and reference information vary by product.

Download a regional product or crop a COG; you do not need the entire Moon. Keep the source label/documentation, including units, scaling, datum, projection, reference radius, longitude convention, and lunar body frame. A GeoTIFF CRS alone does **not** identify its vertical datum or body-frame realization.

### Optional small NASA LOLA download

The included downloader reads only the native-resolution source window around a requested point. It requires HTTP range support and does not offer a full-raster fallback. It saves a GeoTIFF and a configuration/provenance JSON file in `data/`.

```bash
python -m backend.download_lola_subset --latitude -89.5 --longitude 45 --radius 5
python -m backend.server --dem-config data/lola_example_config.json
```

Windows:

```powershell
.\.venv\Scripts\python.exe -m backend.download_lola_subset --latitude -89.5 --longitude 45 --radius 5
.\.venv\Scripts\python.exe -m backend.server --dem-config data/lola_example_config.json
```

The optional download uses NASA's published 20 m/pixel polar product. Its assumptions are centralized in `backend/config.py`. Review them against the product documentation before scientific use. Output includes the source URL, pixel window, UTC download time, SHA-256, and a check that cropping preserves the native landing elevation.

If `data/lola_example_config.json` and its raster are already present, skip the download and start the backend with that configuration. This repository upload contains the source code only; no DEM raster is included. Start in Synthetic Demo Mode or download a local lunar DEM and configure it as described above.

Existing files are preserved. To download another area, provide new `--output` and `--config-output` filenames. A 5 km subset is only a few MB, although HTTP tile reads can transfer more than the final compressed file size. A crop covers only its saved area: use a wider subset or another DEM when changing the location or requesting a larger radius.

### Use your own local DEM

Place your raster in `data/`, then copy `dem_config.example.json` to `dem_config.json`. Replace its example fields with values verified from your product documentation:

```json
{
  "dem_path": "data/lunar_south_pole_dem.tif",
  "vertical_unit": "m",
  "value_kind": "elevation",
  "elevation_reference": "Your product's confirmed elevation datum",
  "elevation_reference_radius_m": 1737400.0,
  "lunar_reference_frame": "Your product's confirmed body-fixed frame and realization"
}
```

The 1,737,400 m value here is an example; confirm it for your product. Unfilled `REPLACE …` fields are rejected.

```bash
python -m backend.server --dem-config dem_config.json
# Or override the raster path independently:
python -m backend.server --dem /absolute/path/to/lunar_dem.tif --dem-config dem_config.json
```

Windows:

```powershell
.\.venv\Scripts\python.exe -m backend.server --dem-config dem_config.json
```

`LUNAR_DEM_PATH` and `LUNAR_DEM_CONFIG` environment variables are also supported. CLI arguments take precedence. Relative DEM paths resolve against the project root. The JSON configuration path resolves from the working directory; run these commands from the project root.

Band scaling defaults to GDAL's `dataset.scales[0]` and `dataset.offsets[0]`; if the label supplies scaling that GDAL did not retain, add explicit numeric `scale` and `offset` overrides. Processing uses:

```text
physical_value = (raw_sample × scale + offset) × unit_to_meters
```

For `value_kind: "elevation"`, this is elevation above the declared reference sphere. For `value_kind: "radius"`, the declared `elevation_reference_radius_m` is subtracted from the radial value. Values are never normalized into an arbitrary elevation range.

## Supported DEMs and coordinate assumptions

Scientific conventions and limits are centralized in **`backend/config.py`**, with per-product assumptions in the DEM JSON configuration.

| Item | Behavior |
| --- | --- |
| Input latitude | Planetocentric, −90…+90°. On supported spheres, planetocentric and planetographic latitude coincide. |
| Input longitude | East-positive; −180…180 or 0…360 input. API and inspector normalize to −180…180. West-positive products must be correctly converted before use. |
| Lunar radius | Demo uses 1,737,400 m. Real extraction uses the **actual spherical radius in the DEM CRS**, never EPSG:4326 or an Earth radius. |
| Allowed CRS | Geographic or projected lunar sphere, radius 1,700–1,800 km, zero reference meridian. Non-spherical and Earth CRSs are rejected. Geographic raster angular units must be degrees. |
| Vertical datum | Explicit radial elevation reference and reference radius required; no inferred geoid, Earth sea level, or silent datum conversion. |
| Body frame | Explicit user-supplied frame and realization from the source documentation. A mislabeled frame cannot be detected from raster pixels. |
| Formats | Single-band GeoTIFF recommended. GDAL-readable PDS `.IMG`/`.LBL` can work if labels, lunar CRS, affine georeferencing, scale/offset, and NoData metadata are intact. |
| NoData | Missing raster samples are omitted from the mesh; a missing landing sample is an error. Coverage is reported for the analysis disk. |

LROC or PDS products without a usable lunar CRS must be converted/georeferenced using their **verified** projection metadata. Do not assign an Earth EPSG code to make a file open. This version does not support raw LOLA point tracks, ungeoreferenced images, compound vertical CRSs, arbitrary ellipsoids, west-positive raster axes, or heights relative to an unknown/non-radial datum.

## How extraction and rendering work

1. Validate finite coordinates, radius 0.5–20 km, source mode, and quality.
2. Inspect the local raster and verify the lunar sphere plus explicit vertical/reference metadata.
3. Transform the requested landing coordinate through the DEM's own geodetic/projected CRS. Bilinearly sample its **native** elevation from the neighboring pixels, independently of display quality.
4. Construct a local lunar **azimuthal-equidistant (AEQD)** CRS centered on that coordinate, using the source CRS radius. East/north distances from the origin equal great-circle radial distances on that sphere.
5. Use a GDAL WarpedVRT to read and bilinearly resample only the requested region into 129², 257², or 513² samples. Geographic 0–360 rasters also use an equivalent longitude-shifted virtual view when needed at their seam.
6. Omit samples outside the radius and any missing values. Preserve the exact native landing elevation as the center vertex. Return JSON containing original elevations in meters, spacing, source metadata, coverage, and statistics. Ordinary JSON grid samples are rounded to 1 mm to reduce payload size; the center sample retains full precision. This is a serialization choice, **not** a claim of millimeter DEM accuracy.
7. Convert each sample into the landing tangent frame. With arc distance `d`, source CRS radius `Rcrs`, radial datum radius `Rdatum`, and elevation `h`, the angular separation is `d/Rcrs`; the point's radial distance is `Rdatum+h`. Apply sine/cosine to obtain east/north chord coordinates and height relative to the landing tangent plane. This retains the drop due to spherical curvature.
8. Render in kilometers: Three.js `+X = east`, `+Y = up`, `−Z = north`. The inspector reports **unexaggerated** elevations and AEQD east/north distances in meters. At the exact poles, the selected longitude defines the local reference meridian.

Statistics are computed over the **resampled valid analysis disk**, so they may miss native-resolution peaks or pits. Landing elevation is sampled at native resolution. Hover values interpolate the displayed triangle's unexaggerated samples. The radius outline is a visual annotation with its height sampled slightly inside the disk; it is not additional measured terrain. No triangles bridge missing vertices.

Changing exaggeration stretches relief relative to the landing elevation; lunar curvature remains. It changes displayed geometry, normals, and shadows, while leaving source elevations and statistics intact. Use **1×** for any physical interpretation of the visualization.

## Sun and shadow behavior

- Azimuth is clockwise from local north: 0° north, 90° east, 180° south, 270° west. Elevation is above the landing site's local tangent horizon.
- The Sun is a directional light with parallel rays. Light/shadow camera bounds follow the terrain, its exaggeration, and the configured Sun direction.
- Terrain both casts and receives shadows. Shadow casting is explicitly two-sided because the terrain is an open heightfield.
- Low quality uses 1024² shadow maps; Medium and High use 2048², with PCF filtering and a small terrain-scaled depth/normal bias.
- The renderer updates on interaction. Shadow maps refresh when terrain, exaggeration, Sun, or the toggle changes; camera movement reuses them. Pixel ratio is capped at 1.5 to reduce integrated-GPU load.
- A small ambient fill keeps dark terrain inspectable. It represents display fill, **not a physical lunar atmosphere or reflected-light calculation**.

GPU shadow maps are a visualization, not a validated visibility or illumination solver. Low Sun angles can expose aliasing or bias artifacts. Features below grid resolution and occluders outside the crop are absent. Negative Sun elevation is displayed as a manual direction; global lunar-body occultation is not calculated. Spherical curvature alone does not supply the missing global horizon. The point light direction also does not model the Sun's finite disk or penumbra.

## Future SPICE and Earth visibility

`frontend/ephemeris.js` defines:

```javascript
getSunPosition(latitude, longitude, datetime, manualValues, provider)
getEarthPosition(latitude, longitude, datetime, provider)
```

The current manual provider returns the supplied Sun angles with `source: "manual"` and `datetimeUsed: false`. Earth position raises a clear **not implemented** error; there is no Earth button pretending to calculate visibility.

For SPICE integration:

1. Add a Python provider and optional API route using `spiceypy`; keep it out of the default dependencies.
2. Load verified SPK, lunar orientation/PCK, leap-second, and frame kernels that match the DEM's documented body-frame realization. Do not treat MOON_ME and MOON_PA, or different realizations, as interchangeable.
3. Convert UTC to ephemeris time and calculate Sun/Earth vectors in the appropriate Moon body frame, with an explicit aberration/light-time convention.
4. Convert each vector to the landing site's local east/north/up basis, then return azimuth/elevation plus source/time/frame metadata. Let the UI request/await these values and call `LightingController.applySunPosition(mesh, data, position, shadows)` with the resolved angles. Manual and calculated modes must be labeled separately.
5. Implement terrain line-of-sight/horizon tracing separately from WebGL shadow maps. For Earth, report unknown coverage when an occluding horizon may lie beyond the DEM. Account for its finite angular disk when appropriate.

There is no date/time UI until a provider actually uses it. NASA SPICE is not mandatory for this version.

## Imagery extension

The terrain material is lunar gray, with no required imagery. `frontend/terrain.js` already supplies UV coordinates. Later, reproject an LROC orthophoto into the **same local AEQD crop and bounds**, verify frame alignment, then attach it as `mesh.material.map` with the correct color space. An arbitrary image stretched over the mesh would not be geospatially registered.

## Tests

Python tests run offline using small, explicitly tagged synthetic GeoTIFF fixtures:

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
npm test
```

They cover coordinate/radius validation, geodesic distances at poles and longitude seams, native elevation reading, cropping and bilinear plane preservation, center placement, NoData, scale/offset, radial values, missing configuration, bad rasters/CRSs, and API errors. Node geometry checks cover spherical geometry, Sun directions, mesh topology, the exact landing origin, and explicit ephemeris behavior.

For actual browser/WebGL integration, keep the backend running in one terminal and use another:

```bash
npx playwright install chromium
npm run test:browser
```

The test uses `/usr/bin/chromium` when present, or Playwright's installed Chromium. Set `CHROMIUM_PATH` to override the executable or `LUNAR_TEST_URL` to test another local port. It checks orbit controls, inspection, all quality levels, radius, exaggeration, Sun extremes, visible shadow pixel changes, synthetic warnings, and mobile layout. Screenshots are saved under ignored `artifacts/`. Software WebGL is used for portable browser verification; this does **not** establish Intel i5 performance numbers.

Development verification also loaded an actual NASA LOLA crop at **−89.5°, 45° E, radius 5 km**, checked native/cropped elevation agreement, and rendered its terrain and changing shadows in Chromium. Its landing elevation was approximately **−393.8 m**, with sampled terrain **−915.0 to +697.0 m** and 100% disk coverage. These observations validate the software path for that sample, not independent scientific correctness of the source datum, heights, or shadow model.

## Example locations

| Latitude | Longitude | Radius | Notes |
| --- | --- | --- | --- |
| −89.5° | 45° E | 5 km | Default example; supported by the optional example subset. |
| −89.9° | 0° E | 2 km | Near-pole inspection; download a separate covered subset. |
| −90° | 45° E | 1 km | Exact pole; longitude defines the chosen local meridian. |
| +89.5° | 45° E | 5 km | Requires a north-pole DEM; the included NASA downloader targets the south pole. |

These are exploration coordinates, not approved landing sites. Arbitrary lunar locations require a DEM covering the requested location and radius.

## Troubleshooting and limitations

| Problem | Action |
| --- | --- |
| No DEM configured / missing file | Configure `--dem` and `--dem-config`, or use the labeled demo. |
| Unexpected Earth CRS / missing CRS | Obtain correct lunar georeferencing from the source metadata; do not assign EPSG:4326. |
| Datum/frame/units rejected | Fill verified fields in the configuration; examples containing `REPLACE` are intentionally refused. |
| Point outside DEM | Choose covered coordinates or use a broader/regional product. |
| Partial coverage | The viewer leaves gaps and reports coverage. Download a wider crop to model the full radius. |
| Landing point is NoData | Choose a location with real measured/interpolated source coverage, or use another DEM. |
| Corrupt GeoTIFF / missing PDS label | Check the file and retain related `.LBL` files; a PDS conversion may be needed. |
| Browser has no WebGL2 | Enable hardware acceleration or use a supported browser. |
| Low frame rate | Select Low, disable shadows, reduce radius, and close other GPU-heavy applications. No hardware benchmark is claimed. |
| Shadow artifacts at grazing angles | Increase quality, use 1× exaggeration, and consider a larger high-resolution DEM for later physical validation. |
| Remote download fails | Check NASA availability and HTTPS/proxy/range support. Local DEM loading remains independent of network access. For managed proxies, preserve trusted CA settings; do not disable TLS verification. |
| Port in use | Add `--port 8001` and open the matching URL. |

The API processes one extraction at a time to bound memory use. High grids still contain hundreds of thousands of triangles; Medium or Low is appropriate for a normal laptop. The JSON transfer and grid are bounded, but a very large/high-resolution source may require substantial GDAL window I/O. There is no slope/safety solver, DEM downloader for every NASA product, global horizon model, Earth line-of-sight engine, or ephemeris-derived mission forecast in this MVP.

## Project layout

```text
lunar-terrain-simulator/
├── backend/
│   ├── config.py                 # Central conventions, limits, product assumptions
│   ├── coordinate_utils.py       # Lunar local CRS and input validation
│   ├── dem_loader.py             # Metadata checks and native elevation samples
│   ├── terrain_crop.py           # Bounded real-data extraction and payload
│   ├── synthetic.py              # Isolated, clearly labeled demo generator
│   ├── download_lola_subset.py   # Optional real NASA COG window downloader
│   ├── server.py                 # API + frontend + local Three.js
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── styles.css
│   ├── app.js                    # Controls, viewer, picking, statistics
│   ├── terrain.js                # Mesh, NoData topology, annotations, UVs
│   ├── coordinates.js            # Tangent geometry and hover coordinates
│   ├── lighting.js               # Directional Sun and fitted shadow maps
│   └── ephemeris.js               # Manual provider; explicit future interfaces
├── prototype/                     # Separate mission-planning interface prototype
├── data/README.md                # Data and product metadata instructions
├── tests/                        # Offline Python checks; tiny generated fixtures
├── scripts/                      # Node geometry and Chromium integration checks
├── dem_config.example.json
├── package.json / package-lock.json
├── requirements-dev.txt
└── README.md
```

DEM files, virtual environments, node_modules, local configuration, and generated screenshots are excluded by `.gitignore`. No large NASA dataset belongs in version control.
