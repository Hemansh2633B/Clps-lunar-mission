# Verification evidence · SELENE v1.4

This file records what was actually executed in the Arena sandbox. It distinguishes software-path verification from scientific validation.

## Automated suites

| Suite | Command | Result |
|---|---|---|
| TypeScript typecheck | `npm run typecheck` | clean |
| Production build | `npm run build` | clean; React / Three / ephemeris split into separate chunks |
| Engine + DEM-profile unit tests | `npm test` | **20 passed** (Vitest) |
| Backend / DEM / horizon / downloader / API errors | `npm run test:python` | **70 passed** (pytest) |
| Geometry checks | `npm run test:geometry` | passed: curvature, pole coordinates, Sun directions, exact landing origin, shadow casting, NoData topology, synthetic demo, horizon ray-marching |
| Horizon parity | `npm run test:parity` | passed: TypeScript and Python ray-marchers agree on elevations, coverage, edge inset, obstacle ranges |
| Mission + Terrain Lab browser E2E | `npm run test:browser` | passed: catalog, Apollo/far-side, comparison, educator, custom site, modal keyboard guard/focus, export, playback; Terrain Lab orbit drag, keyboard orbit, top/oblique presets, inspection pin, exaggeration, shadow pixel brightening, Sun extremes, all grid qualities, radius, horizon CSV/import, real-mode no-DEM safeguard, 390 px mobile layout |
| Real-DEM browser smoke | `npm run test:real-dem` | passed against the verification fixture below |

Python warnings are Rasterio `Affine` `*` vs `@` PendingDeprecationWarnings from the installed wheel; they do not indicate a SELENE failure.

## Real projected-DEM path

NASA PGDA (`pgda.gsfc.nasa.gov`) is outside the sandbox allowlist, so the native NASA COG downloader was **not** exercised against NASA here. Its range-probe, provenance, overwrite-refusal, and landing-elevation checks are covered by offline pytest mocks.

To verify the real projected-DEM loading/cropping/rendering path, `scripts/fetch-lola-verification-fixture.py` fetches a small public derivative from GitHub:

- Original product: NASA PGDA `LDEM_80S_20MPP_ADJ.TIF`, LOLA adjusted south-pole topography, MOON_ME / DE421.
- Derivative: `hparadiz/artemis-iii-landing-candidates`, `data/base_tiles/ldem_80s_20mpp_adj.tif_512.bin`.
- Reconstruction: 512×512 float32, south polar stereographic, spherical radius 1,737,400 m, extent ±304,000 m, pixel size 1,187.5 m. Projection centre verified as latitude −90°.

**Caveats:** this is a third-party bilinear downsample. The derivative author filled invalid source pixels before downsampling, so NoData coverage is not preserved. It is a software verification fixture, **not** a flight or science product.

Executed result at −89.5°, 45° E, radius 5 km:

| Quantity | Value |
|---|---|
| Landing elevation | ≈ −387.3 m |
| Sampled disk minimum | ≈ −904.2 m |
| Sampled disk maximum | ≈ +711.4 m |
| Disk coverage | 100% (fixture is gap-filled) |
| Horizon maximum elevation | ≈ 12.2° |
| Horizon ray coverage | 100% after disclosed edge inset |

These values are close to the prototype’s previously recorded native NASA crop (landing ≈ −393.8 m, range ≈ −915 … +697 m), which supports the software path but does not independently validate the source datum, frame, or shadow model.

Browser evidence: `screenshots/09-real-dem-lab.png`, `screenshots/10-real-dem-mission-site.png`.

## v1.3 correctness / robustness pass

- Battery depletion now interpolates the zero-crossing inside a sample interval instead of snapping to the next sample; cumulative depletion hours count only the post-depletion fraction.
- Power is terrain-relative: if the Sun is visible below the reference tangent because the local DEM horizon is depressed, a vertical mast can still track it; horizontal decks receive zero.
- Custom 8-sector horizons are exact at the edited azimuths and wrap periodically; they are labeled `kind: 'custom'`, not re-synthesized with illustrative ripple.
- DEM-aware UI: site catalog, site context, panorama sample count/elevation range, horizon table bin size, JSON/CSV disclaimers, and the status bar all reflect the selected terrain source.
- Global keyboard shortcuts are suppressed while a modal is open; dialogs have focus trapping, `role="dialog"`, and Escape-to-close. Toasts are `aria-live`.
- Simulation cache keys include terrain kind, resolution, eye height, source frame, synthetic flag, and the full horizon array.
- The Flask API returns JSON for 404/405/500, sets `nosniff`/`no-referrer` headers, and logs unexpected failures.
- Terrain Lab validates latitude/longitude/radius/eye height inline and disables invalid builds/horizon computations.

## v1.4 "SELENE // OPS" paper-folio redesign

- Ported the user-supplied reference design onto the working app: cream paper + dot grid,
  ink text, coral rule, plates with `+` register marks, rubber stamps, hard-shadow amber
  keys, Fraunces / Outfit / IBM Plex Mono, a constants ticker, and a full-width live clock
  strip (mission UTC · MJD · sub-solar · sub-earth) driven by the real ephemeris sample.
- All five user images are wired in as branding / Field Guide plates only (patch, hero,
  lander, ops-desk, classroom); provenance recorded in `public/assets/PROVENANCE.md`.
- Charts restyled to the paper palette (cream sky / ink terrain silhouette, sepia LROC
  polar map, amber/lagoon/emerald Gantt). The 3D Terrain Lab keeps a dark instrument screen.
- No functional regression: engine, DEM import, comparison, exports, shortcuts, modal
  focus guards, and mobile layout all unchanged and re-verified.
- Test-harness hardening: screenshots disable CSS animations (deterministic under
  SwiftShader), default timeout raised to 45 s, and the boot wait uses the structural
  `.app-header .display` selector instead of the ambiguous `text=SELENE` (which also
  matched the hidden `<title>`). Fixed a header flex bug where the brand collapsed to
  zero width when the clock cluster crowded the row.

## DEM horizon → mission planner

- Ray-marched elevations are copied verbatim into a `kind: 'dem'` terrain profile.
- No illustrative ripple, base offset, or elevation clamp is applied.
- Periodic interpolation uses the mask’s native azimuth resolution.
- Incomplete real masks are blocked from mission import; synthetic imports are allowed but labeled as demo data everywhere downstream.
- Site context, horizon table, CSV export, and JSON report carry source file, frame, coverage, radius, eye height, and sampling resolution.

## Not verified here

- Live NASA PGDA range download.
- Independent MOON_ME/DE421 ↔ IAU 2015 frame reconciliation.
- Flight-certified illumination, power, or landing safety.
- Hardware GPU performance; browser tests use software WebGL (SwiftShader).
