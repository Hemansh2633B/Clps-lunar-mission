#!/usr/bin/env python3
"""Fetch a small public LOLA-derived south-pole grid and wrap it as a lunar GeoTIFF.

This is a SOFTWARE VERIFICATION FIXTURE, not a flight product:
  * source: NASA PGDA LDEM_80S_20MPP_ADJ.TIF (MOON_ME / DE421)
  * third-party 512x512 bilinear downsample published by
    hparadiz/artemis-iii-landing-candidates
  * that derivative fills invalid source pixels before downsampling, so NoData
    coverage is NOT preserved. Do not use it for scientific illumination studies.

It exists to exercise SELENE's real projected-DEM loading, cropping, horizon
ray-marching, and browser integration without downloading the multi-GB NASA COG.
"""
from __future__ import annotations

import hashlib
import json
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin
from pyproj import CRS, Transformer

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "verification"
REPO = "hparadiz/artemis-iii-landing-candidates"
BIN_PATH = "data/base_tiles/ldem_80s_20mpp_adj.tif_512.bin"
META_PATH = "data/base_dem_80s.json"
SIZE = 512
EXTENT = 304000.0  # metres, polar stereographic bounds of the 80S product
RADIUS = 1737400.0


def fetch(path: str) -> bytes:
    url = f"https://api.github.com/repos/{REPO}/contents/{path}"
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github.raw", "User-Agent": "SELENE-verification-fixture"})
    with urllib.request.urlopen(req, timeout=120) as response:
        return response.read()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    raw = fetch(BIN_PATH)
    meta = json.loads(fetch(META_PATH).decode("utf-8"))
    if len(raw) != SIZE * SIZE * 4:
        raise SystemExit(f"unexpected fixture size: {len(raw)} bytes")
    arr = np.frombuffer(raw, dtype="<f4").reshape(SIZE, SIZE).astype("float32")
    if not np.isfinite(arr).all():
        raise SystemExit("fixture contains non-finite samples")

    # NASA LOLA 80S adjusted mosaic: south polar stereographic, true scale at pole,
    # central meridian 0, spherical Moon radius 1737400 m. Row 0 is the northern
    # edge of the projected grid (standard north-up GeoTIFF convention).
    crs = CRS.from_proj4(
        f"+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +a={RADIUS} +b={RADIUS} +units=m +no_defs +type=crs"
    )
    pixel = (2 * EXTENT) / SIZE
    transform = from_origin(-EXTENT, EXTENT, pixel, pixel)
    tif = OUT / "LDEM_80S_20MPP_ADJ_512_verification.tif"
    with rasterio.open(
        tif, "w", driver="GTiff", height=SIZE, width=SIZE, count=1,
        dtype="float32", crs=crs, transform=transform, compress="deflate",
    ) as dst:
        dst.write(arr, 1)
        dst.update_tags(
            SOURCE="NASA PGDA LDEM_80S_20MPP_ADJ.TIF via hparadiz/artemis-iii-landing-candidates",
            DERIVATIVE="512x512 bilinear downsample; invalid source pixels were filled by the derivative author",
            FRAME="MOON_ME (DE421) per source product documentation; verify before operational use",
        )

    # Confirm the projection centre is the south pole.
    geo = crs.geodetic_crs
    lon, lat = Transformer.from_crs(crs, geo, always_xy=True).transform(0.0, 0.0)
    if abs(lat + 90) > 1e-6:
        raise SystemExit(f"projection centre is not the south pole: {lat}, {lon}")

    config = {
        "dem_path": str(tif.relative_to(ROOT)),
        "vertical_unit": "m",
        "value_kind": "elevation",
        "elevation_reference": "NASA LOLA adjusted radial topography, reference sphere 1737400 m (verification fixture)",
        "elevation_reference_radius_m": RADIUS,
        "lunar_reference_frame": "MOON_ME (DE421) — third-party 512px verification downsample; gap-filled; NOT flight data",
        "scale": 1.0,
        "offset": 0.0,
    }
    config_path = OUT / "lola_verification_config.json"
    config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    provenance = {
        "purpose": "software verification fixture only",
        "source_product": "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF",
        "derivative_repository": f"https://github.com/{REPO}",
        "derivative_bin": BIN_PATH,
        "derivative_meta": META_PATH,
        "sha256_bin": hashlib.sha256(raw).hexdigest(),
        "sha256_tif": hashlib.sha256(tif.read_bytes()).hexdigest(),
        "grid": {"width": SIZE, "height": SIZE, "pixel_size_m": pixel, "extent_m": [-EXTENT, EXTENT, -EXTENT, EXTENT]},
        "height_range_m": [float(arr.min()), float(arr.max())],
        "source_meta": meta,
        "caveats": [
            "Third-party bilinear downsample, not native NASA resolution.",
            "Invalid source pixels were filled by the derivative author; NoData coverage is not preserved.",
            "Body frame is asserted from source documentation, not independently reconciled with IAU 2015 ephemeris.",
            "Use only to verify software loading/cropping/rendering paths.",
        ],
    }
    (OUT / "PROVENANCE.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {tif}")
    print(f"Config: {config_path}")
    print(f"Height range: {arr.min():.1f} … {arr.max():.1f} m; centre lat/lon: {lat:.6f}, {lon:.6f}")


if __name__ == "__main__":
    main()
