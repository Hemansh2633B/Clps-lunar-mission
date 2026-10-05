"""Coordinates always use the source DEM's lunar sphere, never an Earth EPSG CRS."""
import math
from pyproj import CRS, Transformer
from .config import QUALITY_GRIDS, RADIUS_LIMITS_KM, TerrainError


def validate_location(latitude, longitude, radius_km, quality="medium"):
    values = []
    for name, value in (("Latitude", latitude), ("Longitude", longitude), ("Radius", radius_km)):
        if isinstance(value, bool):
            raise TerrainError(f"{name} must be a finite number.")
        try:
            value = float(value)
        except (ValueError, TypeError) as exc:
            raise TerrainError(f"{name} must be a finite number.") from exc
        if not math.isfinite(value):
            raise TerrainError(f"{name} must be a finite number.")
        values.append(value)
    lat, lon, radius = values
    if not -90 <= lat <= 90:
        raise TerrainError("Latitude must be between -90 and +90 degrees.")
    if not -180 <= lon <= 360:
        raise TerrainError("Longitude must be in -180…180 or 0…360 degrees, east-positive.")
    if not RADIUS_LIMITS_KM[0] <= radius <= RADIUS_LIMITS_KM[1]:
        raise TerrainError(f"Radius must be between {RADIUS_LIMITS_KM[0]} and {RADIUS_LIMITS_KM[1]} km.")
    if not isinstance(quality, str) or quality not in QUALITY_GRIDS:
        raise TerrainError("Terrain quality must be low, medium, or high.")
    return lat, (lon + 180.0) % 360.0 - 180.0, radius, quality


def local_crs(latitude, longitude, lunar_radius_m):
    return CRS.from_proj4(
        f"+proj=aeqd +lat_0={latitude} +lon_0={longitude} "
        f"+R={lunar_radius_m} +units=m +no_defs +type=crs"
    )


def grid_to_lonlat(east_m, north_m, latitude, longitude, lunar_radius_m):
    crs = local_crs(latitude, longitude, lunar_radius_m)
    return Transformer.from_crs(crs, crs.geodetic_crs, always_xy=True).transform(east_m, north_m)
