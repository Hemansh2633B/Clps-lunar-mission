

## 18. Curvature-aware lunar-body visibility, terrain incidence and relay geometry (v1.13)

### 18.1 Coordinate and time conventions

The simulation retains Astronomy Engine as its sole runtime ephemeris. The
IAU-era Moon body-fixed axes are transformed to the Astronomy Engine EQJ inertial
basis at each sample; site latitude is planetocentric north-positive and
longitude east-positive. Local azimuth is clockwise from north toward east;
elevation is above the site's local horizontal. The vector helpers and relay
models use kilometres, degrees and UTC milliseconds. The source frame and
rotation convention are explicit in `src/engine/ephemeris.ts` and
`src/types/geometry.ts`.

JavaScript UTC milliseconds do not encode leap-second labels. The engine hands
a `Date` to Astronomy Engine, which handles its own TT/UT conversion. CHANDRA
does not claim leap-second-level timing accuracy; all UI and export times are
labelled UTC. JPL Horizons and NAIF/SPICE remain independent verification paths,
not runtime inputs to the simulation. Existing recorded tolerances and measured
residuals are in §§15–16 and `docs/verification.md`.

### 18.2 Three different visibility tests

The phrase "above the horizon" was previously overloaded. It is now split into
three independent reported conditions:

1. **Geometric horizontal-plane test:** target centre elevation `e ≥ 0°`.
   This describes the local tangent plane only and is not used alone to declare
   visibility.
2. **Lunar-body occultation:** compare a target direction to the Moon's mean
   spherical limb. This answers whether the lunar body blocks the line of sight.
3. **Local terrain obstruction:** compare the target elevation with the
   azimuth-interpolated horizon mask derived from the site's terrain profile.

For an observer at radial distance `p` from a spherical Moon of radius `R`, the
apparent lunar angular radius is `α = asin(R/p)`, and the mean-limb elevation is
`α − 90°`. The curvature dip is `90° − α`. The effective obstruction used by
the local visibility result is `max(terrainHorizon, meanLimbElevation)`; Earth
communications margin, when configured, is an additional policy threshold and
is reported separately (`reason: margin`). The geometric plane, lunar body,
terrain and configured margin are never described as the same cause.

The target's apparent disk is included in the body-occlusion result. Its angular
radius is `asin(targetRadius / range)`; overlap of the apparent target disk and
the lunar limb is evaluated with the two-circle lens-area equation. The Sun is a
finite disk and the Earth is treated as a finite sphere of mean radius 6,371 km.
The *visibility timeline* remains centre-clearance based: partial disk exposure
is reported in `bodyOccultation` / `occultedFraction` but does not mean the
centre ray or an RF link is clear.

**Spherical-body limitation.** The body limb uses a 1,737.4 km reference sphere.
Actual lunar shape, limb topography (kilometre-scale), libration-dependent
ellipsoidal details and local relief beyond the DEM crop are not modeled as a
regional occultation surface. Thus the limb is a curvature correction, not a
high-resolution terrain model. Sites at/below the reference-sphere datum use a
zero-dip clamp to avoid an unphysical NaN or an entire-site blockage; outputs
mark this datum clamp. For those sites, the local terrain mask remains essential.

The vector ray/sphere test for relay links uses the finite segment and closest
approach, not just the elevation sign. It returns body clearance in kilometres.
The ray test's body sphere is clamped to the site radius for a below-datum
observer; local topography remains a separate ray/horizon test.

### 18.3 Solar surface illumination and incidence

Sun azimuth/elevation are topocentric in the same local frame as the terrain
mask. Sun visibility requires the Sun centre to clear both the spherical limb
and the local horizon; the existing adaptive crossing detector refines those
transitions to its 15-second resolution floor. Summary intervals and
illumination percentages use the refined transition events. A two-hour forward
search supplies next sunrise/sunset when the analysis window contains no
crossing, with a 35-day disclosed search horizon.

A flat surface with Sun elevation `e` has incidence `i = 90° − e`. For a DEM
slope `s` and GIS downslope aspect `a` (clockwise from north), the outward
normal in local east/north/up coordinates is

```
n = (sin(s) sin(a), sin(s) cos(a), cos(s))
s = (cos(e) sin(z), cos(e) cos(z), sin(e))
cos(i) = n · s
```

where `z` is Sun azimuth. Incidence is `acos(clamp(n·s,−1,1))`; direct beam
projection is clipped to zero when the facet faces away from the Sun. Terrain
slope/aspect is computed only when a validated raster grid is available, using
Horn's 3×3 gradient at the site-centred grid. NoData is not zero-filled; a
missing 3×3 neighbourhood yields "unavailable". An illustrative horizon mask
alone does not imply a surface slope. The established solar-array model remains
intact; `terrainSurfaceW` is an optional separate facet estimate, not a new
power-system model.

### 18.4 Earth: body versus local terrain

The Earth direction is calculated from the lunar site in the local frame and
body occultation uses the Moon-centre-to-site geometry. In the far-side
hemisphere the Earth ray passes through the Moon; `bodyOccultation` therefore
reports the lunar body as the blocker even if the local DEM is absent or flat.
Only after body clearance is local terrain considered. `earthOccludedPct` and
`earthTerrainBlockedPct` are separate summary fields. Longitude is a static
near/far/limb-band catalogue label only; per-epoch Earth visibility is computed
from the ephemeris and the body limb (libration can change visibility near the
limb).

A geometric Earth centre LOS is **not** an RF link. The model contains no radio
frequency, transmitter power, antenna gain/pattern, pointing, data rate,
polarisation, Doppler, link margin, ground-station location or interference
budget. It must not be interpreted as communication availability.

### 18.5 Relay architecture

A relay is a user-configured geometric state, optional in `MissionConfig` and
part of the exact simulation/cache key. The two links are independent:

- **site→relay:** inertial line segment clears the lunar body, and relay
  elevation clears the maximum of local terrain and spherical limb;
- **relay→Earth:** inertial segment to Earth's centre clears the lunar body.

`linkUp` means both geometric segments clear at the same sample. It is labelled
"relay geometry" in the UI/export and never means a radio link. Direct-to-Earth
`dtePct` remains a direct path and is not overwritten by relay results.

Implemented planning proxies:

- `circular-lunar`: two-body circular motion with a Kepler period (unless an
  override is supplied), user inclination/RAAN/phase in the J2000 equator frame.
  No perturbations, manoeuvres, station-keeping or mission ephemeris.
- `earth-moon-l2-halo`: collinear L2 distance is solved from the circular
  restricted three-body equilibrium; motion is a user-configured parametric
  ring in the plane normal to the Earth–Moon line. This is **not** a numerically
  corrected halo orbit, not a Queqiao ephemeris and not a mission design.
- `fixed-body`: static body-fixed latitude/longitude/altitude. Useful for
  a declared fixed state, not orbit propagation.

No operational relay ephemeris, ground terminal or link budget is bundled. A
user needs to supply an appropriate state/proxy and separately validate actual
RF performance.

### 18.6 Terrain coverage and regional products

All acquired raster data is inspected for CRS, lunar reference frame, vertical
datum, units, footprint, NoData, actual sample spacing and provenance before it
is used. The current built-in acquisition catalogue remains the existing NASA
PGDA south-polar LOLA COG family. It cannot cover arbitrary far-side regions.
A deployment may add a verified range-readable NASA/PDS product through the
strict `CHANDRA_LOLA_PRODUCTS_JSON` operator manifest described in
[`api.md`](api.md); this is extensibility, not evidence that a global/far-side
product is currently active. The application rejects an out-of-footprint
request rather than falling back to a different region, resolution, frame or
synthetic terrain.

Where dataset coverage/resolution/provenance is missing, the UI and exports use
"unavailable"/blank and preserve the reason. DEM pixel size is not vertical
accuracy. A local horizon crop is not a distant regional horizon; other basins
and ridges outside the crop cannot be represented.

### 18.7 Numerical tolerances and scope

- Existing Horizons / SPICE ephemeris residual thresholds are unchanged; see
  `docs/verification.md` and the recorded tolerance table above.
- The transition refinement floor is 15 seconds and the existing adaptive node
  budget/fallback diagnostics are unchanged.
- Spherical-limb geometry is analytic; no empirical residual is claimed for
  real topography at the limb.
- Horn slope is a local grid derivative. Its accuracy depends on input DEM
  resolution, NoData and vertical datum; CHANDRA does not manufacture an
  accuracy interval.
- Relay fractions use the requested sampling plus sample-based window edges;
  they are planning statistics, not schedule certification.

Reproducible candidates: select `Apollo 11 · Tranquility Base` (near-side
reference) and `Chang'e 4 · Von Kármán` (far-side reference), set one UTC start
and duration, pin both, then compare `Earth body blocked` and `Earth terrain
blocked`. The far-side centre is expected to have zero direct Earth visibility;
configure a relay in Mission Parameters to inspect separate two-leg geometry.
The Von Kármán coordinate is a published landing-point reference; the added
`Von Kármán crater` region-centre entry is a distinct approximate catalogue
region, not a surveyed landing site. For arbitrary sites, use **Synthesize
custom site**, enter planetocentric latitude / east longitude / elevation, and
review its explicit illustrative-terrain status before interpreting results.
