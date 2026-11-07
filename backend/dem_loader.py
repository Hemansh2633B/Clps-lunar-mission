"""Open local GDAL-supported rasters; require lunar CRS and explicit vertical datum."""
from contextlib import contextmanager
import math
import numpy as np
import rasterio
from pyproj import CRS, Transformer
from .config import LATITUDE_CONVENTION, LUNAR_RADIUS_LIMITS_M, TerrainError


def inspect_dem(dataset, options):
    if dataset.count != 1:
        raise TerrainError("Use a single-band elevation raster, not imagery or a multiband raster.")
    if dataset.crs is None:
        raise TerrainError("DEM has no CRS. Supply verified lunar georeferencing with GDAL before loading it.")
    crs = CRS.from_wkt(dataset.crs.to_wkt())
    if not (crs.is_geographic or crs.is_projected) or crs.geodetic_crs is None:
        raise TerrainError("DEM needs a supported geographic or projected lunar CRS.")
    if crs.is_geographic and not math.isclose(crs.axis_info[0].unit_conversion_factor, math.pi / 180, abs_tol=1e-12):
        raise TerrainError("Geographic lunar raster coordinates must use degrees in this version.")
    ellipsoid = crs.ellipsoid
    a, b = ellipsoid.semi_major_metre, ellipsoid.semi_minor_metre
    if not LUNAR_RADIUS_LIMITS_M[0] <= a <= LUNAR_RADIUS_LIMITS_M[1]:
        raise TerrainError(f"Unexpected CRS body radius ({a:,.1f} m). An Earth CRS cannot be used for lunar terrain.")
    if not math.isclose(a, b, abs_tol=0.01):
        raise TerrainError("This version supports spherical lunar CRSs only. Verify/convert the DEM and latitude convention first.")
    reference = options.get("elevation_reference")
    if not isinstance(reference, str) or not reference.strip() or reference.strip().upper().startswith("REPLACE"):
        raise TerrainError("Set elevation_reference in --dem-config from the product label (datum is never inferred).")
    unit = options.get("vertical_unit")
    if unit not in ("m", "km"):
        raise TerrainError("Set vertical_unit to 'm' or 'km' in --dem-config after checking the product label.")
    kind = options.get("value_kind")
    if kind not in ("elevation", "radius"):
        raise TerrainError("Set value_kind to 'elevation' or 'radius' in --dem-config; confirm this in the product label.")
    reference_radius = options.get("elevation_reference_radius_m")
    if reference_radius is None:
        raise TerrainError("Set elevation_reference_radius_m explicitly; check the product's elevation datum.")
    try:
        reference_radius = float(reference_radius)
    except (TypeError, ValueError) as exc:
        raise TerrainError("elevation_reference_radius_m must be a finite lunar radius in meters.") from exc
    if not math.isfinite(reference_radius) or not LUNAR_RADIUS_LIMITS_M[0] <= reference_radius <= LUNAR_RADIUS_LIMITS_M[1]:
        raise TerrainError("elevation_reference_radius_m must be a lunar radius in meters.")
    try:
        scale = float(options.get("scale", dataset.scales[0]))
        offset = float(options.get("offset", dataset.offsets[0]))
    except (TypeError, ValueError) as exc:
        raise TerrainError("DEM scale and offset must be finite numbers.") from exc
    if not math.isfinite(scale) or not math.isfinite(offset) or scale == 0:
        raise TerrainError("DEM scale must be finite and nonzero; offset must be finite.")
    frame = options.get("lunar_reference_frame")
    if not isinstance(frame, str) or not frame.strip() or frame.strip().upper().startswith("REPLACE"):
        raise TerrainError("Set lunar_reference_frame from the product documentation (for example MOON_ME with its ephemeris realization).")
    if not math.isclose(crs.prime_meridian.longitude, 0.0, abs_tol=1e-10):
        raise TerrainError("This version requires a zero lunar reference meridian. Verify and convert this CRS first.")
    return {
        "filename": dataset.name.split("/")[-1].split("\\")[-1],
        "crs_name": crs.name, "crs_wkt": crs.to_wkt(),
        "lunar_radius_m": a,
        "elevation_reference_radius_m": reference_radius,
        "latitude_convention": LATITUDE_CONVENTION,
        "elevation_reference": reference.strip(), "vertical_unit": unit,
        "lunar_reference_frame": frame.strip(),
        "value_kind": kind, "scale": scale, "offset": offset,
        "source_resolution": list(dataset.res), "source_resolution_unit": crs.axis_info[0].unit_name,
        "width": dataset.width, "height": dataset.height,
        "synthetic": dataset.tags().get("LUNAR_SIM_SOURCE") == "SYNTHETIC",
    }


@contextmanager
def open_dem(settings):
    if settings.dem_path is None:
        raise TerrainError("No DEM configured. Start with --dem data/your_dem.tif --dem-config dem_config.json, or choose Synthetic Demo Mode.")
    if not settings.dem_path.is_file():
        raise TerrainError(f"DEM file does not exist: {settings.dem_path.name}. Check --dem and the data directory.")
    try:
        with rasterio.open(settings.dem_path) as dataset:
            info = inspect_dem(dataset, settings.dem_options)
            yield dataset, info
    except TerrainError:
        raise
    except (rasterio.errors.RasterioError, OSError) as exc:
        raise TerrainError(f"Cannot read DEM. Check that the raster is intact and its label/georeferencing is available. {exc}") from exc


def to_elevation_m(raw, info):
    values = (np.asarray(raw, dtype=np.float64) * info["scale"] + info["offset"])
    values *= 1000.0 if info["vertical_unit"] == "km" else 1.0
    if info["value_kind"] == "radius":
        values -= info["elevation_reference_radius_m"]
    return values


def landing_elevation(dataset, info, latitude, longitude):
    """Bilinear sample of the native raster; independent of displayed grid quality."""
    crs = CRS.from_wkt(info["crs_wkt"])
    x, y = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True).transform(longitude, latitude)
    if crs.is_geographic:
        # Accommodate a geographic raster stored with longitudes in 0…360.
        for candidate in (x, x + 360, x - 360):
            if dataset.bounds.left <= candidate <= dataset.bounds.right:
                x = candidate
                break
    col, row = (~dataset.transform) @ (x, y)
    if not (0 <= col < dataset.width and 0 <= row < dataset.height):
        raise TerrainError("Selected landing point is outside the DEM. Choose a coordinate covered by this product.")
    col -= 0.5
    row -= 0.5
    left, top = math.floor(col), math.floor(row)
    full_longitude = crs.is_geographic and math.isclose(dataset.bounds.right - dataset.bounds.left, 360, abs_tol=1e-5)
    if full_longitude and (left < 0 or left + 2 > dataset.width):
        sample = np.ma.hstack([dataset.read(1, window=rasterio.windows.Window((left + k) % dataset.width, top, 1, 2),
                                           boundless=top < 0 or top + 2 > dataset.height, masked=True) for k in range(2)])
    else:
        outside = left < 0 or top < 0 or left + 2 > dataset.width or top + 2 > dataset.height
        sample = dataset.read(1, window=rasterio.windows.Window(left, top, 2, 2), boundless=outside, masked=True)
    sample = np.ma.masked_invalid(sample)
    weights = np.array([[(1 - (col - left)) * (1 - (row - top)), (col - left) * (1 - (row - top))],
                        [(1 - (col - left)) * (row - top), (col - left) * (row - top)]])
    if np.any(np.ma.getmaskarray(sample) & (weights > 1e-10)):
        raise TerrainError("Landing point is on a DEM edge or NoData gap; its elevation cannot be interpolated.")
    elevation = float(np.sum(to_elevation_m(sample.filled(0), info) * weights))
    if not math.isfinite(elevation):
        raise TerrainError("DEM contains an invalid elevation at the landing point.")
    return elevation
