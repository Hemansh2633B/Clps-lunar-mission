"""Resample only the requested region into a bounded, landing-centered grid."""
import numpy as np
from affine import Affine
from pyproj import CRS
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from .config import QUALITY_GRIDS, TerrainError
from .coordinate_utils import local_crs, validate_location
from .dem_loader import landing_elevation, open_dem, to_elevation_m


def grid_coordinates(radius_km, quality):
    size = QUALITY_GRIDS[quality]
    radius_m = radius_km * 1000
    east = np.linspace(-radius_m, radius_m, size)
    north = np.linspace(radius_m, -radius_m, size)
    x, y = np.meshgrid(east, north)
    disk = np.hypot(x, y) <= radius_m + 1e-6
    return size, radius_m, 2 * radius_m / (size - 1), x, y, disk


def package_grid(elevations, landing_m, lat, lon, radius_km, quality, info, mode):
    size, radius_m, spacing, _, _, disk = grid_coordinates(radius_km, quality)
    valid = np.isfinite(elevations) & disk
    count = int(valid.sum())
    if count < 4:
        raise TerrainError("This DEM has insufficient valid data inside the selected analysis radius.")
    values = elevations[valid]
    flat = np.where(valid, np.round(elevations, 3), np.nan).ravel()
    flat[size // 2 * size + size // 2] = landing_m
    return {
        "mode": mode, "synthetic": mode == "synthetic" or info.get("synthetic", False),
        "latitude": lat, "longitude": lon, "radius_km": radius_km,
        "grid": {"size": size, "spacing_m": spacing, "order": "row-major; rows north-to-south, columns west-to-east",
                 "elevations_m": [float(v) if np.isfinite(v) else None for v in flat]},
        "landing_elevation_m": landing_m,
        "statistics": {"minimum_m": float(values.min()), "maximum_m": float(values.max()),
                       "range_m": float(np.ptp(values)), "coverage_percent": round(100 * count / int(disk.sum()), 2)},
        "source": info,
    }


def extract_terrain(settings, latitude, longitude, radius_km, quality="medium"):
    lat, lon, radius_km, quality = validate_location(latitude, longitude, radius_km, quality)
    size, radius_m, spacing, _, _, _ = grid_coordinates(radius_km, quality)
    with open_dem(settings) as (dataset, info):
        landing_m = landing_elevation(dataset, info, lat, lon)
        target = local_crs(lat, lon, info["lunar_radius_m"])
        # Output pixel centers include x=y=0 exactly. GDAL fetches source windows.
        transform = from_origin(-radius_m - spacing / 2, radius_m + spacing / 2, spacing, spacing)
        def warp(source_transform=None):
            overrides = {"src_transform": source_transform} if source_transform is not None else {}
            with WarpedVRT(dataset, crs=target.to_wkt(), transform=transform,
                           width=size, height=size, resampling=Resampling.bilinear,
                           dtype="float32", nodata=float("nan"), warp_mem_limit=64, **overrides) as vrt:
                return vrt.read(1, masked=True).filled(np.nan)

        raw = warp()
        if CRS.from_wkt(info["crs_wkt"]).is_geographic:
            # GDAL handles ±180 rasters, but 0…360 rasters need a second longitude
            # representation at the seam. This is a virtual shift of real pixels,
            # never generated data or a full-raster read.
            shift = -360 if dataset.bounds.right > 180 else (360 if dataset.bounds.left < -180 else 0)
            if shift and np.isnan(raw).any():
                alias = warp(Affine.translation(shift, 0) @ dataset.transform)
                raw = np.where(np.isfinite(raw), raw, alias)
        elevations = to_elevation_m(raw, info)
        # Anchor the exact native-resolution landing sample even after resampling.
        elevations[size // 2, size // 2] = landing_m
        return package_grid(elevations, landing_m, lat, lon, radius_km, quality, info, "real")
