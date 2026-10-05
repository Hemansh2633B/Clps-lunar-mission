import pytest
import numpy as np
import rasterio
from rasterio.transform import from_origin
from pyproj import CRS
from backend.config import Settings, TerrainError
from backend.coordinate_utils import local_crs
from backend.dem_loader import open_dem, landing_elevation
from backend.terrain_crop import extract_terrain


def test_native_landing_elevation(plane_dem):
    with open_dem(plane_dem) as (ds, info):
        assert landing_elevation(ds, info, -89.5, 45) == pytest.approx(100, abs=0.001)


def test_window_crop_and_exact_center(plane_dem):
    result = extract_terrain(plane_dem, -89.5, 45, 5, "low")
    n = result["grid"]["size"]
    heights = result["grid"]["elevations_m"]
    assert n == 129
    assert heights[n // 2 * n + n // 2] == pytest.approx(100, abs=0.001)
    assert heights[0] is None  # Square corners outside analysis disk are omitted.
    assert result["statistics"]["coverage_percent"] == 100
    assert result["synthetic"] is True
    assert result["statistics"]["range_m"] > 200


@pytest.mark.parametrize("quality", ["low", "medium", "high"])
def test_elevation_plane_is_preserved(plane_dem, quality):
    result = extract_terrain(plane_dem, -89.5, 45, 5, quality)
    n = result["grid"]["size"]
    axis = np.linspace(-5000, 5000, n)
    x, y = np.meshgrid(axis, -axis)
    expected = 100 + 0.01 * x + 0.02 * y
    raw = result["grid"]["elevations_m"]
    actual = np.array([np.nan if v is None else v for v in raw]).reshape(n, n)
    np.testing.assert_allclose(actual[np.isfinite(actual)], expected[np.isfinite(actual)], atol=0.01)
    assert result["landing_elevation_m"] == pytest.approx(100, abs=0.001)


def test_outside_dem(plane_dem):
    with pytest.raises(TerrainError, match="outside the DEM"):
        extract_terrain(plane_dem, -80, 45, 5)


def test_nodata_landing_is_rejected(plane_dem):
    with rasterio.open(plane_dem.dem_path, "r+") as ds:
        ds.write(np.full((3, 3), -9999, dtype="float32"), 1, window=rasterio.windows.Window(199, 199, 3, 3))
    with pytest.raises(TerrainError, match="NoData gap"):
        extract_terrain(plane_dem, -89.5, 45, 5)


def test_nodata_elsewhere_remains_a_gap(plane_dem):
    with rasterio.open(plane_dem.dem_path, "r+") as ds:
        ds.write(np.full((15, 15), -9999, dtype="float32"), 1, window=rasterio.windows.Window(220, 170, 15, 15))
    result = extract_terrain(plane_dem, -89.5, 45, 5, "low")
    assert 85 < result["statistics"]["coverage_percent"] < 100
    n = result["grid"]["size"]
    # (east=2500, north=2500) is inside the deliberate source hole.
    i = round((5000 - 2500) / result["grid"]["spacing_m"])
    j = round((5000 + 2500) / result["grid"]["spacing_m"])
    assert result["grid"]["elevations_m"][i * n + j] is None
    assert result["landing_elevation_m"] == pytest.approx(100)


@pytest.mark.parametrize("field", ["elevation_reference", "vertical_unit", "value_kind", "elevation_reference_radius_m", "lunar_reference_frame"])
def test_missing_vertical_or_frame_metadata_is_rejected(plane_dem, field):
    plane_dem.dem_options.pop(field)
    with pytest.raises(TerrainError, match=field):
        with open_dem(plane_dem):
            pass


def test_unknown_unit_and_unfilled_example_rejected(plane_dem):
    plane_dem.dem_options["vertical_unit"] = "feet"
    with pytest.raises(TerrainError, match="vertical_unit"):
        with open_dem(plane_dem):
            pass
    plane_dem.dem_options["vertical_unit"] = "m"
    plane_dem.dem_options["elevation_reference"] = "REPLACE with actual datum"
    with pytest.raises(TerrainError, match="elevation_reference"):
        with open_dem(plane_dem):
            pass


def test_band_scale_and_offset_applied_once(plane_dem):
    with rasterio.open(plane_dem.dem_path, "r+") as ds:
        ds.scales = [0.5]
        ds.offsets = [10]
    result = extract_terrain(plane_dem, -89.5, 45, 5, "low")
    assert result["landing_elevation_m"] == pytest.approx(60)
    assert result["source"]["scale"] == 0.5
    center = result["grid"]["size"] ** 2 // 2
    assert result["grid"]["elevations_m"][center] == pytest.approx(60)


def test_radius_values_converted_to_elevation(plane_dem):
    with rasterio.open(plane_dem.dem_path, "r+") as ds:
        ds.write(ds.read(1) + 1737400, 1)
    plane_dem.dem_options["value_kind"] = "radius"
    result = extract_terrain(plane_dem, -89.5, 45, 5, "low")
    assert result["landing_elevation_m"] == pytest.approx(100)


@pytest.mark.parametrize("bad_crs", ["EPSG:4326", "+proj=longlat +a=1737400 +b=1736000 +type=crs"])
def test_earth_and_nonspherical_crs_rejected(plane_dem, bad_crs):
    with rasterio.open(plane_dem.dem_path, "r+") as ds:
        ds.crs = CRS.from_user_input(bad_crs).to_wkt()
    with pytest.raises(TerrainError, match="CRS"):
        with open_dem(plane_dem):
            pass


@pytest.mark.parametrize("left,longitude", [(0, 359), (0, 359.9), (0, 0.1), (-180, -179), (-180, 179), (-180, 179.9)])
def test_geographic_dem_longitude_wrap(tmp_path, plane_dem, left, longitude):
    path = tmp_path / "SYNTHETIC_GEOGRAPHIC.tif"
    ncols, nrows = 360, 50
    lons = left + np.arange(ncols) + 0.5
    heights = np.broadcast_to((100 + 20 * np.sin(np.deg2rad(lons))).astype('float32'), (nrows, ncols))
    with rasterio.open(path, 'w', driver='GTiff', count=1, width=ncols, height=nrows,
                       dtype='float32', crs=local_crs(-89.5, 45, 1737400).geodetic_crs.to_wkt(),
                       transform=from_origin(left, -89, 1, 0.02), nodata=-9999) as ds:
        ds.write(heights, 1)
        ds.update_tags(LUNAR_SIM_SOURCE="SYNTHETIC")
    settings = Settings(path, plane_dem.dem_options)
    result = extract_terrain(settings, -89.5, longitude, 5, 'low')
    assert result['statistics']['coverage_percent'] == 100
    assert result['landing_elevation_m'] == pytest.approx(100 + 20 * np.sin(np.deg2rad(longitude)), abs=0.01)


@pytest.mark.parametrize("crs,count,message", [(None, 1, 'no CRS'), ('EPSG:4326', 2, 'single-band')])
def test_missing_crs_and_multiband_rejected(tmp_path, plane_dem, crs, count, message):
    path = tmp_path / 'invalid.tif'
    with rasterio.open(path, 'w', driver='GTiff', width=5, height=5, count=count,
                       dtype='float32', crs=crs, transform=from_origin(100, 100, 1, 1)) as ds:
        ds.write(np.ones((count, 5, 5), dtype='float32'))
    with pytest.raises(TerrainError, match=message):
        with open_dem(Settings(path, plane_dem.dem_options)):
            pass
