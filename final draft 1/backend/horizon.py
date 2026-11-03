"""Ray-marched local horizon masks from an extracted DEM grid.

This is a geometric terrain horizon relative to the landing tangent frame.
It does not validate the DEM body-frame realization against an ephemeris frame.
"""
import math
from .config import TerrainError
from .synthetic import synthetic_terrain
from .terrain_crop import extract_terrain


def _sample(grid, east, north, radius_m):
    n = grid["size"]
    spacing = grid["spacing_m"]
    col = (east + radius_m) / spacing
    row = (radius_m - north) / spacing
    c = math.floor(col)
    r = math.floor(row)
    if c < 0 or r < 0 or c >= n - 1 or r >= n - 1:
        return None
    heights = [grid["elevations_m"][r * n + c], grid["elevations_m"][r * n + c + 1],
               grid["elevations_m"][(r + 1) * n + c], grid["elevations_m"][(r + 1) * n + c + 1]]
    if any(h is None for h in heights):
        return None
    u = col - c
    v = row - r
    return heights[0] * (1 - u) * (1 - v) + heights[1] * u * (1 - v) + heights[2] * (1 - u) * v + heights[3] * u * v


def horizon_from_grid(data, az_step_deg=2, eye_height_m=2.0):
    try:
        az_step = float(az_step_deg)
        eye = float(eye_height_m)
    except (TypeError, ValueError) as exc:
        raise TerrainError("az_step_deg and eye_height_m must be numbers.") from exc
    if not (1 <= az_step <= 15) or 360 % int(az_step) != 0:
        raise TerrainError("az_step_deg must divide 360 and be between 1 and 15 degrees.")
    if not (0 <= eye <= 50):
        raise TerrainError("eye_height_m must be between 0 and 50 meters.")
    az_step = int(az_step)
    grid = data["grid"]
    radius_m = data["radius_km"] * 1000
    spacing = grid["spacing_m"]
    lunar_radius = data["source"]["lunar_radius_m"]
    datum_radius = data["source"]["elevation_reference_radius_m"]
    observer_height = data["landing_elevation_m"] + eye
    azimuths = list(range(0, 360, az_step))
    elevations = []
    coverage = []
    ranges = []
    for az in azimuths:
        bearing = math.radians(az)
        best = -90.0
        best_range = 0.0
        valid = 0
        total = 0
        distance = spacing
        while distance <= radius_m + 1e-6:
            total += 1
            east = distance * math.sin(bearing)
            north = distance * math.cos(bearing)
            h = _sample(grid, east, north, radius_m)
            if h is not None:
                valid += 1
                angle = distance / lunar_radius
                radial = datum_radius + h
                scale = radial * math.sin(angle) / distance if distance > 0 else 1
                up = radial * math.cos(angle) - (datum_radius + observer_height)
                horizontal = distance * scale
                elevation = math.degrees(math.atan2(up, horizontal))
                if elevation > best:
                    best = elevation
                    best_range = distance
            distance += max(spacing * 0.5, 1.0)
        elevations.append(round(best, 4))
        coverage.append(round(100 * valid / total, 2) if total else 0.0)
        ranges.append(round(best_range / 1000, 4))
    return {
        "latitude": data["latitude"], "longitude": data["longitude"],
        "radius_km": data["radius_km"], "eye_height_m": eye,
        "azimuth_step_deg": az_step, "azimuths_deg": azimuths,
        "elevations_deg": elevations, "ray_coverage_percent": coverage,
        "max_obstacle_range_km": ranges,
        "mean_coverage_percent": round(sum(coverage) / len(coverage), 2),
        "synthetic": data["synthetic"], "source": data["source"],
        "model": "Ray-marched DEM grid horizon in the landing tangent frame; spherical curvature included. NoData rays are reported, never filled.",
        "frame_note": "Verify the DEM lunar_reference_frame matches the ephemeris body frame before using this mask for mission visibility.",
    }


def extract_horizon(settings, body):
    args = (body.get("latitude"), body.get("longitude"), body.get("radius_km"), body.get("quality", "medium"))
    mode = body.get("mode", "real")
    if mode == "synthetic":
        data = synthetic_terrain(*args)
    elif mode == "real":
        data = extract_terrain(settings, *args)
    else:
        raise TerrainError("Mode must be real or synthetic.")
    return horizon_from_grid(data, body.get("az_step_deg", 2), body.get("eye_height_m", 2))
