#!/usr/bin/env python3
"""Fetch authoritative SPICE kernels for lunar frame validation.

The NASA PGDA / NAIF servers are outside this project's network allowlist, so we
pull byte-identical mirrors of the NAIF kernels from public GitHub repositories
via the GitHub *git blob* API (base64; reliable for multi-MB binaries, unlike the
raw contents media type which can 502 through proxies).

Kernels (all NAIF/JPL public data):
  de421.bsp                       JPL DE421 planetary ephemeris (matches the PA PCK)
  moon_pa_de421_1900-2050.bpc     Moon principal-axes orientation vs ICRF (binary PCK)
  moon_080317.tf                  Lunar frame kernel (MOON_PA / MOON_ME / ME_DE421)
  naif0012.tls                    Leapseconds kernel
  pck00008.tpc                    Text PCK (IAU rotation constants, for cross-checks)

Mirrors:
  skyfielders/python-skyfield  ci/   (Skyfield's own CI kernel set)
  MillionConcepts/lhorizon     lhorizon/kernels/

Usage:  python scripts/fetch-spice-kernels.py [--dest data/kernels]
Requires GH_TOKEN or GITHUB_TOKEN in the environment (read-only public access).
Writes data/kernels/PROVENANCE.json with source URL + SHA-256 for each file.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

API = "https://api.github.com"
KERNELS = [
    ("de421.bsp", "skyfielders/python-skyfield", "ci/de421.bsp"),
    ("moon_pa_de421_1900-2050.bpc", "skyfielders/python-skyfield", "ci/moon_pa_de421_1900-2050.bpc"),
    ("moon_080317.tf", "skyfielders/python-skyfield", "ci/moon_080317.tf"),
    ("naif0012.tls", "MillionConcepts/lhorizon", "lhorizon/kernels/naif0012.tls"),
    ("pck00008.tpc", "skyfielders/python-skyfield", "ci/pck00008.tpc"),
]


def gh_get(url: str, token: str) -> dict:
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "chandra-kernel-fetch",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_one(name: str, repo: str, path: str, dest: Path, token: str) -> dict:
    out = dest / name
    meta = gh_get(f"{API}/repos/{repo}/contents/{path}", token)
    sha = meta["sha"]
    expected_size = meta.get("size")
    blob = gh_get(f"{API}/repos/{repo}/git/blobs/{sha}", token)
    if blob.get("encoding") != "base64":
        raise RuntimeError(f"Unexpected blob encoding for {name}: {blob.get('encoding')}")
    data = base64.b64decode(blob["content"])
    if expected_size is not None and len(data) != expected_size:
        raise RuntimeError(f"Size mismatch for {name}: got {len(data)}, expected {expected_size}")
    out.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    source_url = f"https://github.com/{repo}/blob/HEAD/{path}"
    print(f"  {name:34s} {len(data):>10,d} B  sha256={digest[:16]}…  <- {repo}")
    return {
        "file": name, "bytes": len(data), "sha256": digest, "git_blob_sha": sha,
        "source_repo": repo, "source_path": path, "source_url": source_url,
        "origin": "NAIF/JPL public SPICE kernel (byte-identical GitHub mirror)",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest", default="data/kernels")
    args = parser.parse_args()
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not token:
        print("ERROR: set GH_TOKEN or GITHUB_TOKEN (read-only public GitHub access).", file=sys.stderr)
        return 2
    dest = Path(args.dest)
    dest.mkdir(parents=True, exist_ok=True)
    print(f"Fetching {len(KERNELS)} SPICE kernels into {dest}/")
    provenance = []
    for name, repo, path in KERNELS:
        provenance.append(fetch_one(name, repo, path, dest, token))
    (dest / "PROVENANCE.json").write_text(json.dumps({
        "description": "Authoritative NAIF/JPL SPICE kernels for lunar ME/PA frame validation.",
        "note": "Mirrored from public GitHub repos because NAIF/PGDA are outside the network allowlist. "
                "Verify SHA-256 against NAIF if independent confirmation is required.",
        "kernels": provenance,
    }, indent=2) + "\n")
    print(f"Wrote {dest}/PROVENANCE.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
