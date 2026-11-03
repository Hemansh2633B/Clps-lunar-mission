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
"SELENE // OPS" paper-folio interface. They are **decorative illustrations**, not
scientific data, and must not be interpreted as measured lunar imagery:

- `patch.png` — embroidered-style mission patch used as the header/footer brand mark.
- `hero-lunar.jpg` — vintage illustration of a lander on a lunar ridge with Earth low on the horizon; used as the Field Guide hero plate.
- `lander.jpg` — watercolor lander study; used as the Site Context "rim study" plate.
- `ops-desk.jpg` — flight-ops desk photograph; used in the Field Guide "two readers, one solver" panel (Flight Ops).
- `classroom.jpg` — educator-and-students illustration; used in the same panel (Educator).

These appear only in branding and the Field Guide / Site Context plates. All
quantitative visualization (horizon panorama, polar map, Gantt, telemetry, 3D
terrain) is computed from the ephemeris/DEM engine, never from these images.
