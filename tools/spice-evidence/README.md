# SPICE frame-evidence tool (optional, isolated)

CHANDRA's application, development servers, test suite (`npm run test:all`) and
Vercel deployment are **Python-free**. This directory is the one deliberate
exception: an offline maintenance tool that regenerates the *independent SPICE
evidence* behind the lunar reference-frame constants. It is kept because JPL's
SPICE toolkit has no dependency-free Go/TypeScript equivalent and removing the
tool would remove the ability to re-derive that evidence.

| File | Purpose |
| --- | --- |
| `lunar_frame.py` | SPICE (DE421) frame authority: MOON_ME / MOON_PA / IAU_MOON rotations. |
| `fetch_spice_kernels.py` | Downloads the four checksummed kernels into `data/kernels/` (git-ignored). |
| `generate_frame_constants.py` | Regenerates `src/engine/lunarFrameData.ts` and `tests/data/frame-reference.json`. |
| `test_lunar_frame.py` | Kernel-gated checks of the constants against SPICE. |

The recorded evidence (`tests/data/frame-reference.json`) is what the product
actually consumes; it is validated on every run by the TypeScript suite
(`tests/ephemeris-validation.test.ts`) and the Go suite (`backend/frames`).

```bash
python3 -m venv .venv-spice
.venv-spice/bin/pip install -r tools/spice-evidence/requirements.txt
.venv-spice/bin/python tools/spice-evidence/fetch_spice_kernels.py
.venv-spice/bin/python -m pytest tools/spice-evidence -q -rs
.venv-spice/bin/python tools/spice-evidence/generate_frame_constants.py   # only to regenerate
```

The frame allowlist and constant-rotation maths formerly in `lunar_frame.py`
are also implemented natively in `backend/frames` (Go) and
`src/engine/lunarFrame.ts`; all three are held together by
`tests/golden/python/frames.json`.
