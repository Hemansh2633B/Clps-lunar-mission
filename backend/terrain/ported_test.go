package terrain

// Native ports of the former pytest suite (tests/python/test_dem_crop.py,
// test_coordinates.py, test_horizon.py). Every raster generated here is a
// synthetic software fixture, never a lunar observation.

import (
	"bytes"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"chandra/backend/geotiff"
	"chandra/backend/lunarcrs"
)

const moonR = 1737400.0

type planeOpts struct {
	mutate  func(data []float64, n int)
	scale   *float64
	offset  *float64
	options map[string]any
}

// planeDEM reproduces the pytest `plane_dem` fixture: 401x401 float32 samples
// at 100 m in a local AEQD frame centred on (-89.5, 45), height = 100 + 0.01x + 0.02y.
func planeDEM(t testing.TB, o planeOpts) *Settings {
	t.Helper()
	n, spacing := 401, 100.0
	data := make([]float64, n*n)
	for r := 0; r < n; r++ {
		for c := 0; c < n; c++ {
			x, y := float64(c)*spacing-20000, 20000-float64(r)*spacing
			data[r*n+c] = float64(float32(100 + 0.01*x + 0.02*y))
		}
	}
	if o.mutate != nil {
		o.mutate(data, n)
	}
	var buf bytes.Buffer
	err := geotiff.Write(&buf, geotiff.WriteOptions{Width: n, Height: n, BitsPerSample: 32, SampleFormat: geotiff.SampleFloat, Data: data,
		Geotransform: [6]float64{-20050, spacing, 0, 20050, 0, -spacing}, GeoKeys: lunarcrs.Sphere(lunarcrs.AzimuthalEquidistant, moonR, -89.5, 45, 0).GeoKeys(),
		HasNoData: true, NoData: -9999, Tags: map[string]string{"LUNAR_SIM_SOURCE": "SYNTHETIC"}, Scale: o.scale, Offset: o.offset, TileSize: 128, Deflate: true})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "SYNTHETIC_TEST_PLANE.tif")
	if err := os.WriteFile(path, buf.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	opts := fixtureOptions()
	for k, v := range o.options {
		if v == nil {
			delete(opts, k)
		} else {
			opts[k] = v
		}
	}
	return &Settings{DEMPath: path, Options: opts}
}

func wantErr(t *testing.T, err error, fragment string) {
	t.Helper()
	if err == nil || !strings.Contains(err.Error(), fragment) {
		t.Fatalf("expected error containing %q, got %v", fragment, err)
	}
	if _, ok := err.(*Error); !ok {
		t.Fatalf("expected a user-facing terrain error, got %T", err)
	}
}

func TestNativeLandingElevation(t *testing.T) {
	d, err := OpenDEM(planeDEM(t, planeOpts{}))
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	if v, err := d.LandingElevation(-89.5, 45); err != nil || math.Abs(v-100) > 0.001 {
		t.Fatalf("landing = %v, %v", v, err)
	}
}

func TestWindowCropAndExactCenter(t *testing.T) {
	res, err := ExtractTerrain(planeDEM(t, planeOpts{}), -89.5, 45.0, 5.0, "low")
	if err != nil {
		t.Fatal(err)
	}
	n := res.Grid.Size
	if n != 129 || math.Abs(*res.Grid.Elevations[n/2*n+n/2]-100) > 0.001 {
		t.Fatalf("centre vertex wrong")
	}
	if res.Grid.Elevations[0] != nil {
		t.Fatal("square corners outside the analysis disk must be omitted")
	}
	if res.Statistics.CoveragePercent != 100 || !res.Synthetic || res.Statistics.RangeM <= 200 {
		t.Fatalf("unexpected statistics %+v synthetic=%v", res.Statistics, res.Synthetic)
	}
}

func TestElevationPlaneIsPreserved(t *testing.T) {
	s := planeDEM(t, planeOpts{})
	for _, q := range []string{"low", "medium", "high"} {
		res, err := ExtractTerrain(s, -89.5, 45.0, 5.0, q)
		if err != nil {
			t.Fatal(err)
		}
		g := NewGrid(5, q)
		for i, v := range res.Grid.Elevations {
			if v == nil {
				continue
			}
			want := 100 + 0.01*g.East(i%g.Size) + 0.02*g.North(i/g.Size)
			if math.Abs(*v-want) > 0.01 {
				t.Fatalf("%s cell %d = %v, plane %v", q, i, *v, want)
			}
		}
		if math.Abs(res.LandingElevation-100) > 0.001 {
			t.Fatalf("landing %v", res.LandingElevation)
		}
	}
}

func TestOutsideDEM(t *testing.T) {
	_, err := ExtractTerrain(planeDEM(t, planeOpts{}), -80.0, 45.0, 5.0, "medium")
	wantErr(t, err, "outside the DEM")
}

func hole(col, row, w, h int) func([]float64, int) {
	return func(data []float64, n int) {
		for r := row; r < row+h; r++ {
			for c := col; c < col+w; c++ {
				data[r*n+c] = -9999
			}
		}
	}
}

func TestNoDataLandingIsRejected(t *testing.T) {
	_, err := ExtractTerrain(planeDEM(t, planeOpts{mutate: hole(199, 199, 3, 3)}), -89.5, 45.0, 5.0, "medium")
	wantErr(t, err, "NoData gap")
}

func TestNoDataElsewhereRemainsAGap(t *testing.T) {
	res, err := ExtractTerrain(planeDEM(t, planeOpts{mutate: hole(220, 170, 15, 15)}), -89.5, 45.0, 5.0, "low")
	if err != nil {
		t.Fatal(err)
	}
	if !(res.Statistics.CoveragePercent > 85 && res.Statistics.CoveragePercent < 100) {
		t.Fatalf("coverage %v", res.Statistics.CoveragePercent)
	}
	n := res.Grid.Size
	i := int(math.Round((5000 - 2500) / res.Grid.SpacingM))
	j := int(math.Round((5000 + 2500) / res.Grid.SpacingM))
	if res.Grid.Elevations[i*n+j] != nil {
		t.Fatal("(east=2500, north=2500) is inside the deliberate source hole and must stay a gap")
	}
	if math.Abs(res.LandingElevation-100) > 1e-4 {
		t.Fatalf("landing %v", res.LandingElevation)
	}
}

func TestMissingVerticalOrFrameMetadataIsRejected(t *testing.T) {
	for _, field := range []string{"elevation_reference", "vertical_unit", "value_kind", "elevation_reference_radius_m", "lunar_reference_frame"} {
		_, err := OpenDEM(planeDEM(t, planeOpts{options: map[string]any{field: nil}}))
		wantErr(t, err, field)
	}
}

func TestUnknownUnitAndUnfilledExampleRejected(t *testing.T) {
	_, err := OpenDEM(planeDEM(t, planeOpts{options: map[string]any{"vertical_unit": "feet"}}))
	wantErr(t, err, "vertical_unit")
	_, err = OpenDEM(planeDEM(t, planeOpts{options: map[string]any{"elevation_reference": "REPLACE with actual datum"}}))
	wantErr(t, err, "elevation_reference")
	_, err = OpenDEM(planeDEM(t, planeOpts{options: map[string]any{"lunar_reference_frame": "replace me"}}))
	wantErr(t, err, "lunar_reference_frame")
	for _, bad := range []any{"abc", true, 6378137.0, math.Inf(1)} {
		_, err = OpenDEM(planeDEM(t, planeOpts{options: map[string]any{"elevation_reference_radius_m": bad}}))
		wantErr(t, err, "elevation_reference_radius_m")
	}
	_, err = OpenDEM(planeDEM(t, planeOpts{options: map[string]any{"scale": 0.0}}))
	wantErr(t, err, "scale must be finite and nonzero")
}

func TestBandScaleAndOffsetAppliedOnce(t *testing.T) {
	scale, offset := 0.5, 10.0
	res, err := ExtractTerrain(planeDEM(t, planeOpts{scale: &scale, offset: &offset}), -89.5, 45.0, 5.0, "low")
	if err != nil {
		t.Fatal(err)
	}
	src := res.Source.(*SourceInfo)
	centre := res.Grid.Size * res.Grid.Size / 2
	if math.Abs(res.LandingElevation-60) > 1e-4 || src.Scale != 0.5 || math.Abs(*res.Grid.Elevations[centre]-60) > 1e-4 {
		t.Fatalf("scale/offset misapplied: landing %v scale %v", res.LandingElevation, src.Scale)
	}
}

func TestRadiusValuesConvertedToElevation(t *testing.T) {
	// 1737400 + plane needs float64-exact arithmetic in the fixture: use km radius values instead.
	s := planeDEM(t, planeOpts{mutate: func(data []float64, n int) {
		for i := range data {
			data[i] = float64(float32((data[i] + moonR) / 1000))
		}
	}, options: map[string]any{"value_kind": "radius", "vertical_unit": "km"}})
	res, err := ExtractTerrain(s, -89.5, 45.0, 5.0, "low")
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(res.LandingElevation-100) > 0.2 { // float32 km storage quantises to ~0.12 m
		t.Fatalf("landing %v", res.LandingElevation)
	}
}

func TestGeographicDEMLongitudeWrap(t *testing.T) {
	for _, c := range []struct{ left, lon float64 }{{0, 359}, {0, 359.9}, {0, 0.1}, {-180, -179}, {-180, 179}, {-180, 179.9}} {
		ncols, nrows := 360, 50
		data := make([]float64, ncols*nrows)
		for i := range data {
			lon := c.left + float64(i%ncols) + 0.5
			data[i] = float64(float32(100 + 20*math.Sin(lon*math.Pi/180)))
		}
		var buf bytes.Buffer
		if err := geotiff.Write(&buf, geotiff.WriteOptions{Width: ncols, Height: nrows, BitsPerSample: 32, SampleFormat: geotiff.SampleFloat, Data: data,
			Geotransform: [6]float64{c.left, 1, 0, -89, 0, -0.02}, GeoKeys: lunarcrs.Sphere(lunarcrs.Geographic, moonR, 0, 0, 0).GeoKeys(),
			HasNoData: true, NoData: -9999, Tags: map[string]string{"LUNAR_SIM_SOURCE": "SYNTHETIC"}}); err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(t.TempDir(), "SYNTHETIC_GEOGRAPHIC.tif")
		os.WriteFile(path, buf.Bytes(), 0o600)
		res, err := ExtractTerrain(&Settings{DEMPath: path, Options: fixtureOptions()}, -89.5, c.lon, 5.0, "low")
		if err != nil {
			t.Fatalf("left %v lon %v: %v", c.left, c.lon, err)
		}
		want := 100 + 20*math.Sin(c.lon*math.Pi/180)
		if res.Statistics.CoveragePercent != 100 || math.Abs(res.LandingElevation-want) > 0.01 {
			t.Fatalf("left %v lon %v: coverage %v landing %v want %v", c.left, c.lon, res.Statistics.CoveragePercent, res.LandingElevation, want)
		}
	}
}

func TestCorruptAndMissingFiles(t *testing.T) {
	dir := t.TempDir()
	bad := filepath.Join(dir, "bad.tif")
	os.WriteFile(bad, []byte("This is not a GeoTIFF"), 0o600)
	_, err := OpenDEM(&Settings{DEMPath: bad, Options: fixtureOptions()})
	wantErr(t, err, "Cannot read DEM")
	_, err = OpenDEM(&Settings{DEMPath: filepath.Join(dir, "missing.tif")})
	wantErr(t, err, "does not exist")
	_, err = OpenDEM(&Settings{})
	wantErr(t, err, "No DEM configured")
	// A truncated but well-formed header must fail cleanly, never panic.
	good, _ := os.ReadFile(planeDEM(t, planeOpts{}).DEMPath)
	for _, cut := range []int{4, 9, 100, len(good) / 2, len(good) - 40} {
		p := filepath.Join(dir, "cut.tif")
		os.WriteFile(p, good[:cut], 0o600)
		if _, err := ExtractTerrain(&Settings{DEMPath: p, Options: fixtureOptions()}, -89.5, 45.0, 5.0, "low"); err == nil {
			t.Fatalf("truncation at %d bytes was not detected", cut)
		}
	}
}

// --- test_coordinates.py ----------------------------------------------------

func TestLongitudeConventions(t *testing.T) {
	for in, want := range map[float64]float64{45: 45, 359: -1, 360: 0, 180: -180, -180: -180} {
		if _, lon, _, _, err := ValidateLocation(-89.5, in, 5.0, "medium"); err != nil || lon != want {
			t.Fatalf("longitude %v -> %v (%v), want %v", in, lon, err, want)
		}
	}
}

func TestInvalidCoordinatesAreActionable(t *testing.T) {
	cases := [][4]any{{-91.0, 45.0, 5.0, "medium"}, {91.0, 45.0, 5.0, "medium"}, {-89.5, 361.0, 5.0, "medium"}, {-89.5, -181.0, 5.0, "medium"},
		{-89.5, 45.0, 0.49, "medium"}, {-89.5, 45.0, 20.1, "medium"}, {math.NaN(), 45.0, 5.0, "medium"}, {-89.5, math.Inf(1), 5.0, "medium"},
		{-89.5, 45.0, "not-a-number", "medium"}, {true, 45.0, 5.0, "medium"}, {-89.5, 45.0, 5.0, "ultra"}, {-89.5, 45.0, 5.0, map[string]any{}},
		{nil, 45.0, 5.0, "medium"}, {-89.5, 45.0, 5.0, nil}, {[]any{1.0}, 45.0, 5.0, "medium"}}
	for _, c := range cases {
		if _, _, _, _, err := ValidateLocation(c[0], c[1], c[2], c[3]); err == nil {
			t.Fatalf("%v was accepted", c)
		}
	}
}

func TestLocalRadiusUsesLunarGeodesic(t *testing.T) {
	for _, site := range [][2]float64{{-89.5, 45}, {-90, 0}, {-90, 175}, {90, -45}, {0, 179.99}} {
		local := lunarcrs.Sphere(lunarcrs.AzimuthalEquidistant, moonR, site[0], site[1], 0)
		for _, p := range [][2]float64{{5000, 0}, {0, 5000}, {-5000, 0}, {3000, 4000}} {
			lon, lat, ok := local.Inverse(p[0], p[1])
			if !ok {
				t.Fatal("inverse failed")
			}
			// Great-circle distance on the lunar sphere (haversine).
			p1, p2 := site[0]*math.Pi/180, lat*math.Pi/180
			dl := (lon - site[1]) * math.Pi / 180
			a := math.Pow(math.Sin((p2-p1)/2), 2) + math.Cos(p1)*math.Cos(p2)*math.Pow(math.Sin(dl/2), 2)
			if dist := 2 * moonR * math.Asin(math.Sqrt(a)); math.Abs(dist-5000) > 1e-6 {
				t.Fatalf("site %v offset %v: geodesic %v m", site, p, dist)
			}
		}
		if x, y, ok := local.Forward(site[1], site[0]); !ok || math.Abs(x) > 1e-6 || math.Abs(y) > 1e-6 {
			t.Fatalf("site %v does not project to the origin: %v,%v", site, x, y)
		}
	}
}

func TestGridRadiusAndLandingPosition(t *testing.T) {
	for q, n := range map[string]int{"low": 129, "medium": 257, "high": 513} {
		g := NewGrid(5, q)
		if g.Size != n || g.RadiusM != 5000 || math.Abs(g.SpacingM*float64(n-1)-10000) > 1e-9 {
			t.Fatalf("grid %s wrong: %+v", q, g)
		}
		if g.East(n/2) != 0 || g.North(n/2) != 0 || !g.InDisk(n/2, n/2) || g.InDisk(0, 0) {
			t.Fatalf("grid %s centre/corner wrong", q)
		}
		far := 0.0
		for r := 0; r < n; r++ {
			for c := 0; c < n; c++ {
				if g.InDisk(r, c) {
					far = math.Max(far, math.Hypot(g.East(c), g.North(r)))
				}
			}
		}
		if math.Abs(far-5000) > 1e-6 {
			t.Fatalf("disk radius %v", far)
		}
	}
}

// --- test_horizon.py ----------------------------------------------------------

func TestHorizonMaskShapeAndCoverage(t *testing.T) {
	data, _ := SyntheticTerrain(-89.5, 45.0, 5.0, "low")
	mask, err := HorizonFromGrid(data, 5.0, 2.0)
	if err != nil {
		t.Fatal(err)
	}
	top := -90.0
	for _, e := range mask.ElevationsDeg {
		top = math.Max(top, e)
	}
	if len(mask.AzimuthsDeg) != 72 || len(mask.ElevationsDeg) != 72 || mask.MeanCoveragePercent != 100 || !mask.Synthetic || top <= 0 ||
		mask.FrameNote == "" || !(mask.HorizonRadiusKm < mask.RadiusKm) || mask.EdgeInsetM <= 0 || mask.GridSize != 129 {
		t.Fatalf("unexpected mask %+v", mask)
	}
}

func TestHorizonPlaneSlopeAndCurvature(t *testing.T) {
	data, err := ExtractTerrain(planeDEM(t, planeOpts{}), -89.5, 45.0, 5.0, "low")
	if err != nil {
		t.Fatal(err)
	}
	mask, _ := HorizonFromGrid(data, 15.0, 0.0)
	north, south := mask.ElevationsDeg[0], mask.ElevationsDeg[12]
	if !(north > south) || !(north < 1.2) {
		t.Fatalf("north %v south %v", north, south)
	}
}

func TestInvalidHorizonParameters(t *testing.T) {
	data, _ := SyntheticTerrain(-89.5, 45.0, 1.0, "low")
	for _, c := range [][2]any{{7.0, 2.0}, {2.5, 2.0}, {true, 2.0}, {2.0, 100.0}, {2.0, math.NaN()}, {0.0, 2.0}, {16.0, 2.0}, {2.0, -1.0}, {"x", 2.0}, {2.0, false}, {nil, 2.0}} {
		if _, err := HorizonFromGrid(data, c[0], c[1]); err == nil {
			t.Fatalf("az=%v eye=%v accepted", c[0], c[1])
		}
	}
	if m, err := HorizonFromGrid(data, "15", "1.5"); err != nil || len(m.AzimuthsDeg) != 24 || m.EyeHeightM != 1.5 {
		t.Fatalf("numeric strings must be accepted like the Python API: %v", err)
	}
}

func TestHorizonNoDataIsReportedNotFilled(t *testing.T) {
	data, err := ExtractTerrain(planeDEM(t, planeOpts{}), -89.5, 45.0, 2.0, "low")
	if err != nil {
		t.Fatal(err)
	}
	n := data.Grid.Size
	for row := 0; row < n/2; row++ { // remove a northern wedge
		for col := n/2 - 3; col < n/2+4; col++ {
			data.Grid.Elevations[row*n+col] = nil
		}
	}
	mask, _ := HorizonFromGrid(data, 15.0, 2.0)
	if !(mask.RayCoveragePercent[0] < 100) || !(mask.MeanCoveragePercent < 100) {
		t.Fatalf("NoData was hidden: north coverage %v mean %v", mask.RayCoveragePercent[0], mask.MeanCoveragePercent)
	}
}

// --- PROJ parity for every supported projection ------------------------------

func TestProjectionParityWithPROJ(t *testing.T) {
	var golden struct {
		Validate []struct {
			Args   []any          `json:"args"`
			Result []any          `json:"-"`
			Raw    map[string]any `json:"-"`
		} `json:"-"`
		AEQD []struct {
			Lat, Lon   float64
			East       []float64 `json:"east_m"`
			North      []float64 `json:"north_m"`
			Lons, Lats []float64
		} `json:"aeqd"`
		Projections map[string]struct {
			Proj4  string `json:"proj4"`
			Points []struct{ Lon, Lat, X, Y float64 }
		} `json:"projections"`
	}
	loadGolden(t, "coordinates.json", &golden)
	for _, c := range golden.AEQD {
		local := lunarcrs.Sphere(lunarcrs.AzimuthalEquidistant, moonR, c.Lat, c.Lon, 0)
		for i := range c.East {
			lon, lat, ok := local.Inverse(c.East[i], c.North[i])
			dLon := math.Abs(math.Mod(lon-c.Lons[i]+540, 360)-180) * math.Cos(lat*math.Pi/180)
			if !ok || dLon > 1e-10 || math.Abs(lat-c.Lats[i]) > 1e-10 {
				t.Fatalf("AEQD inverse at site %v,%v offset %v,%v: %.13f,%.13f vs PROJ %.13f,%.13f", c.Lat, c.Lon, c.East[i], c.North[i], lon, lat, c.Lons[i], c.Lats[i])
			}
		}
	}
	defs := map[string]*lunarcrs.CRS{
		"spstere":       lunarcrs.Sphere(lunarcrs.PolarStereographic, moonR, -90, 0, -90),
		"npstere_lon30": lunarcrs.Sphere(lunarcrs.PolarStereographic, moonR, 90, 30, 90),
		"stere_ts80":    lunarcrs.Sphere(lunarcrs.PolarStereographic, moonR, -90, 0, -80),
		"oblique_stere": lunarcrs.Sphere(lunarcrs.ObliqueStereographic, moonR, -85, 20, 0),
		"eqc_ts85":      lunarcrs.Sphere(lunarcrs.Equirectangular, moonR, 0, 0, -85),
		"eqc_lon180":    lunarcrs.Sphere(lunarcrs.Equirectangular, moonR, 0, 180, 0),
		"aeqd_site":     lunarcrs.Sphere(lunarcrs.AzimuthalEquidistant, moonR, -89.5, 45, 0),
	}
	if len(golden.Projections) != len(defs) {
		t.Fatalf("projection fixture set changed: %d", len(golden.Projections))
	}
	for name, g := range golden.Projections {
		crs := defs[name]
		for _, p := range g.Points {
			x, y, ok := crs.Forward(p.Lon, p.Lat)
			if !ok || math.Abs(x-p.X) > 1e-6 || math.Abs(y-p.Y) > 1e-6 {
				t.Fatalf("%s forward(%v,%v) = %.9f,%.9f; PROJ %.9f,%.9f", name, p.Lon, p.Lat, x, y, p.X, p.Y)
			}
			lon, lat, ok := crs.Inverse(p.X, p.Y)
			dLon := math.Abs(math.Mod(lon-p.Lon+540, 360)-180) * math.Cos(lat*math.Pi/180)
			if !ok || dLon > 1e-9 || math.Abs(lat-p.Lat) > 1e-9 {
				t.Fatalf("%s inverse(%v,%v) = %v,%v; want %v,%v", name, p.X, p.Y, lon, lat, p.Lon, p.Lat)
			}
		}
	}
}
