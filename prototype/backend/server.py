"""One local server for the API, frontend, and locally installed Three.js."""
import argparse
import os
from flask import Flask, jsonify, request, send_from_directory
from .config import (Settings, TerrainError, PROJECT_ROOT, MAX_REQUEST_BYTES, QUALITY_GRIDS,
                     RADIUS_LIMITS_KM, LATITUDE_CONVENTION, LONGITUDE_CONVENTION, SYNTHETIC_WARNING,
                     RENDER_COORDINATE_CONVENTION, GEOMETRY_MODEL)
from .dem_loader import open_dem
from .synthetic import synthetic_terrain
from .terrain_crop import extract_terrain


def create_app(settings=None):
    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = MAX_REQUEST_BYTES
    settings = settings or Settings()

    @app.get("/api/config")
    def config():
        source, error = None, None
        try:
            with open_dem(settings) as (_, info):
                source = info
        except TerrainError as exc:
            error = str(exc)
        return jsonify(dem_ready=source is not None, source=source, dem_error=error,
                       quality_grids=QUALITY_GRIDS, radius_limits_km=RADIUS_LIMITS_KM,
                       latitude_convention=LATITUDE_CONVENTION,
                       longitude_convention=LONGITUDE_CONVENTION, synthetic_warning=SYNTHETIC_WARNING,
                       render_coordinates=RENDER_COORDINATE_CONVENTION, geometry_model=GEOMETRY_MODEL)

    @app.post("/api/terrain")
    def terrain():
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            raise TerrainError("Send a JSON object with latitude, longitude, radius_km, quality, and mode.")
        args = (body.get("latitude"), body.get("longitude"), body.get("radius_km"), body.get("quality", "medium"))
        mode = body.get("mode", "real")
        if mode == "synthetic":
            result = synthetic_terrain(*args)
        elif mode == "real":
            result = extract_terrain(settings, *args)
        else:
            raise TerrainError("Mode must be real or synthetic.")
        return jsonify(result)

    @app.errorhandler(TerrainError)
    def invalid(exc):
        return jsonify(error=str(exc)), 400

    @app.errorhandler(413)
    def oversized(_):
        return jsonify(error="Terrain request is too large."), 413

    @app.get("/")
    def index():
        return send_from_directory(PROJECT_ROOT / "frontend", "index.html")

    @app.get("/frontend/<path:filename>")
    def frontend(filename):
        return send_from_directory(PROJECT_ROOT / "frontend", filename)

    @app.get("/prototype")
    @app.get("/prototype/")
    def prototype_index():
        return send_from_directory(PROJECT_ROOT / "prototype", "index.html")

    @app.get("/prototype/<path:filename>")
    def prototype_file(filename):
        return send_from_directory(PROJECT_ROOT / "prototype", filename)

    @app.get("/vendor/three/<path:filename>")
    def three(filename):
        return send_from_directory(PROJECT_ROOT / "node_modules" / "three", filename)

    return app


def main():
    parser = argparse.ArgumentParser(description="Local lunar DEM terrain simulator")
    parser.add_argument("--dem", default=os.environ.get("LUNAR_DEM_PATH"), help="Local raster, relative to project root or absolute")
    parser.add_argument("--dem-config", default=os.environ.get("LUNAR_DEM_CONFIG"), help="JSON file with verified vertical datum/units")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    try:
        settings = Settings.load(args.dem, args.dem_config)
    except TerrainError as exc:
        parser.error(str(exc))
    create_app(settings).run(host=args.host, port=args.port, threaded=False, debug=False)


if __name__ == "__main__":
    main()
