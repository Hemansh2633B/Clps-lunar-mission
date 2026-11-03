"""Authoritative lunar reference-frame handling (SPICE / NAIF).

The mission ephemeris (``src/engine/ephemeris.ts``) uses the IAU 2015 Moon
rotation (astronomy-engine ``RotationAxis(Body.Moon)``). NASA LOLA south-polar
DEMs (PGDA product 90) are delivered in the **MOON_ME** frame realized with JPL
DE421. These are *different* body-fixed realizations and must never be combined
silently.

Measured relationship (this module, SPICE DE421 + moon_pa_de421 PCK + moon_080317
frame kernel), verified across 2020-2035:

* MOON_ME -> MOON_PA is a fixed rotation of 0.0288473 deg (the ``(67.92, 78.56,
  0.30)`` arcsecond rotation about axes (3, 2, 1) in moon_080317.tf).
* The IAU 2015 frame is close to **MOON_ME** (not MOON_PA): the IAU prime meridian
  is defined by the mean-Earth direction. The residual IAU-vs-ME rotation is
  <= 0.0039 deg (~120 m on the surface) and slowly varying.

This module is the authority for that relationship. It is used to:
  * generate the small constant correction shipped to the frontend,
  * validate the ephemeris against an independent SPICE evaluation, and
  * classify a DEM's declared frame so incompatible frames can be blocked from
    quantitative mission-visibility use (they remain viewable in Terrain Lab).

If the SPICE kernels are absent the module degrades gracefully: frame
verification is reported as unavailable and callers must treat DEM frames as
unverified.
"""
from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Optional

import numpy as np

try:
    import spiceypy as sp
    _HAS_SPICE = True
except Exception:  # pragma: no cover - spiceypy is an optional validation dep
    sp = None
    _HAS_SPICE = False

KERNEL_DIR = Path(os.environ.get("CHANDRA_KERNEL_DIR", Path(__file__).resolve().parent.parent / "data" / "kernels"))
_REQUIRED = ["naif0012.tls", "de421.bsp", "moon_080317.tf", "moon_pa_de421_1900-2050.bpc"]
_loaded = False
_load_error: Optional[str] = None

# Reference epoch for the constant frontend correction (mid-range of the verified span).
REFERENCE_EPOCH_ISO = "2027-01-01T00:00:00"
# Verified maximum residual of the constant ME->IAU correction over 2020-2035 (degrees).
ME_IAU_MAX_RESIDUAL_DEG = 0.0039
PA_IAU_MAX_RESIDUAL_DEG = 0.0039


def kernels_available() -> bool:
    return _HAS_SPICE and all((KERNEL_DIR / f).is_file() for f in _REQUIRED)


def _ensure_loaded() -> None:
    global _loaded, _load_error
    if _loaded or _load_error is not None:
        return
    if not _HAS_SPICE:
        _load_error = "spiceypy is not installed; run pip install spiceypy and fetch kernels."
        return
    missing = [f for f in _REQUIRED if not (KERNEL_DIR / f).is_file()]
    if missing:
        _load_error = f"Missing SPICE kernels in {KERNEL_DIR}: {', '.join(missing)}. Run scripts/fetch-spice-kernels.py."
        return
    for f in _REQUIRED:
        sp.furnsh(str(KERNEL_DIR / f))
    # Text PCK enables the independent IAU_MOON evaluation (optional but preferred).
    pck = KERNEL_DIR / "pck00008.tpc"
    if pck.is_file():
        sp.furnsh(str(pck))
    _loaded = True


def rotation_angle_deg(R: np.ndarray) -> float:
    return math.degrees(math.acos(max(-1.0, min(1.0, (float(np.trace(R)) - 1.0) / 2.0))))


def me_to_j2000(et: float) -> np.ndarray:
    _ensure_loaded()
    if _load_error:
        raise RuntimeError(_load_error)
    return np.array(sp.sxform("MOON_ME", "J2000", et)[:3, :3])


def pa_to_j2000(et: float) -> np.ndarray:
    _ensure_loaded()
    if _load_error:
        raise RuntimeError(_load_error)
    return np.array(sp.sxform("MOON_PA_DE421", "J2000", et)[:3, :3])


def iau_to_j2000(et: float) -> np.ndarray:
    """Independent IAU Moon rotation evaluated by SPICE from the text PCK."""
    _ensure_loaded()
    if _load_error:
        raise RuntimeError(_load_error)
    return np.array(sp.pxform("IAU_MOON", "J2000", et))


def str_to_et(iso: str) -> float:
    _ensure_loaded()
    if _load_error:
        raise RuntimeError(_load_error)
    return sp.str2et(iso.replace("Z", ""))


def _mean_rotation(mats: list[np.ndarray]) -> np.ndarray:
    """Chordal L2 mean rotation (polar factor of the sum)."""
    M = np.sum(mats, axis=0)
    U, _, Vt = np.linalg.svd(M)
    d = np.sign(np.linalg.det(U @ Vt))
    return U @ np.diag([1.0, 1.0, d]) @ Vt


def constant_corrections(start_year: int = 2020, end_year: int = 2035) -> dict:
    """Mean ME->IAU and PA->IAU rotations + verified max residual over a grid.

    The frontend ships these constant matrices; the residual is disclosed as a
    frame-model uncertainty rather than hidden.
    """
    _ensure_loaded()
    if _load_error:
        raise RuntimeError(_load_error)
    me_rels, pa_rels = [], []
    for y in range(start_year, end_year + 1):
        for m in range(12):
            et = str_to_et(f"{y:04d}-{m + 1:02d}-15T00:00:00")
            R_iau = iau_to_j2000(et)
            me_rels.append(R_iau.T @ me_to_j2000(et))
            pa_rels.append(R_iau.T @ pa_to_j2000(et))
    R_me = _mean_rotation(me_rels)
    R_pa = _mean_rotation(pa_rels)
    me_dev = max(rotation_angle_deg(R_me.T @ R) for R in me_rels)
    pa_dev = max(rotation_angle_deg(R_pa.T @ R) for R in pa_rels)
    return {
        "reference_epoch": REFERENCE_EPOCH_ISO,
        "me_to_iau": R_me.ravel().tolist(),
        "pa_to_iau": R_pa.ravel().tolist(),
        "me_max_residual_deg": me_dev,
        "pa_max_residual_deg": pa_dev,
        "me_rotation_angle_deg": rotation_angle_deg(R_me),
        "pa_rotation_angle_deg": rotation_angle_deg(R_pa),
        "grid": f"{start_year}-01..{end_year}-12 monthly",
    }


# --- Frame classification -------------------------------------------------
# Recognized source-frame tokens (case-insensitive, normalized). ME and PA are
# transformable to the ephemeris IAU frame; an explicitly IAU frame needs no
# correction. Anything else is unverified and blocked from quantitative use.
_ME_TOKENS = {"MOON_ME", "MOON_ME_DE421", "ME", "ME_DE421", "IAU_ME"}
_PA_TOKENS = {"MOON_PA", "MOON_PA_DE421", "PA", "PA_DE421"}
_IAU_TOKENS = {"IAU", "IAU_MOON", "IAU2015", "IAU_2015", "MOON_IAU", "IAU_MOON_2015"}


def _normalize(frame: Optional[str]) -> str:
    if not frame:
        return ""
    return "".join(ch for ch in frame.upper() if ch.isalnum() or ch == "_").strip("_")


def classify_frame(frame: Optional[str]) -> dict:
    """Return {recognized, transform, note} for a declared DEM frame.

    transform is one of 'me', 'pa', 'iau', or None (unrecognized).
    """
    norm = _normalize(frame)
    if norm in _ME_TOKENS:
        return {"recognized": True, "transform": "me",
                "note": "MOON_ME (DE421). Compatible with the IAU 2015 ephemeris frame after a verified <=0.004 deg correction."}
    if norm in _PA_TOKENS:
        return {"recognized": True, "transform": "pa",
                "note": "MOON_PA (DE421). Converted to the IAU 2015 ephemeris frame via the fixed 0.0288 deg PA->ME rotation plus a verified <=0.004 deg residual."}
    if norm in _IAU_TOKENS:
        return {"recognized": True, "transform": "iau",
                "note": "Already an IAU Moon frame; no correction required (verify the report version matches IAU 2015)."}
    return {"recognized": False, "transform": None,
            "note": f"Unrecognized lunar reference frame '{frame or '(unspecified)'}'. Cannot verify compatibility with the IAU 2015 ephemeris frame; blocked from quantitative mission visibility."}


def convert_site(lat_deg: float, lon_deg: float, R: np.ndarray) -> dict:
    """Rotate a body-fixed site (lat/lon) and its local north by R (source->IAU).

    Returns the IAU-frame latitude/longitude and the azimuth offset (degrees) to
    add to source-frame azimuths so they align with IAU-frame azimuths measured
    from local north. East-positive longitude, planetocentric latitude.
    """
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    cl, sl = math.cos(lat), math.sin(lat)
    co, so = math.cos(lon), math.sin(lon)
    up = np.array([cl * co, cl * so, sl])
    east = np.array([-so, co, 0.0])
    north = np.array([-sl * co, -sl * so, cl])
    up2 = R @ up
    north2 = R @ north
    lat2 = math.degrees(math.asin(max(-1.0, min(1.0, up2[2]))))
    lon2 = math.degrees(math.atan2(up2[1], up2[0]))
    # Local north in the rotated frame, projected onto the tangent plane at up2.
    east2 = np.cross(up2, north2)
    east2 /= np.linalg.norm(east2)
    north2_proj = north2 - up2 * float(np.dot(north2, up2))
    north2_proj /= np.linalg.norm(north2_proj)
    # Azimuth of the rotated source-north relative to the IAU local north.
    # IAU local north at the new point:
    lat2r, lon2r = math.radians(lat2), math.radians(lon2)
    north_iau = np.array([-math.sin(lat2r) * math.cos(lon2r), -math.sin(lat2r) * math.sin(lon2r), math.cos(lat2r)])
    east_iau = np.array([-math.sin(lon2r), math.cos(lon2r), 0.0])
    az_offset = math.degrees(math.atan2(float(np.dot(north2_proj, east_iau)), float(np.dot(north2_proj, north_iau))))
    return {"latitude": lat2, "longitude": lon2, "azimuth_offset_deg": az_offset}
