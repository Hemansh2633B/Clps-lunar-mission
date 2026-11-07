# Asset provenance

## lroc-south-pole.jpg
- **Product:** LROC WAC South Pole Mosaic, Polar Stereographic, 400 m/pixel.
- **Credit:** NASA / Goddard Space Flight Center / Arizona State University (LROC Science Operations Center).
- **Extent:** 80°S to the south pole. 0° meridian points down in the source image; 90°E points right.
- **Source page:** https://lroc.im-ldi.com/image_tags/Permanently%20Shadowed%20Regions (file `SP_Mosaic.400m.grid1.png`).
- **Processing:** cropped to the projected disk, resized to 1200×1200, converted to JPEG for delivery. The original annotated grid lines were removed by cropping to the disk; the application draws its own graticule.
- **Use:** scientific / educational visualization. This is imagery, not a digital elevation model. The app’s dynamic lighting overlay is geometric and does not represent measured terrain shadows.

## UI design assets (v1.4 paper-folio redesign)
The following files were supplied by the user as the visual reference for the
"CHANDRA // OPS" paper-folio interface. They are **decorative illustrations**, not
scientific data, and must not be interpreted as measured lunar imagery:

- `patch.png` — embroidered-style mission patch used as the header/footer brand mark.
- `hero-lunar.jpg` — vintage illustration of a lander on a lunar ridge with Earth low on the horizon; used as the Field Guide hero plate.
- `lander.jpg` — watercolor lander study; used as the Site Context "rim study" plate.
- `ops-desk.jpg` — flight-ops desk photograph; used in the Field Guide "two readers, one solver" panel (Flight Ops).
- `classroom.jpg` — educator-and-students illustration; used in the same panel (Educator).

These appear only in branding and the Field Guide / Site Context plates. All
quantitative visualization (horizon panorama, polar map, Gantt, telemetry, 3D
terrain) is computed from the ephemeris/DEM engine, never from these images.

## Planet-viewer textures (v1.5 Space views)
Equirectangular (lat/lon) maps used **only as surface imagery** on the 3D globe
in the Planet time-lapse view. They carry no elevation or scientific data; the
illumination, terminator, sub-solar/sub-earth points and site markers are all
computed from the ephemeris engine (astronomy-engine + IAU 2015 Moon rotation).

- `moon_1024.jpg` — 1024×512 grayscale lunar albedo map, 0° meridian centred
  (near side). Source: `mrdoob/three.js` `examples/textures/planets/moon_1024.jpg`
  (https://github.com/mrdoob/three.js), fetched via the GitHub contents API.
  Used as the Moon's `map` + a subtle `bumpMap`. Not a LOLA/LROC data product.
- `earth_atmos_2048.jpg` — 2048×1024 Earth "Blue Marble" colour map, 0° meridian
  centred. Source: `mrdoob/three.js` `examples/textures/planets/earth_atmos_2048.jpg`,
  itself derived from NASA Visible Earth Blue Marble imagery (public domain).
  Used on the small Earth sphere, which is shown **for direction only — sizes and
  distances are not to scale** (labelled as such in the viewer).

Both are decorative/educational surface textures. The vehicle models in the Fleet
hangar (`src/three/vehicles.ts`) are **procedural, stylized massing models built
from primitives — not engineering CAD and not flight geometry**; dimensions quoted
in the spec panel are approximate public figures.
