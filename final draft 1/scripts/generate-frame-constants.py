#!/usr/bin/env python3
"""Generate the frontend lunar-frame correction constants and an independent
SPICE validation reference dataset.

Outputs:
  src/engine/lunarFrameData.ts      constant ME->IAU / PA->IAU rotations + accuracy
  tests/data/frame-reference.json   SPICE reference (matrices, sub-points, topocentric
                                    Sun/Earth az/el) for ephemeris-validation tests

Requires the SPICE kernels (scripts/fetch-spice-kernels.py) and spiceypy.
The reference is generated with SPICE's own IAU_MOON evaluation (text PCK) and the
MOON_ME / MOON_PA_DE421 frames (binary PCK + frame kernel) — an independent code
path from astronomy-engine.
"""
from __future__ import annotations
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend import lunar_frame as lf  # noqa: E402

EPOCHS = [
    "2026-12-18T00:00:00", "2026-12-20T08:00:00", "2026-12-25T00:00:00",
    "2027-01-01T00:00:00", "2027-01-08T12:00:00", "2027-01-15T00:00:00",
    "2027-02-01T00:00:00", "2027-06-01T00:00:00", "2026-06-01T00:00:00",
]
# Sites expressed in the ephemeris (IAU) frame for pipeline validation.
SITES = [
    {"name": "shackleton", "lat": -89.9, "lon": 0.0, "elev_m": -1200.0},
    {"name": "polar_lon45", "lat": -89.5, "lon": 45.0, "elev_m": 0.0},
    {"name": "polar_lon135", "lat": -88.0, "lon": 135.0, "elev_m": 1000.0},
    {"name": "polar_lonW100", "lat": -87.0, "lon": -100.0, "elev_m": 500.0},
    {"name": "exact_south_pole", "lat": -90.0, "lon": 0.0, "elev_m": 0.0},
    {"name": "near_pole", "lat": -89.99, "lon": 30.0, "elev_m": 0.0},
]
MOON_RADIUS_M = 1737400.0


def topocentric_az_el(et, R_iau, lat, lon, elev_m, target):
    """SPICE topocentric az/el (deg) of target from a lunar site, IAU frame.

    Azimuth measured from local north toward east (east-positive), elevation
    above the local tangent. Light-time + stellar aberration ('LT+S').
    """
    import spiceypy as sp
    latr, lonr = math.radians(lat), math.radians(lon)
    cl, sl = math.cos(latr), math.sin(latr)
    co, so = math.cos(lonr), math.sin(lonr)
    up = np.array([cl * co, cl * so, sl])
    east = np.array([-so, co, 0.0])
    north = np.array([-sl * co, -sl * so, cl])
    radius = (MOON_RADIUS_M + elev_m) / 1000.0  # km
    observer_j2000 = R_iau @ (up * radius)
    # Target relative to Moon center, then to observer (km), apparent.
    tgt = np.array(sp.spkezr(target, et, "J2000", "LT+S", "MOON")[0][:3])
    topo = tgt - observer_j2000
    # Express the local basis in J2000 before projecting (topo is in J2000).
    east_j, north_j, up_j = R_iau @ east, R_iau @ north, R_iau @ up
    e = float(np.dot(topo, east_j)); n = float(np.dot(topo, north_j)); u = float(np.dot(topo, up_j))
    az = math.degrees(math.atan2(e, n)) % 360.0
    el = math.degrees(math.atan2(u, math.hypot(e, n)))
    return az, el


def subpoint(R_iau, et, target, aberration):
    import spiceypy as sp
    v = np.array(sp.spkezr(target, et, "J2000", aberration, "MOON")[0][:3])
    b = R_iau.T @ v
    b = b / np.linalg.norm(b)
    return {"lat": math.degrees(math.asin(b[2])), "lon": math.degrees(math.atan2(b[1], b[0]))}


def app_iau_grid() -> dict:
    """Run the astronomy-engine IAU grid dump (the app's actual ephemeris frame)."""
    res = subprocess.run(["npx", "tsx", str(ROOT / "scripts" / "iau-frame-grid.ts")],
                         capture_output=True, text=True, cwd=str(ROOT), check=True)
    grid = {}
    for line in res.stdout.strip().splitlines():
        p = line.split(",")
        grid[p[0]] = np.array([float(x) for x in p[1:]]).reshape(3, 3)
    return grid


def constants_targeting_app_iau() -> dict:
    """Mean ME->IAU / PA->IAU rotations targeting the app's astronomy-engine frame.

    Source orientations are SPICE MOON_ME / MOON_PA_DE421; the target is the app's
    actual IAU frame so the correction aligns DEM coordinates with the ephemeris
    the mission engine really uses (not SPICE's slightly different IAU_MOON).
    """
    grid = app_iau_grid()
    me_rels, pa_rels = [], []
    for iso, R_app in grid.items():
        et = lf.str_to_et(iso.replace("Z", ""))
        me_rels.append(R_app.T @ lf.me_to_j2000(et))
        pa_rels.append(R_app.T @ lf.pa_to_j2000(et))
    R_me = lf._mean_rotation(me_rels)
    R_pa = lf._mean_rotation(pa_rels)
    me_dev = max(lf.rotation_angle_deg(R_me.T @ R) for R in me_rels)
    pa_dev = max(lf.rotation_angle_deg(R_pa.T @ R) for R in pa_rels)
    return {
        "reference_epoch": lf.REFERENCE_EPOCH_ISO,
        "me_to_iau": R_me.ravel().tolist(),
        "pa_to_iau": R_pa.ravel().tolist(),
        "me_max_residual_deg": me_dev,
        "pa_max_residual_deg": pa_dev,
        "me_rotation_angle_deg": lf.rotation_angle_deg(R_me),
        "pa_rotation_angle_deg": lf.rotation_angle_deg(R_pa),
        "grid": "2020-01..2035-12 monthly (target: astronomy-engine IAU 2015)",
    }


def main() -> int:
    if not lf.kernels_available():
        print("ERROR: SPICE kernels unavailable. Run scripts/fetch-spice-kernels.py first.", file=sys.stderr)
        return 2
    const = constants_targeting_app_iau()
    R_me = np.array(const["me_to_iau"]).reshape(3, 3)

    # --- TS constants file ---
    def fmt(v):
        return f"{v:.12e}"
    ts = f"""// AUTO-GENERATED by scripts/generate-frame-constants.py — do not edit by hand.
// Source: SPICE DE421 + moon_pa_de421_1900-2050.bpc + moon_080317.tf + pck00008.tpc.
// Constant body-fixed -> IAU 2015 ephemeris-frame rotations (row-major 3x3).
// The IAU 2015 frame is verified close to MOON_ME; these remove the mean bias.
// Residual is the verified max time-variation over {const['grid']} and is disclosed
// as a frame-model uncertainty, never hidden.
export const FRAME_REFERENCE_EPOCH = '{const['reference_epoch']}';
export const ME_TO_IAU: readonly number[] = [{', '.join(fmt(v) for v in const['me_to_iau'])}];
export const PA_TO_IAU: readonly number[] = [{', '.join(fmt(v) for v in const['pa_to_iau'])}];
export const ME_IAU_MAX_RESIDUAL_DEG = {const['me_max_residual_deg']:.6f};
export const PA_IAU_MAX_RESIDUAL_DEG = {const['pa_max_residual_deg']:.6f};
export const ME_IAU_MEAN_ANGLE_DEG = {const['me_rotation_angle_deg']:.6f};
export const PA_IAU_MEAN_ANGLE_DEG = {const['pa_rotation_angle_deg']:.6f};
"""
    (ROOT / "src" / "engine" / "lunarFrameData.ts").write_text(ts)
    print("Wrote src/engine/lunarFrameData.ts")
    print(f"  ME->IAU mean angle {const['me_rotation_angle_deg']:.6f} deg, max residual {const['me_max_residual_deg']:.6f} deg")
    print(f"  PA->IAU mean angle {const['pa_rotation_angle_deg']:.6f} deg, max residual {const['pa_max_residual_deg']:.6f} deg")

    # --- validation reference ---
    import spiceypy as sp
    epochs = []
    for iso in EPOCHS:
        et = lf.str_to_et(iso)
        R_iau = lf.iau_to_j2000(et)
        R_me = lf.me_to_j2000(et)
        R_pa = lf.pa_to_j2000(et)
        sites = []
        for s in SITES:
            sun_az, sun_el = topocentric_az_el(et, R_iau, s["lat"], s["lon"], s["elev_m"], "SUN")
            earth_az, earth_el = topocentric_az_el(et, R_iau, s["lat"], s["lon"], s["elev_m"], "EARTH")
            sites.append({**s, "sun_az": sun_az, "sun_el": sun_el, "earth_az": earth_az, "earth_el": earth_el})
        epochs.append({
            "iso": iso, "et": et,
            "me_to_j2000": R_me.ravel().tolist(),
            "pa_to_j2000": R_pa.ravel().tolist(),
            "iau_to_j2000": R_iau.ravel().tolist(),
            "subearth_iau": subpoint(R_iau, et, "EARTH", "LT"),
            "subsolar_iau": subpoint(R_iau, et, "SUN", "LT+S"),
            "subearth_me": subpoint(R_me, et, "EARTH", "LT"),
            "sites": sites,
        })
    # Frame-conversion reference: ME sites converted with the constant R_me->iau,
    # compared against SPICE exact conversion at the reference epoch.
    ref_et = lf.str_to_et(lf.REFERENCE_EPOCH_ISO)
    R_exact = lf.iau_to_j2000(ref_et).T @ lf.me_to_j2000(ref_et)
    R_const = np.array(const["me_to_iau"]).reshape(3, 3)  # the shipped constant ME->IAU rotation
    conversions = []
    for s in SITES:
        conv_const = lf.convert_site(s["lat"], s["lon"], R_const)
        conv_exact = lf.convert_site(s["lat"], s["lon"], R_exact)
        conversions.append({"name": s["name"], "me_lat": s["lat"], "me_lon": s["lon"],
                            "constant": conv_const, "exact_at_ref": conv_exact})
    reference = {
        "source": "SPICE (spiceypy) DE421 + moon_pa_de421_1900-2050.bpc + moon_080317.tf + pck00008.tpc",
        "iau_frame": "IAU_MOON evaluated by SPICE from pck00008.tpc (independent of astronomy-engine)",
        "conventions": "planetocentric latitude, east-positive longitude, azimuth from north toward east",
        "constants": const,
        "epochs": epochs,
        "conversions": conversions,
    }
    out = ROOT / "tests" / "data" / "frame-reference.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(reference, indent=2) + "\n")
    print(f"Wrote {out} ({len(epochs)} epochs x {len(SITES)} sites)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
