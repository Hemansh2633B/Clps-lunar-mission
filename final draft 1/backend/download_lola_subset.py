"""Optional NASA COG window download. Never downloads the entire Moon raster."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import ssl
import urllib.request
import numpy as np
from pyproj import CRS, Transformer
import rasterio
from rasterio.windows import Window
from .config import (TerrainError, LOLA_COG_URL, LOLA_PRODUCT_PAGE,
                     LOLA_SUBSET_ASSUMPTIONS, MAX_SUBSET_PIXELS, PROJECT_ROOT)
from .coordinate_utils import local_crs, validate_location
from .dem_loader import inspect_dem, landing_elevation


def download_subset(latitude, longitude, radius_km, output, config_output):
    lat, lon, radius, _ = validate_location(latitude, longitude, radius_km)
    output, config_output = Path(output), Path(config_output)
    if output.exists() or config_output.exists():
        raise TerrainError("Output already exists. Choose new --output and --config-output paths to preserve existing data.")
    if output.resolve() == config_output.resolve():
        raise TerrainError("Raster and configuration must use different output paths.")
    # Refuse a server that ignores range requests before opening a large raster.
    # Isolate the tiny probe from GDAL's URL cache: some HTTP proxies otherwise
    # reuse the probe's 16-byte Content-Length for later raster range reads.
    probe = urllib.request.Request(LOLA_COG_URL + "?lunar_terrain_range_probe=1", headers={"Range": "bytes=0-15"})
    trust_file = (os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
                  or os.environ.get("GDAL_CURL_CA_BUNDLE") or ssl.get_default_verify_paths().cafile)
    context = ssl.create_default_context(cafile=trust_file)
    with urllib.request.urlopen(probe, timeout=30, context=context) as response:
        if response.status != 206 or not response.headers.get("Content-Range"):
            raise TerrainError("NASA server did not honor HTTP range reads. Download a regional DEM separately; full-raster fallback is disabled.")
        response.read(16)
    options = dict(LOLA_SUBSET_ASSUMPTIONS)
    env = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_TIMEOUT=30,
               GDAL_HTTP_MAX_RETRY=1, GDAL_HTTP_RETRY_DELAY=1,
               GDAL_HTTP_MULTIRANGE="SERIAL")
    if trust_file:
        env["GDAL_CURL_CA_BUNDLE"] = trust_file
    with rasterio.Env(**env):
        with rasterio.open(LOLA_COG_URL) as source:
            info = inspect_dem(source, options)
            target = local_crs(lat, lon, info["lunar_radius_m"])
            transform = Transformer.from_crs(target, CRS.from_wkt(source.crs.to_wkt()), always_xy=True)
            # Sample the square footprint including edges; extra pixels provide a
            # bilinear interpolation halo. The source projection is unchanged.
            extent = radius * 1000 + 2 * max(source.res)
            axis = np.linspace(-extent, extent, 65)
            east, north = np.meshgrid(axis, axis)
            x, y = transform.transform(east, north)
            if not np.all(np.isfinite(x)) or not np.all(np.isfinite(y)):
                raise TerrainError("Requested area cannot be mapped into this NASA polar product.")
            window = rasterio.windows.from_bounds(float(x.min()) - source.res[0], float(y.min()) - source.res[1],
                                                 float(x.max()) + source.res[0], float(y.max()) + source.res[1], source.transform)
            left, top = math.floor(window.col_off), math.floor(window.row_off)
            width = math.ceil(window.col_off + window.width) - left
            height = math.ceil(window.row_off + window.height) - top
            window = Window(left, top, width, height)
            if left < 0 or top < 0 or left + width > source.width or top + height > source.height:
                raise TerrainError("Requested square extends outside this NASA south-pole product. Use a covered location or a smaller radius.")
            if width * height > MAX_SUBSET_PIXELS:
                raise TerrainError("Requested subset exceeds the download memory limit. Choose a smaller radius.")
            values = source.read(1, window=window)
            native_landing = landing_elevation(source, info, lat, lon)
            profile = source.profile.copy()
            profile.update(width=width, height=height, transform=source.window_transform(window),
                           compress="deflate", tiled=True, blockxsize=256, blockysize=256)
            output.parent.mkdir(parents=True, exist_ok=True)
            with rasterio.open(output, "w", **profile) as destination:
                destination.write(values, 1)
                destination.scales = source.scales
                destination.offsets = source.offsets
                destination.update_tags(**source.tags())
                destination.update_tags(SOURCE_URL=LOLA_COG_URL, SOURCE_PRODUCT_PAGE=LOLA_PRODUCT_PAGE,
                                        LUNAR_REFERENCE_FRAME=options["lunar_reference_frame"],
                                        PROCESSING="Native-resolution source subset; original values, CRS, and NoData retained")
    try:
        options["dem_path"] = output.resolve().relative_to(PROJECT_ROOT).as_posix()
    except ValueError:
        options["dem_path"] = str(output.resolve())
    options["subset_provenance"] = {
        "latitude": lat, "longitude": lon, "analysis_radius_km": radius,
        "source_pixel_window": [left, top, width, height],
        "downloaded_utc": datetime.now(timezone.utc).isoformat(),
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "native_landing_elevation_m": native_landing,
        "scientific_validation": "Not independently validated; review source product documentation.",
    }
    # Check that no crop/serialization step changed the native landing height.
    with rasterio.open(output) as subset:
        cropped_info = inspect_dem(subset, options)
        cropped_landing = landing_elevation(subset, cropped_info, lat, lon)
        if not math.isclose(native_landing, cropped_landing, abs_tol=1e-6):
            raise TerrainError("Downloaded subset did not preserve the landing elevation.")
    config_output.parent.mkdir(parents=True, exist_ok=True)
    config_output.write_text(json.dumps(options, indent=2) + "\n", encoding="utf-8")
    return options


def main():
    parser = argparse.ArgumentParser(description="Download a small native-resolution subset of NASA's 20 m/pixel LOLA south-pole COG")
    parser.add_argument("--latitude", type=float, default=-89.5)
    parser.add_argument("--longitude", type=float, default=45)
    parser.add_argument("--radius", type=float, default=5, help="Covered analysis radius in km")
    parser.add_argument("--output", default="data/lola_example_south_pole.tif")
    parser.add_argument("--config-output", default="data/lola_example_config.json")
    args = parser.parse_args()
    try:
        options = download_subset(args.latitude, args.longitude, args.radius, args.output, args.config_output)
    except (TerrainError, OSError, rasterio.errors.RasterioError) as exc:
        parser.exit(1, f"Subset download failed: {exc}\n")
    size = Path(args.output).stat().st_size / 1_000_000
    print(f"Saved NASA LOLA subset ({size:.2f} MB): {args.output}")
    print(f"Native landing elevation: {options['subset_provenance']['native_landing_elevation_m']:.3f} m")
    print(f"Run: python -m backend.server --dem-config {args.config_output}")
    print("Source heights and CRS are preserved. Scientific mission accuracy has not been independently validated.")


if __name__ == "__main__":
    main()
