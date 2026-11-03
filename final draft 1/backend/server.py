"""Local API for SELENE Terrain Lab: DEM extraction, horizon masks, and optional static hosting."""
import argparse
import os
from flask import Flask, jsonify, request, send_from_directory
from .config import (Settings, TerrainError, PROJECT_ROOT, MAX_REQUEST_BYTES, QUALITY_GRIDS,
                     RADIUS_LIMITS_KM, LATITUDE_CONVENTION, LONGITUDE_CONVENTION, SYNTHETIC_WARNING,
                     RENDER_COORDINATE_CONVENTION, GEOMETRY_MODEL)
from .dem_loader import open_dem
from .synthetic import synthetic_terrain
from .terrain_crop import extract_terrain
from .horizon import extract_horizon

EXAMPLES = [
    {"label": "South-pole example", "latitude": -89.5, "longitude": 45, "radius_km": 5,
     "notes": "Default prototype example; supported by the optional NASA LOLA subset."},
    {"label": "Near-pole inspection", "latitude": -89.9, "longitude": 0, "radius_km": 2,
     "notes": "Shackleton vicinity; download a separate covered subset."},
    {"label": "Exact south pole", "latitude": -90, "longitude": 45, "radius_km": 1,
     "notes": "Longitude defines the chosen local meridian at the pole."},
    {"label": "North-pole reference", "latitude": 89.5, "longitude": 45, "radius_km": 5,
     "notes": "Requires a north-pole DEM; the included NASA downloader targets the south pole."},
]


def create_app(settings=None):
    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = MAX_REQUEST_BYTES
    settings = settings or Settings()

    @app.get("/api/health")
    def health():
        return jsonify(status="ok", product="SELENE Terrain Lab API")

    @app.get("/api/examples")
    def examples():
        return jsonify(examples=EXAMPLES)

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

    @app.post("/api/horizon")
    def horizon():
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            raise TerrainError("Send a JSON object with latitude, longitude, radius_km, quality, mode, az_step_deg, eye_height_m.")
        return jsonify(extract_horizon(settings, body))

    @app.errorhandler(TerrainError)
    def invalid(exc):
        return jsonify(error=str(exc)), 400

    @app.errorhandler(413)
    def oversized(_):
        return jsonify(error="Terrain request is too large."), 413

    @app.errorhandler(404)
    def not_found(_):
        if request.path.startswith("/api/"):
            return jsonify(error="Unknown API endpoint."), 404
        return jsonify(error="Not found."), 404

    @app.errorhandler(405)
    def method_not_allowed(_):
        return jsonify(error="Method not allowed for this endpoint."), 405

    @app.errorhandler(Exception)
    def unexpected(exc):
        app.logger.exception("Unhandled terrain API error")
        return jsonify(error="Internal terrain error. Check the backend console for details."), 500

    @app.after_request
    def security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        return response

    dist = PROJECT_ROOT / "dist"

    @app.get("/")
    def index():
        if (dist / "index.html").is_file():
            return send_from_directory(dist, "index.html")
        return jsonify(product="SELENE Terrain Lab API", hint="Run npm run build to serve the console here, or use the Vite dev server.")

    @app.get("/assets/<path:filename>")
    def assets(filename):
        return send_from_directory(dist / "assets", filename)

    @app.get("/screenshots/<path:filename>")
    def screenshots(filename):
        return send_from_directory(PROJECT_ROOT / "screenshots", filename)

    return app


def main():
    parser = argparse.ArgumentParser(description="SELENE local lunar DEM terrain API")
    parser.add_argument("--dem", default=os.environ.get("LUNAR_DEM_PATH"), help="Local raster, relative to project root or absolute")
    parser.add_argument("--dem-config", default=os.environ.get("LUNAR_DEM_CONFIG"), help="JSON file with verified vertical datum/units")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    try:
        settings = Settings.load(args.dem, args.dem_config)
    except TerrainError as exc:
        parser.error(str(exc))
    create_app(settings).run(host=args.host, port=args.port, threaded=False, debug=False)


if __name__ == "__main__":
    main()
