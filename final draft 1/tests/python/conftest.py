"""All generated rasters are synthetic test fixtures, never lunar observations."""
import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from backend.config import Settings
from backend.coordinate_utils import local_crs


@pytest.fixture
def plane_dem(tmp_path):
    path = tmp_path / "SYNTHETIC_TEST_PLANE.tif"
    n, spacing = 401, 100.0
    transform = from_origin(-20050, 20050, spacing, spacing)
    east = np.arange(n) * spacing - 20000
    north = 20000 - np.arange(n) * spacing
    x, y = np.meshgrid(east, north)
    heights = (100 + 0.01 * x + 0.02 * y).astype("float32")
    with rasterio.open(path, "w", driver="GTiff", width=n, height=n, count=1,
                       dtype="float32", crs=local_crs(-89.5, 45, 1737400).to_wkt(),
                       transform=transform, nodata=-9999.0) as ds:
        ds.write(heights, 1)
        ds.update_tags(LUNAR_SIM_SOURCE="SYNTHETIC")
    options = {"vertical_unit": "m", "value_kind": "elevation",
               "elevation_reference": "Synthetic fixture, no scientific datum",
               "lunar_reference_frame": "Synthetic test frame",
               "elevation_reference_radius_m": 1737400.0}
    return Settings(path, options)
