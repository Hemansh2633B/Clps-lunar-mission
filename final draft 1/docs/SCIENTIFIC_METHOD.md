# Scientific method & audit notes · CHANDRA // OPS

This document records the physical models, reference frames, validation evidence, and
**explicit limitations** behind the console. It is written so a reviewer can reproduce
every number and see exactly where the tool is an engineering heuristic rather than a
certified flight analysis. Nothing here upgrades illustrative or synthetic data into a
scientific result.

Companion files: `docs/VERIFICATION.md` (executed test evidence), `tests/data/frame-reference.json`
(SPICE validation reference), `backend/lunar_frame.py` and `scripts/generate-frame-constants.py`
(authoritative frame constants generator).

---

## 1. Reference frames and compatibility

### The problem

The mission ephemeris uses the **IAU 2015 Moon rotation** (`astronomy-engine`
`RotationAxis(Body.Moon)` + `Libration`). NASA LOLA south-polar DEMs (PGDA product 90,
`LDEM_80S_20MPP_ADJ.TIF`) are published in **MOON_ME (JPL DE421)**. These are *different*
body-fixed realizations. Combining them silently would mis-place the site and rotate the
horizon mask by an unknown amount.

### What SPICE shows

Using `spiceypy` with `de421.bsp` + `moon_pa_de421_1900-2050.bpc` + `moon_080317.tf` +
`pck00008.tpc` (see `data/kernels/PROVENANCE.json`, fetched by `scripts/fetch-spice-kernels.py`):

- `MOON_ME_DE421` (frame 31007) differs from `MOON_PA_DE421` by the fixed rotation
  67.92″ / 78.56″ / 0.30″ about axes 3, 2, 1 → **0.028847°**.
- The **IAU 2015 frame is close to MOON_ME, not MOON_PA** (the IAU prime meridian is the
  mean-Earth direction). A constant rotation removes the mean ME→IAU bias.
- The PCK orientation coverage spans **1899–2050**, so the correction is valid across the
  mission-planning horizon.

### Shipped correction

`scripts/generate-frame-constants.py` fits constant `ME_TO_IAU` and `PA_TO_IAU` rotations
**targeting the app's own `astronomy-engine` IAU frame** (sampled monthly 2020–2035 via
`scripts/iau-frame-grid.ts`), not SPICE's `IAU_MOON` (the two differ by ~0.001° because of
coefficient-version differences). Results (`src/engine/lunarFrameData.ts`, auto-generated):

| Transform | Mean rotation angle | Max residual over 2020–2035 |
|---|---|---|
| ME → IAU | 0.001677° | **0.003869°** |
| PA → IAU | 0.027525° | **0.003869°** |

The residual (~0.0039°, ≈120 m on the surface) is **disclosed everywhere** as a frame-model
uncertainty. This is a *constant* approximation, **not** a rigorous time-dependent
transformation; it is adequate for planning-grade visibility, not for geodesy.

### Gating (never mix frames silently)

`src/engine/lunarFrame.ts` `classifyFrame` recognizes MOON_ME / MOON_PA / IAU tokens
(including parenthetical qualifiers such as `MOON_ME (JPL DE421)`).

- **Recognized frame** → `frameVerified = true`: the site coordinates are rotated into IAU
  (`convertSite`) and the horizon mask azimuths are rotated by the matching offset
  (`rotateMaskAzimuths`); the residual is recorded.
- **Unrecognized frame** → `frameVerified = false`: the terrain is **viewable in Terrain Lab**
  but **blocked from quantitative mission visibility** (`horizonImportBlocked` returns a
  `FRAME UNVERIFIED` message; the "Use in mission" button is disabled). The Telemetry panel
  shows a red banner and the export carries the warning.
- **Synthetic demo** → allowed as a clearly labeled demo; never frame-verified as real data.

---

## 2. Independent ephemeris validation

`tests/ephemeris-validation.test.ts` compares the app against an **independent SPICE
evaluation** (`tests/data/frame-reference.json`): 9 epochs (2026-06 → 2027-06) × 6 sites
including the exact south pole, a near-pole point, and several longitudes. The IAU frame is
evaluated by SPICE from `pck00008.tpc`, independent of `astronomy-engine`.

Conventions: planetocentric latitude, east-positive longitude, azimuth from north toward
east. Sub-Earth uses geometric light-time (LT); sub-solar and topocentric az/el use LT+S
(light-time + stellar aberration). Radius 1,737,400 m.

**Measured maximum errors (fixed tolerances, not tuned to pass):**

| Quantity | Max error | Tolerance |
|---|---|---|
| Sun elevation | 0.000576° | 0.01° |
| Earth elevation | 0.000246° | 0.01° |
| Azimuth (Sun & Earth) | 0.007181° | 0.02° |
| IAU frame angle vs SPICE | 0.001028° | 0.002° |
| Sub-Earth point lat/lon | 0.006173° | 0.01° |
| Constant ME→IAU vs exact (position) | ≤ residual | 0.005° |

A topocentric parallax bug in the sub-Earth point (previously ~0.26°) was found and fixed
during this audit; the sub-Earth point is now selenocentric. Light-time and aberration are
retained. Near the exact pole, raw longitude is ill-defined (amplified by 1/cos lat), so the
conversion test asserts **angular position separation**, bounded by the disclosed residual.

---

## 3. Sampling and transition refinement

- **Uniform capped sampling** (`simulateMission`): the window is sampled uniformly with
  `count = min(20000, max(2, floor(span/step)+1))`. If the requested step exceeds the cap,
  the step is **coarsened uniformly across the whole span**, preserving both endpoints.
  Example: 90 days @ 1 min → 129,601 requested → **20,000 samples @ 6.4803 min**, max gap =
  effective step (no giant final jump). `SamplingInfo` reports requested vs effective step,
  sample count, capped flag, and max gap.
- **Adaptive transition refinement** (`findTransitions`): consecutive-sample sign changes
  alone miss a short window inside one coarse interval. Each interval is flagged when
  clearances change sign **or** approach zero within a kinematic rate bound, then recursively
  subdivided (pruning safe halves) down to 15 s and bisected (`refineCrossing`). A per-interval
  node budget bounds worst-case work. This is ~6× faster than a uniform fine sub-scan and
  resolves short windows the coarse grid would skip.
- **Percentages and gaps** integrate the **refined crossing timestamps** (exact interval
  boundaries), not a coarse trapezoid over samples, so they converge as sampling is refined.
  Convergence is asserted in `tests/sampling-battery.test.ts` (coarse 240 min vs fine 30 min
  agree to <0.5% illumination and ≤1 event).

---

## 4. Power and battery assumptions (engineering, not survival)

- **Solar flux**: 1361/au² W/m². Idealized incidence: horizontal deck ∝ sin(el),
  tracking mast ∝ cos(el), fixed mast ∝ cos(el)·cos(Δaz). **Zero output when the Sun is
  terrain-occulted.** No temperature, dust, degradation, or wiring losses beyond `systemDerate`.
- **Battery** (`simulateBattery`): charge efficiency **0.92**, discharge efficiency **0.95**,
  hard SOC bounds [0, capacity], configurable initial SOC, per-interval integration (valid for
  irregular steps), zero-crossing interpolated within the crossing interval. Robustness tests
  cover irregular steps, saturation, long darkness, large surplus, initial SOC, and empty input.
- This is an **energy-balance model only**. It does **not** model thermal survival, radiation,
  depth-of-discharge life, or heater loads. The verdict `ENERGY DEFICIT` (renamed from the
  misleading `SURVIVAL RISK`) reflects the battery model reaching 0%, not spacecraft survival.

---

## 5. Feasibility score — a disclosed heuristic

The score is **application-defined, not a NASA methodology**:

```
score = round( combined·0.45 + illumination·0.20 + earthLOS·0.15 + energy·0.20 )
energy = depletionHours ≤ 0 ? 100 : clamp(100 − depletionH/durationH·160, 0, 100)
```

`MissionSummary.scoreBreakdown` exposes every component, weight, and contribution; the
Telemetry panel and JSON export display them with a "heuristic" stamp. **Data confidence is
separate from performance**: the comparison matrix ranks "Best" only within the highest
confidence tier present, so illustrative/synthetic terrain is never crowned over a measured DEM.

---

## 6. Honest terminology

- **Earth visibility is geometric line-of-sight**, center-of-disk, no refraction — **not an RF
  link budget** (no antenna gain, transmit power, coding, or pointing loss). "DTE open" means
  Earth clears the terrain, not that a radio link is closed.
- **Array output is instantaneous power (W)**, distinct from net energy (kWh) which accounts
  for the load and battery efficiency.
- **Battery result ≠ survival** (see §4).

---

## 7. Landing-site catalogue & provenance

- **Nine Artemis III candidate regions** (NASA, Oct 28 2024; NTRS
  [20250011660](https://ntrs.nasa.gov/citations/20250011660)): Peak near Cabeus B, Haworth,
  Malapert Massif, Mons Mouton Plateau, Mons Mouton, Nobile Rim 1, Nobile Rim 2,
  de Gerlache Rim 2, Slater Plain. NASA publishes **regions (~15 km across), not precise
  landing points**. The catalogue uses **approximate region centers** (`coordinateType =
  region-center`, `dataConfidence = region-approximate`, ±0.5° uncertainty) with the source URL
  and date — never invented precise coordinates. Terrain relief is illustrative.
- **Historical polar candidates** (Shackleton Rim, Connecting Ridge, Leibnitz β) are labeled
  `Historical polar candidate` / `illustrative`, distinct from the Artemis III set.
- **Apollo 11 / 17 and Chang'e 4** are kept separate with **published surveyed coordinates**
  (`coordinateType = surveyed`); their horizon here is an idealized flat model, so terrain
  confidence stays `illustrative`.

Each site carries: stable id, name, program, coordinates + provenance + type + uncertainty,
elevation provenance, terrain source/resolution/frame, source URL, publication date, and
confidence. The persistent `ProvenanceIndicator` reflects the actual computation state:
`SYNTHETIC DEMO`, `ILLUSTRATIVE TERRAIN`, `INCOMPLETE COVERAGE`, `REAL DEM — FRAME UNVERIFIED`,
or `REAL DEM — FRAME VERIFIED`.

---

## 8. Multiscale terrain — current scope and limits

The Terrain Lab ray-marches a **local** horizon within the requested crop (backend radius
limit 0.5–20 km). The mission profile records `analysisScale = local`, `radiusKm`,
`horizonRadiusKm`, and `coveragePercent`, and states explicitly that **a 20 km crop is not a
regional distant-horizon model** — obstructions beyond the crop are not captured.

Regional analysis (distant massifs tens–hundreds of km away) would require the PGDA regional
products (e.g. product 90 polar LDEM and product 78 high-resolution site products: LDEM,
height uncertainty, effective resolution, LDSM slope, LDEC counts). **NASA PGDA is outside the
sandbox network allowlist**, so real regional DEMs could not be downloaded here. The data model
(`analysisScale`, `regionalRadiusKm`, `verticalUncertaintyM`, `effectiveResolutionM`,
`productVersion`) is in place to carry that metadata when a real regional product is supplied;
until then the tool does **not** fabricate regional horizons or NoData elevations. Azimuth-bin
resolution is never presented as vertical accuracy.

---

## 9. State consistency & export integrity

- Results are keyed to the exact input configuration (`simulationKey` includes site, terrain +
  frame metadata, UTC interval, and config). `useSimulation` returns **cached-or-null for the
  active key** with a render-time guard, so a date/site change never shows stale results, and
  superseded worker requests cannot overwrite a newer key.
- Exports are **blocked while computing or errored**. The JSON report carries a full
  `reproducibility` block (UTC interval, ephemeris model + frame, terrain source/resolution/
  coverage/radius/frame, sampling, power/battery assumptions, score methodology, site
  provenance, and warnings). CSVs include `data_confidence`, `frame_verified`, and effective
  sampling step. Heuristic scores, illustrative terrain, and frame-unverified DEMs are always
  disclosed, never exported as measured/scientific.
