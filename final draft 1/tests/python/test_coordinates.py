import numpy as np
import pytest
from pyproj import Geod, Transformer
from backend.config import DEFAULT_LUNAR_RADIUS_M, TerrainError
from backend.coordinate_utils import grid_to_lonlat, local_crs, validate_location
from backend.terrain_crop import grid_coordinates


@pytest.mark.parametrize("longitude,expected", [(45, 45), (359, -1), (360, 0), (180, -180), (-180, -180)])
def test_longitude_conventions(longitude, expected):
    assert validate_location(-89.5, longitude, 5)[1] == expected


@pytest.mark.parametrize("lat,lon,radius,quality", [
    (-91, 45, 5, "medium"), (91, 45, 5, "medium"),
    (-89.5, 361, 5, "medium"), (-89.5, -181, 5, "medium"),
    (-89.5, 45, 0.49, "medium"), (-89.5, 45, 20.1, "medium"),
    (float("nan"), 45, 5, "medium"), (-89.5, float("inf"), 5, "medium"),
    (-89.5, 45, "not-a-number", "medium"), (True, 45, 5, "medium"),
    (-89.5, 45, 5, "ultra"), (-89.5, 45, 5, {}),
])
def test_invalid_coordinates_are_actionable(lat, lon, radius, quality):
    with pytest.raises(TerrainError):
        validate_location(lat, lon, radius, quality)


@pytest.mark.parametrize("lat,lon", [(-89.5, 45), (-90, 0), (-90, 175), (90, -45), (0, 179.99)])
def test_local_radius_uses_lunar_geodesic(lat, lon):
    east = np.array([5000.0, 0, -5000, 3000])
    north = np.array([0.0, 5000, 0, 4000])
    lons, lats = grid_to_lonlat(east, north, lat, lon, DEFAULT_LUNAR_RADIUS_M)
    geod = Geod(a=DEFAULT_LUNAR_RADIUS_M, b=DEFAULT_LUNAR_RADIUS_M)
    _, _, distances = geod.inv(np.full(4, lon), np.full(4, lat), lons, lats)
    np.testing.assert_allclose(distances, 5000, atol=1e-6)
    local = local_crs(lat, lon, DEFAULT_LUNAR_RADIUS_M)
    x, y = Transformer.from_crs(local.geodetic_crs, local, always_xy=True).transform(lon, lat)
    assert abs(x) < 1e-6 and abs(y) < 1e-6


@pytest.mark.parametrize("quality,n", [("low", 129), ("medium", 257), ("high", 513)])
def test_grid_radius_and_landing_position(quality, n):
    size, radius_m, spacing, east, north, disk = grid_coordinates(5, quality)
    assert size == n
    assert radius_m == 5000
    assert spacing * (n - 1) == pytest.approx(10000)
    assert east[n // 2, n // 2] == 0
    assert north[n // 2, n // 2] == 0
    assert disk[n // 2, n // 2]
    assert np.max(np.hypot(east[disk], north[disk])) == pytest.approx(5000)
    assert not disk[0, 0]
