"""Deliberately artificial terrain, isolated from every real DEM code path."""
import numpy as np
from .config import DEFAULT_LUNAR_RADIUS_M, SYNTHETIC_WARNING
from .coordinate_utils import validate_location
from .terrain_crop import grid_coordinates, package_grid


def synthetic_terrain(latitude, longitude, radius_km, quality="medium"):
    lat, lon, radius_km, quality = validate_location(latitude, longitude, radius_km, quality)
    size, radius_m, _, x, y, _ = grid_coordinates(radius_km, quality)
    x, y = x / radius_m, y / radius_m
    d = np.hypot(x - 0.23, y + 0.12)
    # A crater, ridge, and smooth relief for mesh/shadow development only.
    elevations = (-1850 + 230 * np.exp(-((d - 0.43) / 0.075) ** 2)
                  - 320 * np.exp(-(d / 0.29) ** 4)
                  + 110 * np.exp(-((x + 0.6 + y * 0.3) / 0.11) ** 2)
                  + 25 * np.sin(8 * x) * np.cos(6 * y))
    info = {"filename": "Synthetic Demo Mode", "synthetic": True,
            "lunar_radius_m": DEFAULT_LUNAR_RADIUS_M,
            "elevation_reference_radius_m": DEFAULT_LUNAR_RADIUS_M,
            "elevation_reference": "Artificial test elevations; no scientific datum", "warning": SYNTHETIC_WARNING}
    return package_grid(elevations, float(elevations[size // 2, size // 2]), lat, lon, radius_km, quality, info, "synthetic")
