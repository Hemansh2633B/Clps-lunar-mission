# Local lunar DEM files

Put regional DEMs here, for example `data/lunar_south_pole_dem.tif`. Raster files and generated configuration/provenance files in this directory are ignored by version control; this README is retained.

**Recommended format:** single-band GeoTIFF with a valid lunar geographic or projected CRS, affine georeferencing, and correct NoData metadata. GDAL-readable PDS `.IMG` products can work when their associated labels remain available and GDAL preserves their lunar metadata. Convert unsupported products using verified source metadata before loading them. Imagery, hillshade, uncertainty, slope, and LOLA observation-count rasters are not elevation rasters.

Obtain south-pole **LDEM** products from [NASA Goddard PGDA](https://pgda.gsfc.nasa.gov/products/90), [LOLA PDS](https://pds-geosciences.wustl.edu/missions/lro/lola.htm), or regional DTMs from [LROC](https://wms.lroc.asu.edu/lroc/rdr_product_select). Keep the product label and documentation.

The application accepts spherical lunar CRSs with a radius around 1,737.4 km and a zero reference meridian. It uses the radius and projection in the raster's metadata, and requires explicit vertical and body-frame information. Earth EPSG:4326, missing CRS, unsupported ellipsoids, unknown vertical units/datum, and unfilled template metadata are rejected.

Copy `dem_config.example.json` to `dem_config.json` in the project root. Set:

- `dem_path`: local raster path, relative to the project root or absolute.
- `vertical_unit`: `m` or `km`, confirmed in the product label.
- `value_kind`: `elevation` above a spherical datum, or `radius` from the Moon's center.
- `elevation_reference`: the product's documented vertical datum, written explicitly.
- `elevation_reference_radius_m`: the verified radial reference sphere, in meters.
- `lunar_reference_frame`: documented body-fixed frame and realization, such as MOON_ME / DE421 for the selected NASA PGDA product.
- Optional `scale` and `offset`: overrides only when the product requires them and GDAL's band metadata does not retain them. Defaults come from the raster metadata, not an inferred NASA naming convention.

From the project root, start both backend and frontend with:

```bash
python -m backend.server --dem-config dem_config.json
```

For a small, actual NASA LOLA example without a full polar download:

```bash
python -m backend.download_lola_subset --latitude -89.5 --longitude 45 --radius 5
python -m backend.server --dem-config data/lola_example_config.json
```

The downloader retains original pixel values, CRS, and NoData in a cropped GeoTIFF. It writes the assumed product datum/frame plus source URL, window, download time, checksum, and native-landing consistency check. Verify these assumptions against the product documentation before mission use. It preserves existing files; use different output filenames for additional areas.

The example subset covers one region only. A larger analysis radius or another location needs a corresponding DEM. Missing coverage is shown as a gap; real mode does not generate missing terrain. Without a DEM, select the explicitly labeled Synthetic Demo Mode.

See the root README for Windows instructions, scientific conventions, coordinate handling, tests, limitations, and future SPICE integration.
