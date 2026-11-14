# Recorded JPL Horizons responses

Genuine responses of the NASA/JPL Horizons API (`https://ssd.jpl.nasa.gov/api/horizons.api`),
recorded on **2026-11-14** for deterministic, network-free tests. Nothing here is
synthesised; values were never edited.

| File | Query | Notes |
| --- | --- | --- |
| `sun_site-0E-89.9S_2026-12-18_1h.txt` | Sun (10) from `coord@301`, `SITE_COORD='0.0,-89.9,-1.2'`, 2026-12-18 00:00–03:00 UT, 1 h, `format=text`, `CAL_FORMAT` default | Header, table and row values verbatim. The long explanatory legend after `$$EOE` was abridged. |
| `sun_shackleton-me_2026-12_720m.partial.txt` | Sun (10), `SITE_COORD='359.450513,-89.900807,-1.2'`, 2026-12-01 → 2026-12-31 UT, `720 m`, `CAL_FORMAT='BOTH'` | **Partial:** rows 1–42 of 61 (through 2026-12-21 12:00 UT). The recording tool truncated the response; `$$EOE` was appended after the last retained row and the legend omitted. The header therefore still states the original stop time. |
| `earth_shackleton-me_2026-12_720m.partial.txt` | Earth (399), same site/span | Same partial-recording note. |

The site `359.450513 E, -89.900807` is CHANDRA's "Shackleton Crater Rim" catalogue
point (IAU 2015 frame: 89.9°S, 0°E, −1200 m) converted into Horizons' `MEAN_ME`
frame with the SPICE-verified constant rotation (`src/engine/lunarFrame.ts`).

Whitespace inside lines is as returned by the recording tool, which may have
normalised leading blank lines. `src/verification/recordedHorizons.json` is the
parsed form of the two partial files; a Go test fails if it drifts from them.
