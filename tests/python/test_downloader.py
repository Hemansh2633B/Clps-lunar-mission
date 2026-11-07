"""Offline download behavior tests use a tagged synthetic local raster."""
import hashlib
import json
import pytest
import rasterio
from backend.config import LOLA_COG_URL, TerrainError, Settings
from backend.download_lola_subset import download_subset
from backend.terrain_crop import extract_terrain


class RangeResponse:
    def __init__(self, status=206):
        self.status = status
        self.headers = {"Content-Range": "bytes 0-15/1000000"} if status == 206 else {}
        self.read_sizes = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def read(self, size):
        self.read_sizes.append(size)
        assert size <= 16  # A probe must never read the full source.
        return b'x' * size


def test_subset_preserves_real_pixels_and_records_provenance(monkeypatch, tmp_path, plane_dem):
    import backend.download_lola_subset as module
    response = RangeResponse()
    requests = []

    def urlopen(request, **kwargs):
        requests.append(request)
        return response

    actual_open = rasterio.open

    def open_local_for_remote(path, *args, **kwargs):
        return actual_open(plane_dem.dem_path if path == LOLA_COG_URL else path, *args, **kwargs)

    monkeypatch.setattr(module.urllib.request, 'urlopen', urlopen)
    monkeypatch.setattr(module.rasterio, 'open', open_local_for_remote)
    output = tmp_path / 'SYNTHETIC_SUBSET.tif'
    config = tmp_path / 'config.json'
    options = download_subset(-89.5, 45, 5, output, config)
    assert response.read_sizes == [16]
    assert requests[0].full_url != LOLA_COG_URL  # Probe cannot poison the raster URL cache.
    assert requests[0].get_header('Range') == 'bytes=0-15'
    assert options['subset_provenance']['sha256'] == hashlib.sha256(output.read_bytes()).hexdigest()
    assert json.loads(config.read_text()) == options
    result = extract_terrain(Settings(output, options), -89.5, 45, 5, 'low')
    assert result['landing_elevation_m'] == pytest.approx(100)
    assert result['statistics']['coverage_percent'] == 100
    assert result['synthetic'] is True  # Test provenance survives cropping.
    with actual_open(output) as cropped, actual_open(plane_dem.dem_path) as source:
        from rasterio.windows import Window
        left, top, width, height = options['subset_provenance']['source_pixel_window']
        import numpy as np
        np.testing.assert_array_equal(cropped.read(1), source.read(1, window=Window(left, top, width, height)))


def test_no_range_support_refuses_full_download(monkeypatch, tmp_path):
    import backend.download_lola_subset as module
    response = RangeResponse(status=200)
    monkeypatch.setattr(module.urllib.request, 'urlopen', lambda *a, **kw: response)
    with pytest.raises(TerrainError, match='full-raster fallback is disabled'):
        download_subset(-89.5, 45, 5, tmp_path / 'dem.tif', tmp_path / 'config.json')
    assert response.read_sizes == []
    assert not (tmp_path / 'dem.tif').exists()


def test_existing_files_are_preserved(tmp_path):
    output = tmp_path / 'dem.tif'
    output.write_bytes(b'Existing data')
    with pytest.raises(TerrainError, match='already exists'):
        download_subset(-89.5, 45, 5, output, tmp_path / 'config.json')
    assert output.read_bytes() == b'Existing data'
