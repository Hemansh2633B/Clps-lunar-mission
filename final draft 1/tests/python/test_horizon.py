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
    assert mask["mean_coverage_percent"] == 100
    assert mask["synthetic"] is True
    assert max(mask["elevations_deg"]) > 0
    assert mask["frame_note"]
    assert mask["horizon_radius_km"] < mask["radius_km"]
    assert mask["edge_inset_m"] > 0
    assert mask["grid_size"] == 129


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
    assert response.json["horizon_radius_km"] < 2
    assert response.json["mean_coverage_percent"] == 100
    real = client.post("/api/horizon", json=dict(latitude=-89.5, longitude=45, radius_km=2, quality="low", mode="real"))
    assert real.status_code == 400
    assert "No DEM configured" in real.json["error"]


def test_invalid_horizon_parameters():
    data = synthetic_terrain(-89.5, 45, 1, "low")
    with pytest.raises(TerrainError):
        horizon_from_grid(data, az_step_deg=7)
    with pytest.raises(TerrainError):
        horizon_from_grid(data, az_step_deg=2.5)
    with pytest.raises(TerrainError):
        horizon_from_grid(data, az_step_deg=True)
    with pytest.raises(TerrainError):
        horizon_from_grid(data, eye_height_m=100)
    with pytest.raises(TerrainError):
        horizon_from_grid(data, eye_height_m=float("nan"))


def test_horizon_nodata_is_reported_not_filled(plane_dem):
    from backend.terrain_crop import extract_terrain
    data = extract_terrain(plane_dem, -89.5, 45, 2, "low")
    n = data["grid"]["size"]
    # Remove a northern wedge; rays through it must lose coverage.
    for row in range(n // 2):
        for col in range(n // 2 - 3, n // 2 + 4):
            data["grid"]["elevations_m"][row * n + col] = None
    mask = horizon_from_grid(data, az_step_deg=15, eye_height_m=2)
    north = mask["azimuths_deg"].index(0)
    assert mask["ray_coverage_percent"][north] < 100
    assert mask["mean_coverage_percent"] < 100
