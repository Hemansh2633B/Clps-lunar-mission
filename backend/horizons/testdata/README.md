# Recorded JPL Horizons responses

Responses of the NASA/JPL Horizons API (`https://ssd.jpl.nasa.gov/api/horizons.api`),
recorded on **2026-11-14** for deterministic, network-free tests. No value here is
synthesised and no number was edited.

**How they were recorded, and what that limits.** The development sandbox could not
reach `ssd.jpl.nasa.gov` directly, so the responses were retrieved through a
page-fetch tool and transcribed into these files. They are therefore *not*
byte-exact captures:

- whitespace may have been normalised by the tool (leading blank lines, runs of spaces);
- the long responses were truncated by the tool (see the "partial" rows below);
- in the `_x6` files the footer line beginning "Inquiries" was re-joined where the
  tool split the response into chunks;
- the Earth `_x6` file was assembled from the Sun transcript by replacing the four
  header lines that name the target and the six data rows with the ones the service
  returned for Earth; the remaining text is identical between the two responses.

The numbers are what matters to the tests, and each is as the service returned it.
To replace these with a direct capture on a machine that can reach JPL, run
`CHANDRA_LIVE_TESTS=1 go test ./backend/horizons -run Live` (checks the live value
against the recorded one) or fetch the URL asserted in `complete_test.go`.

| File | Query | Notes |
| --- | --- | --- |
| `sun_site-0E-89.9S_2026-12-18_1h.txt` | Sun (10) from `coord@301`, `SITE_COORD='0.0,-89.9,-1.2'`, 2026-12-18 00:00–03:00 UT, 1 h, `format=text`, `CAL_FORMAT` default | Header, table and row values verbatim. The long explanatory legend after `$$EOE` was abridged. |
| `sun_shackleton-me_2026-12_720m.partial.txt` | Sun (10), `SITE_COORD='359.450513,-89.900807,-1.2'`, 2026-12-01 → 2026-12-31 UT, `720 m`, `CAL_FORMAT='BOTH'` | **Partial:** rows 1–42 of 61 (through 2026-12-21 12:00 UT). The recording tool truncated the response; `$$EOE` was appended after the last retained row and the legend omitted. The header therefore still states the original stop time. |
| `earth_shackleton-me_2026-12_720m.partial.txt` | Earth (399), same site/span | Same partial-recording note. |
| `sun_shackleton-me_2026-12-01_720m_x6.txt` | Sun (10), same site, 2026-12-01 00:00 → 2026-12-03 12:00 UT, `720 m` | **Full-length** response (header, 6 rows, `$$EOE`, footer) to the exact URL `horizons.Query.URL` generates; the URL is asserted in `complete_test.go`. Transcribed, see above. |
| `earth_shackleton-me_2026-12-01_720m_x6.txt` | Earth (399), same query | Full-length response, assembled as described above. |

The site `359.450513 E, -89.900807` is CHANDRA's "Shackleton Crater Rim" catalogue
point (IAU 2015 frame: 89.9°S, 0°E, −1200 m) converted into Horizons' `MEAN_ME`
frame with the SPICE-verified constant rotation (`src/engine/lunarFrame.ts`).

Whitespace inside lines is as returned by the recording tool, which may have
normalised leading blank lines. `src/verification/recordedHorizons.json` is the
parsed form of the two partial files; a Go test fails if it drifts from them.

The `_x6` files double as the fixture for the browser end-to-end test
(`scripts/datahub-browser-test.mjs`): a loopback server replays them so the
whole live path (browser → native API → "Horizons" → validation → residuals)
runs without the network. Their six rows are identical to rows 1–6 of the
lunation recordings, which a test also checks.
