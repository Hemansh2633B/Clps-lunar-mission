# Local lunar DEM files

Put regional DEMs here, for example `data/lunar_south_pole_dem.tif`. Raster files and generated configuration/provenance files in this directory are ignored by version control; this README is retained. DEMs acquired through the Terrain Lab are stored in `data/acquired/`.

## Supported rasters

The native terrain engine reads a deliberately closed set of formats and refuses everything else with an explicit message (see `docs/scientific-method.md` §14):

- **Container:** single-band GeoTIFF or BigTIFF, strips or tiles (cloud-optimised GeoTIFFs included).
- **Compression:** none, LZW, Deflate or PackBits. JPEG, LERC and ZSTD are not supported.
- **Samples:** 8- to 64-bit integers or IEEE floats, with GDAL NoData and optional scale/offset.
- **Coordinate system:** a spherical lunar CRS with a radius between 1,700 and 1,800 km and a zero reference meridian — geographic, polar stereographic, oblique stereographic, azimuthal equidistant or equirectangular.

Not supported: PDS `.IMG`, multi-band rasters, rasters with internal mask IFDs, ellipsoidal or Earth CRSs (for example EPSG:4326), and any other projection. v1.11 opened some of these through GDAL; convert them first, for example:

```bash
gdal_translate -of GTiff -co COMPRESS=DEFLATE -co TILED=YES input.img output.tif
```

Imagery, hillshade, uncertainty, slope and LOLA observation-count rasters are not elevation rasters and must not be loaded as DEMs.

Obtain south-pole **LDEM** products from [NASA Goddard PGDA](https://pgda.gsfc.nasa.gov/products/90), [LOLA PDS](https://pds-geosciences.wustl.edu/missions/lro/lola.htm), or regional DTMs from [LROC](https://wms.lroc.asu.edu/lroc/rdr_product_select). Keep the product label and documentation.

## Configuration

The application uses the radius and projection in the raster's metadata, and requires explicit vertical and body-frame information. A missing CRS, unknown vertical units or datum, and unfilled template metadata are rejected.

Copy `dem_config.example.json` to `dem_config.json` in the project root. Set:

- `dem_path`: local raster path, relative to the project root or absolute.
- `vertical_unit`: `m` or `km`, confirmed in the product label.
- `value_kind`: `elevation` above a spherical datum, or `radius` from the Moon's centre.
- `elevation_reference`: the product's documented vertical datum, written explicitly.
- `elevation_reference_radius_m`: the verified radial reference sphere, in metres.
- `lunar_reference_frame`: documented body-fixed frame and realisation, such as MOON_ME / DE421 for the NASA PGDA polar products.
- Optional `scale` and `offset`: overrides only when the product requires them and the raster's own metadata does not carry them. Defaults come from the raster metadata, not from an inferred NASA naming convention.

From the repository root, start the API and the console together with:

```bash
npm run dev:full -- --dem-config dem_config.json
```

Or run the API alone with `npm run dev:api -- --dem-config dem_config.json` and the console separately with `npm run dev`. Both need a Go toolchain (1.23 or newer); see the root README.

## A real NASA LOLA subset without a full polar download

From the Terrain Lab, open **Datasets**, choose a product, a centre and a radius, review the plan (pixel window and download size), and confirm. Or from the command line:

```bash
npm run lola:subset -- --latitude -89.5 --longitude 45 --radius 5 --dry-run   # coverage check and size, nothing downloaded
npm run lola:subset -- --latitude -89.5 --longitude 45 --radius 5
npm run dev:api -- --dem-config data/lola_example_config.json
```

`--product` selects one of the five allowlisted PGDA product-90 mosaics (default `lola-ldem-80s-20mpp-adj`; `GET /api/datasets` lists them). The downloader reads only the blocks it needs by HTTP range requests, keeps the original pixel values, CRS and NoData in a cropped GeoTIFF, and writes the assumed product datum/frame plus source URL, pixel window, download time, checksum and a native-landing consistency check. **Verify those assumptions against the product documentation before mission use.** Existing files are never overwritten; use different output names for additional areas.

A subset covers one region only. A larger analysis radius or another location needs another subset. Missing coverage is shown as a gap; real mode never generates missing terrain. Without a DEM, select the explicitly labelled Synthetic Demo Mode.

## Software verification fixture

`npm run fixture:lola` writes a small LOLA-derived 512×512 south-pole GeoTIFF plus config/provenance into `data/verification/` (ignored by Git). It is a **software verification fixture only**: a third-party bilinear downsample of NASA `LDEM_80S_20MPP_ADJ.TIF` whose invalid pixels were filled by the derivative author. It does not preserve NoData coverage and must not be used for scientific illumination studies.

```bash
npm run fixture:lola
npm run build
npm run dev:api -- --dem-config data/verification/lola_verification_config.json --port 8001
npm run test:real-dem
```

See the root README for setup and tests, `docs/scientific-method.md` for conventions, frame handling and the native engine's agreement with GDAL, and `docs/verification.md` for executed evidence and fixture caveats.
