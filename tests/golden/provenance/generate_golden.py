#!/usr/bin/env python3
"""ARCHIVED PROVENANCE TOOL — not part of the application, its build, or its tests.

Generated the golden reference fixtures in tests/golden/ from the CHANDRA v1.11.0
Python/Flask backend (commit 9b77277) immediately before that backend was replaced
by the native Go implementation. It imports the removed `backend` Python package,
so it only runs from a checkout of that commit:

    git worktree add /tmp/chandra-py 9b77277
    cp tests/golden/provenance/generate_golden.py /tmp/chandra-py/
    cd /tmp/chandra-py && pip install -r requirements-dev.txt && python generate_golden.py OUT_DIR

Every raster written here is a SYNTHETIC SOFTWARE TEST FIXTURE (tagged
LUNAR_SIM_SOURCE=SYNTHETIC), never a lunar observation.
"""
import base64, functools, gzip, json, math, sys
from pathlib import Path
import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from pyproj import CRS, Transformer
import backend.terrain_crop as terrain_crop
import backend.download_lola_subset as dl
from backend.config import Settings, TerrainError, LOLA_COG_URL
from backend.coordinate_utils import local_crs, grid_to_lonlat, validate_location
from backend.dem_loader import open_dem, landing_elevation
from backend.terrain_crop import extract_terrain, grid_coordinates
from backend.horizon import horizon_from_grid
from backend.synthetic import synthetic_terrain
from backend.server import create_app
from backend import lunar_frame

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "tests/golden")
DEM = OUT / "dem"; PY = OUT / "python"
DEM.mkdir(parents=True, exist_ok=True); PY.mkdir(parents=True, exist_ok=True)
R = 1737400.0
OPTS = {"vertical_unit": "m", "value_kind": "elevation",
        "elevation_reference": "Synthetic fixture, no scientific datum",
        "lunar_reference_frame": "Synthetic test frame", "elevation_reference_radius_m": R}
SPSTERE = f"+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +a={R} +b={R} +units=m +no_defs +type=crs"


def dump(name, obj):
    data = json.dumps(obj, separators=(",", ":"), allow_nan=False).encode()
    if name.endswith(".gz"):
        with gzip.GzipFile(PY / name, "wb", mtime=0) as fh:
            fh.write(data)
    else:
        (PY / name).write_bytes(data + b"\n")


def clean(v):
    if isinstance(v, dict): return {k: clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)): return [clean(x) for x in v]
    if isinstance(v, (np.floating, float)): return None if not math.isfinite(v) else float(v)
    if isinstance(v, (np.integer,)): return int(v)
    if isinstance(v, np.bool_): return bool(v)
    return v


def write(path, arr, crs, transform, nodata=None, tags=True, scales=None, offsets=None, **kw):
    count = 1 if arr.ndim == 2 else arr.shape[0]
    with rasterio.open(path, "w", driver="GTiff", width=arr.shape[-1], height=arr.shape[-2], count=count,
                       dtype=str(arr.dtype), crs=crs, transform=transform, nodata=nodata, **kw) as ds:
        ds.write(arr if arr.ndim == 3 else arr[None])
        if tags: ds.update_tags(LUNAR_SIM_SOURCE="SYNTHETIC")
        if scales is not None: ds.scales = [scales]
        if offsets is not None: ds.offsets = [offsets]


def pattern(h=80, w=96):
    j, i = np.meshgrid(np.arange(w), np.arange(h))
    return 1000 * np.sin(i / 7.0) * np.cos(j / 5.0) + i * 3.5 - j * 1.25


def rough(x, y):
    z = (400 * np.sin(x / 1700.0) * np.cos(y / 2300.0) + 150 * np.sin((x + y) / 410.0)
         + 60 * np.cos((x - 2 * y) / 173.0) + 25 * np.sin(x / 37.0) * np.sin(y / 41.0) + 8 * np.sin(x / 9.0 + y / 13.0))
    for cx, cy, r, depth in [(-1500, 900, 900, 350), (2200, -1800, 600, 220), (300, 2600, 400, 150), (-2800, -2600, 1100, 400)]:
        d = np.hypot(x - cx, y - cy) / r
        z = z - depth * np.exp(-d ** 4) + 0.35 * depth * np.exp(-((d - 1.0) / 0.18) ** 2)
    return z - 1200


# ---------------------------------------------------------------- reader fixtures
READERS = {}
def reader_fixtures():
    p = pattern()
    f32 = p.astype("float32"); f32n = f32.copy(); f32n[10:14, 20:31] = -9999.0
    nanv = f32.copy(); nanv[40:45, 50:60] = np.nan
    i16 = np.round(p).astype("int16"); i16[5:9, 5:9] = -32768
    aeqd = local_crs(-89.5, 45, R).to_wkt()
    geo = local_crs(-89.5, 45, R).geodetic_crs.to_wkt()
    t = from_origin(-4800, 4000, 100, 100)
    spec = {
        "f32_strip_none_aeqd": dict(arr=f32n, crs=aeqd, transform=t, nodata=-9999.0),
        "f32_tile_deflate_p3_spstere": dict(arr=nanv, crs=SPSTERE, transform=from_origin(5600, 15840, 20, 20), nodata=float("nan"),
                                            tiled=True, blockxsize=32, blockysize=32, compress="deflate", predictor=3),
        "i16_tile_lzw_p2_geo360": dict(arr=i16, crs=geo, transform=from_origin(0, -88, 3.75, 0.02), nodata=-32768,
                                       tiled=True, blockxsize=64, blockysize=32, compress="lzw", predictor=2, scales=0.5, offsets=10.0),
        "f64_strip_deflate_eqc": dict(arr=p.astype("float64"), crs=f"+proj=eqc +lat_ts=-85 +lon_0=0 +R={R} +units=m +no_defs +type=crs",
                                      transform=from_origin(100000, -2560000, 200, 200), compress="deflate"),
        "f32_bigtiff_tile_deflate_npstere": dict(arr=f32n, crs=f"+proj=stere +lat_0=90 +lon_0=30 +k=1 +R={R} +units=m +no_defs +type=crs",
                                                 transform=from_origin(-4800, 4000, 100, 100), nodata=-9999.0, tiled=True,
                                                 blockxsize=48, blockysize=16, compress="deflate", predictor=1, BIGTIFF="YES"),
        "f32_strip_lzw_p1_stere_ts": dict(arr=f32n, crs=f"+proj=stere +lat_0=-90 +lat_ts=-80 +lon_0=0 +R={R} +units=m +no_defs +type=crs",
                                          transform=from_origin(-4800, 4000, 100, 100), nodata=-9999.0, compress="lzw", blockysize=7),
        "f32_big_endian_oblique_stere": dict(arr=f32n, crs=f"+proj=stere +lat_0=-85 +lon_0=20 +k=1 +R={R} +units=m +no_defs +type=crs",
                                             transform=from_origin(-4800, 4000, 100, 100), nodata=-9999.0, ENDIANNESS="BIG"),
        "u16_strip_none_geo180": dict(arr=(np.round(p) + 3000).astype("uint16"), crs=geo, transform=from_origin(-180, -88, 3.75, 0.02), nodata=0),
        "f32_overviews_aeqd": dict(arr=f32n, crs=aeqd, transform=t, nodata=-9999.0, tiled=True, blockxsize=32, blockysize=32, compress="deflate", overviews=True),
        "f32_eqc_lon180": dict(arr=f32, crs=f"+proj=eqc +lat_ts=0 +lon_0=180 +R={R} +units=m +no_defs +type=crs",
                               transform=from_origin(-9600, -1000000, 200, 200)),
        # invalid inputs: must be rejected with actionable errors
        "bad_rgb_imagery": dict(arr=np.stack([(pattern() % 255).astype("uint8")] * 3), crs=aeqd, transform=t),
        "bad_no_crs": dict(arr=f32, crs=None, transform=t),
        "bad_earth_wgs84": dict(arr=f32, crs="EPSG:4326", transform=from_origin(0, 10, 0.1, 0.1)),
        "bad_ellipsoidal_moon": dict(arr=f32, crs="+proj=longlat +a=1737400 +b=1736000 +type=crs", transform=from_origin(0, -80, 0.1, 0.1)),
        "bad_nonzero_meridian": dict(arr=f32, crs=f"+proj=longlat +R={R} +pm=10 +type=crs", transform=from_origin(0, -80, 0.1, 0.1)),
        "unsupported_tmerc": dict(arr=f32, crs=f"+proj=tmerc +lat_0=0 +lon_0=0 +k=1 +R={R} +units=m +no_defs +type=crs", transform=t),
    }
    for name, s in spec.items():
        s = dict(s); arr = s.pop("arr"); ov = s.pop("overviews", False)
        path = DEM / f"reader_{name}.tif"
        write(path, arr, **s)
        if ov:
            with rasterio.open(path, "r+") as ds:
                ds.build_overviews([2, 4], rasterio.enums.Resampling.average)
        rec = {"file": path.name}
        try:
            with open_dem(Settings(path, dict(OPTS))) as (ds, info):
                rec["info"] = clean(info)
                rec["dtype"] = ds.dtypes[0]; rec["nodata"] = clean(ds.nodata)
                rec["transform"] = list(ds.transform)[:6]; rec["bounds"] = list(ds.bounds)
                rec["tags"] = ds.tags(); rec["scales"] = list(ds.scales); rec["offsets"] = list(ds.offsets)
                band = ds.read(1, masked=True)
                rec["pixels"] = clean(np.ma.masked_invalid(band).astype("float64").filled(np.nan).ravel().tolist())
                crs = CRS.from_wkt(info["crs_wkt"])
                rec["is_geographic"] = crs.is_geographic
                rec["proj4"] = crs.to_proj4()
                tr = Transformer.from_crs(crs, crs.geodetic_crs, always_xy=True)
                cols = np.array([0.5, 17.25, 48.0, 95.5, 30.3, 70.9]); rows = np.array([0.5, 9.75, 40.0, 79.5, 66.6, 12.1])
                xs, ys = ds.transform * (cols, rows)
                lons, lats = tr.transform(xs, ys)
                samples = []
                for c, r_, x, y, lo, la in zip(cols, rows, xs, ys, lons, lats):
                    try: elev = landing_elevation(ds, info, float(la), float(lo))
                    except TerrainError as exc: elev = {"error": str(exc)}
                    samples.append({"col": float(c), "row": float(r_), "x": float(x), "y": float(y), "lon": float(lo), "lat": float(la), "landing_elevation_m": elev})
                rec["samples"] = samples
        except TerrainError as exc:
            rec["error"] = str(exc)
        READERS[name] = rec
    dump("readers.json.gz", READERS)


# ---------------------------------------------------------------- extraction DEMs
def extraction_dems():
    n, spacing = 401, 100.0
    east = np.arange(n) * spacing - 20000; north = 20000 - np.arange(n) * spacing
    x, y = np.meshgrid(east, north)
    write(DEM / "extract_plane_aeqd.tif", (100 + 0.01 * x + 0.02 * y).astype("float32"), local_crs(-89.5, 45, R).to_wkt(),
          from_origin(-20050, 20050, spacing, spacing), nodata=-9999.0, tiled=True, blockxsize=256, blockysize=256, compress="deflate", predictor=3)
    m = 512
    xs = 5600 + (np.arange(m) + 0.5) * 20.0; ys = 15840 - (np.arange(m) + 0.5) * 20.0
    X, Y = np.meshgrid(xs, ys)
    z = np.round(rough(X - 10720.0, Y - 10720.0) / 0.5).astype("int16")
    z[300:322, 140:170] = -32768
    jj, ii = np.meshgrid(np.arange(m), np.arange(m)); z[(ii + jj) < 60] = -32768
    write(DEM / "extract_rough_spstere_20m.tif", z, SPSTERE, from_origin(5600, 15840, 20, 20), nodata=-32768, scales=0.5, offsets=0.0,
          tiled=True, blockxsize=128, blockysize=128, compress="deflate", predictor=2)
    lons = np.arange(360) + 0.5
    g = np.broadcast_to((100 + 20 * np.sin(np.deg2rad(lons))).astype("float32"), (50, 360))
    write(DEM / "extract_geo360.tif", np.ascontiguousarray(g), local_crs(-89.5, 45, R).geodetic_crs.to_wkt(), from_origin(0, -89, 1, 0.02), nodata=-9999.0, compress="deflate")


def native_scale(ds, info, lat, lon, spacing):
    """Analytic destination-pixels-per-source-pixel ratio used by the native backend."""
    crs = CRS.from_wkt(info["crs_wkt"])
    if crs.is_geographic:
        sx = abs(ds.res[0]) * math.pi / 180 * info["lunar_radius_m"] * max(math.cos(math.radians(lat)), 1e-12); sy = abs(ds.res[1]) * math.pi / 180 * info["lunar_radius_m"]
    else:
        tr = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True)
        from pyproj import Proj
        k = Proj(crs).get_factors(lon, lat).meridional_scale
        sx = abs(ds.res[0]) / k; sy = abs(ds.res[1]) / k
    return min(1.0, sx / spacing), min(1.0, sy / spacing)


def diag_extract(settings, lat, lon, radius, quality, **vrt_kw):
    orig = terrain_crop.WarpedVRT
    terrain_crop.WarpedVRT = functools.partial(WarpedVRT, **vrt_kw)
    try: return extract_terrain(settings, lat, lon, radius, quality)
    finally: terrain_crop.WarpedVRT = orig


def arr(result):
    return np.array([np.nan if v is None else v for v in result["grid"]["elevations_m"]], dtype="float64")


def diff_stats(a, b):
    both = np.isfinite(a) & np.isfinite(b)
    d = np.abs(a[both] - b[both])
    return {"mask_mismatch_cells": int((np.isfinite(a) != np.isfinite(b)).sum()), "max_abs_m": float(d.max()) if d.size else 0.0,
            "rms_m": float(np.sqrt(np.mean(d ** 2))) if d.size else 0.0, "p99_m": float(np.percentile(d, 99)) if d.size else 0.0}


CASES = [
    ("plane_center_low", "extract_plane_aeqd.tif", OPTS, -89.5, 45, 5, "low"),
    ("plane_offset_low", "extract_plane_aeqd.tif", OPTS, -89.62, 41, 2, "low"),
    ("rough_r2_low", "extract_rough_spstere_20m.tif", OPTS, -89.5, 45, 2, "low"),
    ("rough_r4_low", "extract_rough_spstere_20m.tif", OPTS, -89.5, 45, 4, "low"),
    ("rough_r1_low_upsample", "extract_rough_spstere_20m.tif", OPTS, -89.5, 45, 1, "low"),
    ("rough_r0.5_low_upsample", "extract_rough_spstere_20m.tif", OPTS, -89.52, 47, 0.5, "low"),
    ("rough_gap_r2_low", "extract_rough_spstere_20m.tif", OPTS, -89.56, 40.5, 2, "low"),
    ("geo360_seam_east_low", "extract_geo360.tif", OPTS, -89.5, 359.9, 5, "low"),
    ("geo360_seam_west_low", "extract_geo360.tif", OPTS, -89.5, 0.1, 5, "low"),
    ("geo360_mid_low", "extract_geo360.tif", OPTS, -89.5, 179.9, 5, "low"),
]
REAL = Path("data/verification/LDEM_80S_20MPP_ADJ_512_verification.tif")
REAL_CASES = [("real_shackleton_r5", -89.9, 0.0, 5), ("real_connecting_ridge_r10", -89.5, 222.0, 10),
              ("real_malapert_r20", -86.0, 0.0, 20), ("real_nobile_r5", -85.2, 53.5, 5)]


def run_case(name, settings, lat, lon, radius, quality, summary, stride=1):
    base = extract_terrain(settings, lat, lon, radius, quality)
    size, _, spacing, *_ = grid_coordinates(base["radius_km"], quality)
    with open_dem(settings) as (ds, info):
        sx, sy = native_scale(ds, info, base["latitude"], base["longitude"], spacing)
    xs = 1.0 if (sx >= 0.95 and sy >= 0.95) else sx; ysc = 1.0 if (sx >= 0.95 and sy >= 0.95) else sy
    exact = diag_extract(settings, lat, lon, radius, quality, tolerance=1e-9)
    const = diag_extract(settings, lat, lon, radius, quality, tolerance=1e-9, XSCALE=repr(xs), YSCALE=repr(ysc))
    point = diag_extract(settings, lat, lon, radius, quality, tolerance=1e-9, XSCALE="1", YSCALE="1")
    a = arr(base)
    rec = {"request": {"latitude": lat, "longitude": lon, "radius_km": radius, "quality": quality, "mode": "real"},
           "native_scale": [sx, sy], "terrain": clean(base),
           "horizon_az2_eye2": clean({k: v for k, v in horizon_from_grid(base, 2, 2.0).items() if k != "source"}),
           "horizon_az5_eye0": clean({k: v for k, v in horizon_from_grid(base, 5, 0).items() if k != "source"}),
           "gdal_exact_constscale_elevations_m": clean(arr(const).tolist()),
           "gdal_exact_point_elevations_m": clean(arr(point).tolist()),
           "gdal_variants": {"default_vs_exact_transformer": diff_stats(a, arr(exact)),
                             "default_vs_const_scale": diff_stats(a, arr(const)),
                             "default_vs_point": diff_stats(a, arr(point))}}
    summary[name] = {"native_scale": [sx, sy], **rec["gdal_variants"], "coverage_percent": base["statistics"]["coverage_percent"]}
    dump(f"extract_{name}.json.gz", rec)


def extraction_cases():
    summary = {}
    for name, f, opts, lat, lon, radius, quality in CASES:
        run_case(name, Settings(DEM / f, dict(opts)), lat, lon, radius, quality, summary)
    for q in ("medium", "high"):
        res = extract_terrain(Settings(DEM / "extract_plane_aeqd.tif", dict(OPTS)), -89.5, 45, 5, q)
        e = res["grid"]["elevations_m"]
        dump(f"extract_plane_center_{q}_strided.json.gz", clean({"request": {"latitude": -89.5, "longitude": 45, "radius_km": 5, "quality": q, "mode": "real"},
             "stride": 7, "elevations_m_strided": e[::7], "statistics": res["statistics"], "landing_elevation_m": res["landing_elevation_m"],
             "grid_size": res["grid"]["size"], "spacing_m": res["grid"]["spacing_m"]}))
    if REAL.is_file():
        real_opts = json.loads(Path("data/verification/lola_verification_config.json").read_text()); real_opts.pop("dem_path")
        for name, lat, lon, radius in REAL_CASES:
            run_case(name, Settings(REAL.resolve(), real_opts), lat, lon, radius, "low", summary)
        dump("real_fixture_config.json", real_opts)
    return summary


def downloader_windows():
    out = []
    actual_open = rasterio.open
    class Resp:
        status = 206; headers = {"Content-Range": "bytes 0-15/1000000"}
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def read(self, n): return b"x" * n
    import tempfile
    src = DEM / "extract_rough_spstere_20m.tif"
    dl.urllib.request.urlopen = lambda *a, **k: Resp()
    dl.rasterio.open = lambda path, *a, **k: actual_open(src if path == LOLA_COG_URL else path, *a, **k)
    saved = dict(dl.LOLA_SUBSET_ASSUMPTIONS); dl.LOLA_SUBSET_ASSUMPTIONS.update(OPTS)
    for lat, lon, radius in [(-89.5, 45, 2), (-89.5, 45, 4), (-89.52, 47, 0.5), (-89.5, 45, 6), (-89.3, 45, 2)]:
        with tempfile.TemporaryDirectory() as tmp:
            try:
                o = dl.download_subset(lat, lon, radius, Path(tmp) / "s.tif", Path(tmp) / "c.json")
                p = o["subset_provenance"]
                with actual_open(Path(tmp) / "s.tif") as ds:
                    first = ds.read(1)[:2, :3].tolist(); shape = [ds.width, ds.height]; tr = list(ds.transform)[:6]
                out.append({"latitude": lat, "longitude": lon, "radius_km": radius, "source_pixel_window": p["source_pixel_window"],
                            "native_landing_elevation_m": p["native_landing_elevation_m"], "subset_shape": shape, "subset_transform": tr, "first_pixels": first})
            except TerrainError as exc:
                out.append({"latitude": lat, "longitude": lon, "radius_km": radius, "error": str(exc)})
    dl.rasterio.open = actual_open; dl.LOLA_SUBSET_ASSUMPTIONS.clear(); dl.LOLA_SUBSET_ASSUMPTIONS.update(saved)
    dump("downloader_windows.json", out)


def api_and_misc():
    plane = Settings(DEM / "extract_plane_aeqd.tif", dict(OPTS))
    calls = []
    def rec(client, label, method, path, **kw):
        r = client.open(path, method=method, **kw)
        body = kw.get("json", kw.get("data"))
        calls.append({"app": label, "method": method, "path": path, "body": body if not isinstance(body, str) or len(body) < 200 else {"__repeat__": body[0], "count": len(body)},
                      "content_type": kw.get("content_type"), "status": r.status_code, "json": clean(r.get_json(silent=True)),
                      "headers": {k: r.headers.get(k) for k in ("X-Content-Type-Options", "Referrer-Policy", "Content-Type")}})
    P = dict(latitude=-89.5, longitude=45, radius_km=5, quality="low", mode="real")
    for label, settings in (("no_dem", Settings()), ("plane", plane), ("missing_file", Settings(Path("/nonexistent/bad.tif"), dict(OPTS)))):
        c = create_app(settings).test_client()
        for path in ("/api/health", "/api/examples", "/api/config", "/api/does-not-exist", "/api/terrain", "/api/horizon"):
            rec(c, label, "GET", path)
        bodies = [P, {**P, "mode": "synthetic", "radius_km": 1}, None, [], {"latitude": 999}, {"mode": "unknown"}, {**P, "latitude": "abc"}, {**P, "latitude": True},
                  {**P, "latitude": "-89.5", "longitude": "405"}, {**P, "longitude": 359}, {**P, "radius_km": 0.2}, {**P, "radius_km": 25}, {**P, "quality": "ultra"},
                  {**P, "latitude": -80}, {**P, "quality": 5}, {"latitude": -89.5, "longitude": 45, "radius_km": 5}, {**P, "latitude": None}]
        for b in bodies:
            rec(c, label, "POST", "/api/terrain", json=b)
        hz = [{**P, "radius_km": 2, "mode": "synthetic", "az_step_deg": 10}, {**P, "radius_km": 2}, {**P, "az_step_deg": 7}, {**P, "az_step_deg": 2.5},
              {**P, "az_step_deg": True}, {**P, "eye_height_m": 100}, {**P, "mode": "synthetic", "eye_height_m": "1.5", "az_step_deg": "15"},
              {**P, "mode": "nope"}, None, {**P, "mode": "synthetic", "az_step_deg": 0}, {**P, "mode": "synthetic", "eye_height_m": -1}]
        for b in hz:
            rec(c, label, "POST", "/api/horizon", json=b)
        rec(c, label, "POST", "/api/terrain", data="x" * 20000, content_type="application/json")
        rec(c, label, "POST", "/api/terrain", data="{not json", content_type="application/json")
        rec(c, label, "DELETE", "/api/health")
    for call in calls:  # full grids are covered by the extraction goldens
        j = call["json"]
        if isinstance(j, dict) and "grid" in j:
            e = j["grid"].pop("elevations_m"); j["grid"]["elevations_m_strided_31"] = e[::31]; j["grid"]["count"] = len(e)
    dump("api_calls.json.gz", calls)
    syn = synthetic_terrain(-89.5, 45, 5, "low")
    dump("synthetic_low.json.gz", clean({"terrain": syn, "horizon_az2_eye2": {k: v for k, v in horizon_from_grid(syn, 2, 2.0).items() if k != "source"},
                                         "horizon_az5_eye10": {k: v for k, v in horizon_from_grid(syn, 5, 10).items() if k != "source"}}))
    coords = {"validate": [], "aeqd": [], "projections": {}}
    for args in [(-89.5, 45, 5, "medium"), (-89.5, 359, 5, "low"), (-89.5, 360, 5, "high"), (-89.5, 180, 5, "low"), (-89.5, -180, 0.5, "low"), ("-45.5", "200", "20", "low"),
                 (-91, 45, 5, "medium"), (-89.5, 361, 5, "medium"), (-89.5, -181, 5, "medium"), (-89.5, 45, 0.49, "medium"), (-89.5, 45, 20.1, "medium"),
                 (float("nan"), 45, 5, "medium"), (-89.5, 45, "not-a-number", "medium"), (True, 45, 5, "medium"), (-89.5, 45, 5, "ultra")]:
        try: res = list(validate_location(*args))
        except TerrainError as exc: res = {"error": str(exc)}
        coords["validate"].append({"args": clean(list(args)), "result": res})
    east = np.array([5000.0, 0, -5000, 3000, -12345.678, 19999.0, 0.0]); north = np.array([0.0, 5000, 0, 4000, 7654.321, -19999.0, 0.0])
    for lat, lon in [(-89.5, 45), (-90, 0), (-90, 175), (90, -45), (0, 179.99), (-85.2, 53.5), (20.19, 30.77), (-89.99, -137.0)]:
        lons, lats = grid_to_lonlat(east, north, lat, lon, R)
        coords["aeqd"].append({"lat": lat, "lon": lon, "east_m": east.tolist(), "north_m": north.tolist(), "lons": list(map(float, lons)), "lats": list(map(float, lats))})
    pts = [(0, -89.9), (45, -89.5), (222, -89.5), (-137, -88.5), (53.5, -85.2), (179.5, -80.5), (-0.3, -84.0), (10, -90.0)]
    for name, proj in {"spstere": SPSTERE, "npstere_lon30": f"+proj=stere +lat_0=90 +lon_0=30 +k=1 +R={R} +units=m", "stere_ts80": f"+proj=stere +lat_0=-90 +lat_ts=-80 +lon_0=0 +R={R} +units=m",
                       "oblique_stere": f"+proj=stere +lat_0=-85 +lon_0=20 +k=1 +R={R} +units=m", "eqc_ts85": f"+proj=eqc +lat_ts=-85 +lon_0=0 +R={R} +units=m",
                       "eqc_lon180": f"+proj=eqc +lat_ts=0 +lon_0=180 +R={R} +units=m", "aeqd_site": f"+proj=aeqd +lat_0=-89.5 +lon_0=45 +R={R} +units=m"}.items():
        crs = CRS.from_proj4(proj + " +no_defs +type=crs"); tr = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True)
        sign = -1 if "npstere" in name else 1
        rows = []
        for lo, la in pts:
            x, y = tr.transform(lo, la * sign)
            rows.append({"lon": lo, "lat": la * sign, "x": x, "y": y})
        coords["projections"][name] = {"proj4": proj, "points": rows}
    dump("coordinates.json", clean(coords))
    ref = json.loads(Path("tests/data/frame-reference.json").read_text())["constants"]
    MATS = {"me": np.array(ref["me_to_iau"]).reshape(3, 3), "pa": np.array(ref["pa_to_iau"]).reshape(3, 3), "iau": np.eye(3)}
    frames = {"classify": [], "convert": [], "matrices_row_major": {k: v.ravel().tolist() for k, v in MATS.items()}}
    for s in ["MOON_ME", "MOON_ME_DE421", "MOON_ME (JPL DE421)", "MOON_PA (JPL DE421)", "MOON_PA", "MOON_PA_DE421", "IAU_MOON", "IAU 2015 Moon", "MysteryFrame", "", None,
              "MOON_ME_DE440", "NOT_MOON_ME", "WEIRD_IAU_FRAME", "ME", "PA", "moon_me", "MOON_ME (DE421) — third-party 512px verification downsample; gap-filled; NOT flight data",
              "Synthetic test frame", "MOON_ME - note", "IAU_MOON_2015", "MOON_PA_DE440", "MOON-ME"]:
        frames["classify"].append({"frame": s, "result": clean(lunar_frame.classify_frame(s))})
    for lat, lon in [(-89.9, 0.0), (-89.5, 45.0), (-88.0, 135.0), (-87.0, -100.0), (-90.0, 0.0), (-89.99, 30.0), (0.6741, 23.4729), (-45.4446, 177.5882), (20.19, 30.77)]:
        for tname in ("me", "pa", "iau"):
            frames["convert"].append({"lat": lat, "lon": lon, "transform": tname, "result": clean(lunar_frame.convert_site(lat, lon, MATS[tname]))})
    dump("frames.json", frames)


if __name__ == "__main__":
    reader_fixtures(); extraction_dems(); summary = extraction_cases(); downloader_windows(); api_and_misc()
    import flask, pyproj
    dump("manifest.json", {"generated_from": "CHANDRA v1.11.0 Python backend, commit 9b77277", "python": sys.version.split()[0], "rasterio": rasterio.__version__,
                           "gdal": rasterio.__gdal_version__, "numpy": np.__version__, "pyproj": pyproj.__version__, "proj": pyproj.proj_version_str, "flask": flask.__version__ if hasattr(flask, "__version__") else None,
                           "extraction_summary": summary, "readers": {k: ("error" if "error" in v else "ok") for k, v in READERS.items()}})
    print(json.dumps(summary, indent=1))
