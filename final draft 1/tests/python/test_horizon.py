import pytest
from backend.config import Settings, TerrainError
from backend.horizon import extract_horizon, horizon_from_grid
from backend.server import create_app
from backend.synthetic import synthetic_terrain


def test_horizon_mask_shape_and_coverage():
    data = synthetic_terrain(-89.5, 45, 5, "low")
    mask = horizon_from_grid(data, az_step_deg=5, eye_height_m=2)
    assert len(mask["azimuths_deg"]) == 72
    assert len(mask["elevations_deg"]) == 72
    assert mask["mean_coverage_percent"] > 95
    assert mask["synthetic"] is True
    assert max(mask["elevations_deg"]) > 0
    assert mask["frame_note"]


def test_horizon_plane_slope_and_curvature(plane_dem):
    from backend.terrain_crop import extract_terrain
    data = extract_terrain(plane_dem, -89.5, 45, 5, "low")
    mask = horizon_from_grid(data, az_step_deg=15, eye_height_m=0)
    north = mask["elevations_deg"][0]
    south = mask["elevations_deg"][12]
    assert north > south  # Plane rises toward north (0.02 m/m).
    assert north < 1.2    # Curvature reduces the apparent slope at 5 km.


def test_api_horizon_and_examples():
    client = create_app(Settings()).test_client()
    assert client.get("/api/health").json["status"] == "ok"
    examples = client.get("/api/examples").json["examples"]
    assert len(examples) >= 4
    response = client.post("/api/horizon", json=dict(latitude=-89.5, longitude=45, radius_km=2, quality="low", mode="synthetic", az_step_deg=10))
    assert response.status_code == 200
    assert len(response.json["azimuths_deg"]) == 36
    real = client.post("/api/horizon", json=dict(latitude=-89.5, longitude=45, radius_km=2, quality="low", mode="real"))
    assert real.status_code == 400
    assert "No DEM configured" in real.json["error"]


def test_invalid_horizon_parameters():
    data = synthetic_terrain(-89.5, 45, 1, "low")
    with pytest.raises(TerrainError):
        horizon_from_grid(data, az_step_deg=7)
    with pytest.raises(TerrainError):
        horizon_from_grid(data, eye_height_m=100)
