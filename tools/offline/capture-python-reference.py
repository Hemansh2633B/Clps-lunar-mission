#!/usr/bin/env python3
"""Offline capture of the v1.11 Python terrain/horizon reference.

This is a migration tool, not a runtime or CI dependency of the future Rust app.
Run from the repository root with the v1.11 requirements-dev.txt environment:
    .venv/bin/python tools/offline/capture-python-reference.py

Every raster is deliberately synthetic and labelled as such.  No NASA data,
SPICE kernels, credentials, or network access are used.  The JSON files are
golden outputs from the unchanged Python implementation at the commit recorded
in manifest.json.  Regeneration is an explicit, reviewable action.
"""
from __future__ import annotations

import hashlib
import json
import platform
import subprocess
from pathlib import Path

import numpy as np
import pyproj
import rasterio
from rasterio.transform import from_origin

from backend.config import Settings
from backend.coordinate_utils import grid_to_lonlat, local_crs
from backend.dem_loader import open_dem
from backend.horizon import horizon_from_grid
from backend.terrain_crop import extract_terrain

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "fixtures" / "python-v1.11"
R = 1_737_400.0
OPTIONS = {
    "vertical_unit": "m",
    "value_kind": "elevation",
    "elevation_reference": "Synthetic migration fixture; no scientific datum",
    "lunar_reference_frame": "MOON_ME (DE421) — synthetic software fixture, not lunar observations",
    "elevation_reference_radius_m": R,
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")


def projected(name: str, kind: str, *, crs=None, scale: float = 1.0, offset: float = 0.0) -> Settings:
    n, spacing = 401, 100.0
    east = np.arange(n) * spacing - 20_000.0
    north = 20_000.0 - np.arange(n) * spacing
    x, y = np.meshgrid(east, north)
    if kind == "flat":
        heights = np.full((n, n), 100.0)
    elif kind in ("sloped", "scaled", "radius", "km"):
        heights = 100.0 + 0.01 * x + 0.02 * y
    elif kind == "crater":
        d = np.hypot(x - 1200.0, y + 700.0)
        heights = -1800.0 + 260.0 * np.exp(-((d - 2300.0) / 420.0) ** 2) - 350.0 * np.exp(-(d / 1600.0) ** 4)
    elif kind == "nodata":
        heights = 100.0 + 0.01 * x + 0.02 * y
        heights[170:185, 220:235] = -9999.0
    else:
        raise ValueError(kind)
    options = dict(OPTIONS)
    if kind == "scaled":
        options.update(scale=scale, offset=offset)
    if kind == "radius":
        heights += R
        options["value_kind"] = "radius"
    if kind == "km":
        heights /= 1000.0
        options["vertical_unit"] = "km"
    path = OUT / f"{name}.tif"
    with rasterio.open(
        path, "w", driver="GTiff", width=n, height=n, count=1, dtype="float32",
        crs=(crs or local_crs(-89.5, 45.0, R)).to_wkt(),
        transform=from_origin(-20_050.0, 20_050.0, spacing, spacing),
        nodata=-9999.0, compress="deflate",
    ) as ds:
        ds.write(heights.astype("float32"), 1)
        ds.scales = [scale]
        ds.offsets = [offset]
        ds.update_tags(LUNAR_SIM_SOURCE="SYNTHETIC", PURPOSE="CHANDRA v1.12 migration software fixture only")
    return Settings(path, options)


def geographic(name: str, left: float) -> Settings:
    ncols, nrows = 360, 50
    lons = left + np.arange(ncols) + 0.5
    heights = np.broadcast_to((100.0 + 20.0 * np.sin(np.deg2rad(lons))).astype("float32"), (nrows, ncols))
    path = OUT / f"{name}.tif"
    with rasterio.open(
        path, "w", driver="GTiff", width=ncols, height=nrows, count=1, dtype="float32",
        crs=local_crs(-89.5, 45.0, R).geodetic_crs.to_wkt(),
        transform=from_origin(left, -89.0, 1.0, 0.02), nodata=-9999.0, compress="deflate",
    ) as ds:
        ds.write(heights, 1)
        ds.update_tags(LUNAR_SIM_SOURCE="SYNTHETIC", PURPOSE="CHANDRA v1.12 migration software fixture only")
    return Settings(path, dict(OPTIONS))


def remote_cog() -> None:
    """A tiled COG large enough that a full-raster fallback is observable."""
    n = 1024
    y, x = np.mgrid[:n, :n].astype("float32")
    heights = (100.0 + 0.01 * (x - 512.0) + 0.02 * (512.0 - y)).astype("float32")
    path = OUT / "remote-cog.tif"
    with rasterio.open(
        path, "w", driver="COG", width=n, height=n, count=1, dtype="float32",
        crs=local_crs(-89.5, 45.0, R).to_wkt(), transform=from_origin(-51_200.0, 51_200.0, 100.0, 100.0),
        nodata=-9999.0, blocksize=256, compress="deflate", overview_resampling="bilinear",
    ) as ds:
        ds.write(heights, 1)
        ds.update_tags(LUNAR_SIM_SOURCE="SYNTHETIC", PURPOSE="CHANDRA v1.12 HTTP-range software fixture only")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    cases: list[tuple[str, Settings, float, float, str]] = []
    for kind in ("flat", "sloped", "crater", "nodata"):
        cases.append((kind, projected(kind, kind), -89.5, 45.0, "low"))
    cases.append(("scaled", projected("scaled", "sloped", scale=0.5, offset=10.0), -89.5, 45.0, "low"))
    cases.append(("radius", projected("radius", "radius"), -89.5, 45.0, "low"))
    cases.append(("km", projected("km", "km"), -89.5, 45.0, "low"))
    cases.append(("lon-wrap-0", geographic("lon-wrap-0", 0.0), -89.5, 359.0, "low"))
    cases.append(("lon-wrap-180", geographic("lon-wrap-180", -180.0), -89.5, 179.0, "low"))
    remote_cog()

    manifest = {
        "schema": "chandra-python-reference/1",
        "baseline_commit": subprocess.check_output(["git", "rev-parse", "9b7727776508f32c98cb14d8cb097d7326271a6c"], cwd=ROOT, text=True).strip(),
        "captured_with": {
            "python": platform.python_version(), "numpy": np.__version__,
            "rasterio": rasterio.__version__, "gdal": rasterio.__gdal_version__,
            "pyproj": pyproj.__version__, "proj": pyproj.__proj_version__,
        },
        "purpose": "Software parity only. Every raster is synthetic; none is lunar observation data.",
        "tolerances": {
            "elevations_m_abs": 0.01,
            "landing_elevation_m_abs": 0.001,
            "horizon_elevations_deg_abs": 0.001,
            "horizon_ranges_km_abs": 0.001,
            "coordinates_deg_abs": 1e-9,
            "local_distances_m_abs": 1e-6,
            "nodata_mask": "exact",
            "statistics_and_coverage": "exact after Python rounding",
            "note": "Existing v1.11 test tolerances; not widened for Rust.",
        },
        "cases": [],
    }
    for name, settings, lat, lon, quality in cases:
        qualities = [quality] + (["medium", "high"] if name == "sloped" else [])
        for q in qualities:
            data = extract_terrain(settings, lat, lon, 5.0, q)
            mask = horizon_from_grid(data, az_step_deg=15, eye_height_m=2.0)
            stem = f"{name}-{q}"
            write_json(OUT / f"{stem}.terrain.json", data)
            write_json(OUT / f"{stem}.horizon.json", mask)
        with open_dem(settings) as (_, info):
            pass
        config = dict(settings.dem_options)
        write_json(OUT / f"{name}.config.json", config)
        manifest["cases"].append({
            "name": name, "raster": f"{name}.tif", "raster_sha256": sha(settings.dem_path),
            "config": f"{name}.config.json", "latitude": lat, "longitude": lon,
            "radius_km": 5.0, "qualities": qualities,
        })
    manifest["remote_cog"] = {"raster": "remote-cog.tif", "sha256": sha(OUT / "remote-cog.tif"), "window": {"row_off": 500, "col_off": 500, "rows": 4, "cols": 4}}
    coordinates = []
    for lat, lon in [(-89.5, 45.0), (-90.0, 0.0), (-90.0, 175.0), (90.0, -45.0), (0.0, 179.99)]:
        for east, north in [(5000.0, 0.0), (0.0, 5000.0), (-5000.0, 0.0), (3000.0, 4000.0), (0.0, 0.0)]:
            x, y = grid_to_lonlat(east, north, lat, lon, R)
            coordinates.append({"latitude": lat, "longitude": lon, "east_m": east, "north_m": north, "result_longitude": float(x), "result_latitude": float(y)})
    write_json(OUT / "coordinates.json", coordinates)
    write_json(OUT / "manifest.json", manifest)
    print(f"Captured {len(manifest['cases'])} Python reference cases in {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
