package lunarcrs

import (
	"math"
	"testing"
)

const moonR = 1737400.0

func near(t *testing.T, what string, got, want, tol float64) {
	t.Helper()
	if math.Abs(got-want) > tol || math.IsNaN(got) {
		t.Fatalf("%s: got %.9f, want %.9f (tolerance %g)", what, got, want, tol)
	}
}

// Expected values are hard-coded numbers computed outside this package from the
// textbook spherical formulas (Snyder, Map Projections: A Working Manual):
// stereographic rho = 2R tan(c/2), azimuthal equidistant rho = R c, where c is
// the angular distance from the projection centre.
func TestForwardMatchesClosedForms(t *testing.T) {
	const (
		rhoStere1deg  = 30324.12019932864   // 2R tan(0.5 deg)
		rhoStere5deg  = 151713.0444184977   // 2R tan(2.5 deg)
		rhoStere10deg = 304005.6080198807   // 2R tan(5 deg)
		arc1deg       = 30323.35042414948   // R * 1 deg
		arc10deg      = 303233.5042414948   // R * 10 deg
		arcMinus80deg = -2425868.0339319585 // R * -80 deg
	)
	south := Sphere(PolarStereographic, moonR, -90, 0, -90)
	// LOLA south-polar convention: +Y toward 0 deg longitude, +X toward 90 deg E.
	for _, c := range []struct{ lon, lat, x, y float64 }{
		{0, -89, 0, rhoStere1deg},
		{90, -85, rhoStere5deg, 0},
		{180, -80, 0, -rhoStere10deg},
		{270, -85, -rhoStere5deg, 0},
		{-90, -85, -rhoStere5deg, 0},
		{0, -90, 0, 0},
	} {
		x, y, ok := south.Forward(c.lon, c.lat)
		if !ok {
			t.Fatalf("south polar forward failed at %v", c)
		}
		near(t, "south polar x", x, c.x, 1e-6)
		near(t, "south polar y", y, c.y, 1e-6)
	}
	north := Sphere(PolarStereographic, moonR, 90, 0, 90)
	// North-polar convention: 0 deg longitude points toward -Y.
	x, y, _ := north.Forward(0, 89)
	near(t, "north polar x", x, 0, 1e-6)
	near(t, "north polar y", y, -rhoStere1deg, 1e-6)
	x, y, _ = north.Forward(90, 85)
	near(t, "north polar x", x, rhoStere5deg, 1e-6)
	near(t, "north polar y", y, 0, 1e-6)

	// Oblique stereographic: the centre maps to the origin; one degree due north is +Y.
	oblique := Sphere(ObliqueStereographic, moonR, -85, 30, 0)
	x, y, _ = oblique.Forward(30, -85)
	near(t, "oblique centre x", x, 0, 1e-6)
	near(t, "oblique centre y", y, 0, 1e-6)
	x, y, _ = oblique.Forward(30, -84)
	near(t, "oblique north x", x, 0, 1e-6)
	near(t, "oblique north y", y, rhoStere1deg, 1e-6)

	aeqd := Sphere(AzimuthalEquidistant, moonR, -90, 0, 0)
	x, y, _ = aeqd.Forward(0, -89)
	near(t, "aeqd x", x, 0, 1e-6)
	near(t, "aeqd y", y, arc1deg, 1e-6)
	x, y, _ = aeqd.Forward(90, -80)
	near(t, "aeqd x", x, arc10deg, 1e-6)
	near(t, "aeqd y", y, 0, 1e-6)

	eqc := Sphere(Equirectangular, moonR, 0, 0, 0)
	x, y, _ = eqc.Forward(10, -80)
	near(t, "eqc x", x, arc10deg, 1e-6)
	near(t, "eqc y", y, arcMinus80deg, 1e-6)
}

// A true-scale latitude other than the pole rescales the whole plane by (1+sin|lat_ts|)/2.
func TestPolarStereographicTrueScaleLatitude(t *testing.T) {
	pole := Sphere(PolarStereographic, moonR, -90, 0, -90)
	ts := Sphere(PolarStereographic, moonR, -90, 0, -71)
	_, y0, _ := pole.Forward(0, -80)
	_, y1, _ := ts.Forward(0, -80)
	near(t, "scale ratio", y1/y0, (1+math.Sin(71*math.Pi/180))/2, 1e-12)
	near(t, "meridional scale at the pole", pole.MeridionalScale(0, -90), 1, 1e-9)
}

func TestInverseRoundTrips(t *testing.T) {
	systems := map[string]*CRS{
		"south polar stereographic":       Sphere(PolarStereographic, moonR, -90, 0, -90),
		"north polar stereographic":       Sphere(PolarStereographic, moonR, 90, 0, 90),
		"south polar, rotated meridian":   Sphere(PolarStereographic, moonR, -90, 45, -90),
		"oblique stereographic":           Sphere(ObliqueStereographic, moonR, -85, 30, 0),
		"south polar azimuthal equidist.": Sphere(AzimuthalEquidistant, moonR, -90, 0, 0),
		"equirectangular":                 Sphere(Equirectangular, moonR, 0, 0, 0),
		"equirectangular, lat_ts 60":      Sphere(Equirectangular, moonR, 0, 180, 60),
		"geographic":                      Sphere(Geographic, moonR, 0, 0, 0),
	}
	for name, crs := range systems {
		north := crs.Lat0 > 0
		for _, lon := range []float64{-179.5, -120, -45, 0, 0.25, 33.3, 90, 135.75, 179.9} {
			for _, colat := range []float64{0.001, 0.1, 1, 3.5, 9.9} {
				lat := -90 + colat
				if north {
					lat = 90 - colat
				}
				x, y, ok := crs.Forward(lon, lat)
				if !ok {
					t.Fatalf("%s: forward failed at (%v, %v)", name, lon, lat)
				}
				gotLon, gotLat, ok := crs.Inverse(x, y)
				if !ok {
					t.Fatalf("%s: inverse failed at (%v, %v)", name, lon, lat)
				}
				near(t, name+" latitude", gotLat, lat, 1e-9)
				// Compare longitudes as arc length on the small circle: near the pole a
				// longitude error is harmless and poorly conditioned in degrees.
				dLon := Wrap180(gotLon - lon)
				near(t, name+" longitude (as arc)", dLon*math.Cos(lat*math.Pi/180), 0, 1e-9)
			}
		}
	}
}

func TestWrap180(t *testing.T) {
	for in, want := range map[float64]float64{0: 0, 180: -180, -180: -180, 190: -170, -190: 170, 360: 0, 540: -180, 359.5: -0.5, -359.5: 0.5} {
		near(t, "Wrap180", Wrap180(in), want, 1e-12)
	}
}

// The antipode of an azimuthal projection centre has no image.
func TestAntipodeIsRejected(t *testing.T) {
	if _, _, ok := Sphere(ObliqueStereographic, moonR, -85, 30, 0).Forward(210, 85); ok {
		t.Fatal("oblique stereographic accepted its antipode")
	}
	if _, _, ok := Sphere(AzimuthalEquidistant, moonR, -90, 0, 0).Forward(0, 90); ok {
		t.Fatal("azimuthal equidistant accepted its antipode")
	}
}
