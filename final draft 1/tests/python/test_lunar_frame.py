"""Authoritative lunar-frame module: classification, site conversion, and (when SPICE
kernels are present) orthonormality, the ME->PA offset, and the constant-correction
residual. Also checks Python convert_site against the shared frontend reference so the
TS and Python conversion algorithms stay in parity.
"""
import json
import math
from pathlib import Path

import numpy as np
import pytest

from backend import lunar_frame as lf

REF = json.loads((Path(__file__).resolve().parents[1] / "data" / "frame-reference.json").read_text())
HAS_KERNELS = lf.kernels_available()
needs_kernels = pytest.mark.skipif(not HAS_KERNELS, reason="SPICE kernels not present (run scripts/fetch-spice-kernels.py)")


@pytest.mark.parametrize("frame,transform", [
    ("MOON_ME", "me"),
    ("MOON_ME_DE421", "me"),
    ("MOON_ME (JPL DE421)", "me"),   # real LOLA product string
    ("MOON_PA (JPL DE421)", "pa"),
    ("MOON_PA", "pa"),
    ("IAU_MOON", "iau"),
    ("IAU 2015 Moon", "iau"),
])
def test_classify_recognized(frame, transform):
    c = lf.classify_frame(frame)
    assert c["recognized"] is True
    assert c["transform"] == transform


@pytest.mark.parametrize("frame", ["SOME_UNKNOWN_FRAME", "MysteryFrame", "", None, "Synthetic test frame"])
def test_classify_unrecognized(frame):
    c = lf.classify_frame(frame)
    assert c["recognized"] is False
    assert c["transform"] is None
    assert "blocked" in c["note"].lower()


def test_convert_site_identity_is_noop():
    out = lf.convert_site(-45.0, 30.0, np.eye(3))
    assert out["latitude"] == pytest.approx(-45.0, abs=1e-9)
    assert out["longitude"] == pytest.approx(30.0, abs=1e-9)
    assert out["azimuth_offset_deg"] == pytest.approx(0.0, abs=1e-9)


def test_convert_site_matches_frontend_reference():
    # The shipped constant ME->IAU matrix (frontend) must reproduce the reference
    # conversions computed by the Python generator -> TS/Python algorithm parity.
    R = np.array(REF["constants"]["me_to_iau"]).reshape(3, 3)
    for c in REF["conversions"]:
        out = lf.convert_site(c["me_lat"], c["me_lon"], R)
        assert out["latitude"] == pytest.approx(c["constant"]["latitude"], abs=1e-6)
        assert out["longitude"] == pytest.approx(c["constant"]["longitude"], abs=1e-6)
        assert out["azimuth_offset_deg"] == pytest.approx(c["constant"]["azimuth_offset_deg"], abs=1e-6)
        # Constant approximation stays within the disclosed residual of the exact rotation.
        sep = _angular_separation(out["latitude"], out["longitude"],
                                  c["exact_at_ref"]["latitude"], c["exact_at_ref"]["longitude"])
        assert sep < REF["constants"]["me_max_residual_deg"] * 1.3


def _angular_separation(lat1, lon1, lat2, lon2):
    def vec(la, lo):
        a, b = math.radians(la), math.radians(lo)
        return np.array([math.cos(a) * math.cos(b), math.cos(a) * math.sin(b), math.sin(a)])
    d = float(np.dot(vec(lat1, lon1), vec(lat2, lon2)))
    return math.degrees(math.acos(max(-1.0, min(1.0, d))))


@needs_kernels
def test_frame_matrices_are_orthonormal():
    et = lf.str_to_et("2027-01-01T00:00:00")
    for fn in (lf.me_to_j2000, lf.pa_to_j2000, lf.iau_to_j2000):
        R = fn(et)
        assert np.allclose(R @ R.T, np.eye(3), atol=1e-12)
        assert np.linalg.det(R) == pytest.approx(1.0, abs=1e-12)


@needs_kernels
def test_me_pa_offset_is_about_0_0288_deg():
    et = lf.str_to_et("2027-01-01T00:00:00")
    rel = lf.me_to_j2000(et).T @ lf.pa_to_j2000(et)
    assert lf.rotation_angle_deg(rel) == pytest.approx(0.028847, abs=0.001)


@needs_kernels
def test_iau_close_to_me_not_pa():
    et = lf.str_to_et("2027-01-01T00:00:00")
    me_iau = lf.rotation_angle_deg(lf.me_to_j2000(et).T @ lf.iau_to_j2000(et))
    pa_iau = lf.rotation_angle_deg(lf.pa_to_j2000(et).T @ lf.iau_to_j2000(et))
    assert me_iau < 0.01          # IAU ~ MOON_ME
    assert pa_iau > 0.02          # IAU far from MOON_PA
    assert me_iau < pa_iau


@needs_kernels
def test_constant_correction_residual_is_disclosed_and_small():
    c = lf.constant_corrections(2024, 2028)  # short grid for speed
    assert c["me_max_residual_deg"] < 0.005
    assert c["pa_max_residual_deg"] < 0.005
    assert c["me_rotation_angle_deg"] < 0.01
    R = np.array(c["me_to_iau"]).reshape(3, 3)
    assert np.allclose(R @ R.T, np.eye(3), atol=1e-9)
