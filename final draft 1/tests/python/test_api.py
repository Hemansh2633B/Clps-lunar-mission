import pytest
from backend.config import Settings
from backend.server import create_app


def payload(**extra):
    return dict(latitude=-89.5, longitude=45, radius_km=5, quality="low", mode="real", **extra)


def test_missing_dem_never_falls_back_to_synthetic():
    client = create_app(Settings()).test_client()
    assert client.get('/api/config').json['dem_ready'] is False
    response = client.post('/api/terrain', json=payload())
    assert response.status_code == 400
    assert 'No DEM configured' in response.json['error']
    assert 'grid' not in response.json
    p = payload()
    p['mode'] = 'synthetic'
    response = client.post('/api/terrain', json=p)
    assert response.status_code == 200
    assert response.json['synthetic'] is True
    assert 'NOT REAL LUNAR DATA' in response.json['source']['warning']


@pytest.mark.parametrize('kind', ['missing', 'corrupt'])
def test_bad_files_give_clear_errors(tmp_path, kind):
    path = tmp_path / 'bad.tif'
    if kind == 'corrupt':
        path.write_bytes(b'This is not a GeoTIFF')
    client = create_app(Settings(path)).test_client()
    response = client.post('/api/terrain', json=payload())
    assert response.status_code == 400
    assert response.json['error']


@pytest.mark.parametrize('body', [None, [], {'latitude': 999}, {'mode': 'unknown'}])
def test_invalid_requests_do_not_crash(body):
    response = create_app().test_client().post('/api/terrain', json=body)
    assert response.status_code == 400
    assert isinstance(response.json['error'], str)


def test_loaded_fixture_retains_synthetic_provenance(plane_dem):
    client = create_app(plane_dem).test_client()
    response = client.post('/api/terrain', json=payload())
    assert response.status_code == 200
    assert response.json['synthetic'] is True
    assert response.json['grid']['size'] == 129
    assert response.json['landing_elevation_m'] == pytest.approx(100)


def test_oversized_request_is_rejected():
    response = create_app().test_client().post('/api/terrain', data='x' * 20000, content_type='application/json')
    assert response.status_code == 413
    assert 'too large' in response.json['error']


def test_api_errors_are_json_and_headers_set():
    client = create_app().test_client()
    missing = client.get('/api/does-not-exist')
    assert missing.status_code == 404
    assert missing.json['error']
    assert missing.headers['X-Content-Type-Options'] == 'nosniff'
    wrong_method = client.get('/api/terrain')
    assert wrong_method.status_code == 405
    assert wrong_method.json['error']


def test_unexpected_backend_error_is_json_500(monkeypatch):
    import backend.server as server

    def boom(*args, **kwargs):
        raise RuntimeError('synthetic failure')

    monkeypatch.setattr(server, 'extract_terrain', boom)
    response = create_app().test_client().post('/api/terrain', json=payload())
    assert response.status_code == 500
    assert 'Internal terrain error' in response.json['error']
