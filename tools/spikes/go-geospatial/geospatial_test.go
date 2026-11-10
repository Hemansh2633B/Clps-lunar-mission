package spike

import (
	"bytes"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/Hemansh2633B/Clps-lunar-mission/internal/geotiff"
	"github.com/Hemansh2633B/Clps-lunar-mission/internal/lunarcrs"
	"github.com/Hemansh2633B/Clps-lunar-mission/internal/terrain"
)

func fixture(name string) string {
	return filepath.Join("..", "..", "..", "tests", "fixtures", "python-v1.11", name)
}
func load(t *testing.T, name string) any {
	t.Helper()
	b, err := os.ReadFile(fixture(name))
	if err != nil {
		t.Fatal(err)
	}
	var v any
	if err = json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}
func open(t *testing.T, name string) *geotiff.Raster {
	t.Helper()
	b, err := os.ReadFile(fixture(name))
	if err != nil {
		t.Fatal(err)
	}
	r, err := geotiff.Open(&geotiff.FileSource{R: bytes.NewReader(b), N: int64(len(b)), Path: name})
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func near(t *testing.T, got, want, tol float64) {
	t.Helper()
	if math.Abs(got-want) > tol || math.IsNaN(got) {
		t.Fatalf("got %.15g want %.15g tolerance %.9g", got, want, tol)
	}
}
func TestRealGeoTIFFMetadata(t *testing.T) {
	r := open(t, "sloped.tif")
	if r.Width != 401 || r.Height != 401 {
		t.Fatal(r.Width, r.Height)
	}
	near(t, r.NoData, -9999, 0)
	near(t, r.CRS.Radius, 1737400, 0.01)
	near(t, r.CRS.Lat0, -89.5, 0)
	near(t, r.CRS.Lon0, 45, 0)
	x, y := r.Pixel(0, 0)
	near(t, x, -20050, 0)
	near(t, y, 20050, 0)
	if len(r.GeoKeys) == 0 {
		t.Fatal("no GeoKeys")
	}
	t.Logf("%d bytes metadata, %d ranges, %d GeoKeys", r.BytesRead, r.Reads, len(r.GeoKeys))
	r = open(t, "scaled.tif")
	near(t, r.Scale, .5, 0)
	near(t, r.Offset, 10, 0)
}
func TestLunarAEQDAgainstPython(t *testing.T) {
	for _, v := range load(t, "coordinates.json").([]any) {
		c := v.(map[string]any)
		crs := lunarcrs.Local(c["latitude"].(float64), c["longitude"].(float64), 1737400)
		lon, lat, err := crs.Inverse(c["east_m"].(float64), c["north_m"].(float64))
		if err != nil {
			t.Fatal(err)
		}
		near(t, lat, c["result_latitude"].(float64), 1e-9)
		dlon := math.Abs(math.Remainder(lon-c["result_longitude"].(float64), 360))
		if math.Abs(lat) < 89.999999 {
			near(t, dlon, 0, 1e-9)
		}
		x, y, err := crs.Forward(lon, lat)
		if err != nil {
			t.Fatal(err)
		}
		near(t, x, c["east_m"].(float64), 1e-6)
		near(t, y, c["north_m"].(float64), 1e-6)
	}
	r := open(t, "sloped.tif")
	lon, lat, err := r.CRS.Inverse(3000, 4000)
	if err != nil {
		t.Fatal(err)
	}
	x, y, err := r.CRS.Forward(lon, lat)
	if err != nil {
		t.Fatal(err)
	}
	near(t, x, 3000, 1e-6)
	near(t, y, 4000, 1e-6)
}
func TestBoundedWindowBilinearAndNoData(t *testing.T) {
	r := open(t, "sloped.tif")
	before := r.BytesRead
	a, err := r.ReadWindow(198, 198, 5, 5)
	if err != nil {
		t.Fatal(err)
	}
	h, ok := geotiff.Bilinear(a, 5, 2, 2, r.RawValid)
	if !ok {
		t.Fatal("missing landing")
	}
	near(t, r.Elevation(h), 100, .001)
	if r.BytesRead-before > 401*5*4*4+4096 {
		t.Fatal("window decoded too much")
	}
	r = open(t, "nodata.tif")
	a, err = r.ReadWindow(220, 170, 15, 15)
	if err != nil {
		t.Fatal(err)
	}
	_, ok = geotiff.Bilinear(a, 15, 7.5, 7.5, r.RawValid)
	if ok {
		t.Fatal("NoData was filled")
	}
}

func TestTerrainAndHorizonGoldenParity(t *testing.T) {
	manifest := load(t, "manifest.json").(map[string]any)
	cases := 0
	points := 0
	for _, item := range manifest["cases"].([]any) {
		c := item.(map[string]any)
		name := c["name"].(string)
		t.Run(name, func(t *testing.T) {
			r := open(t, c["raster"].(string))
			config := load(t, c["config"].(string)).(map[string]any)
			for _, qi := range c["qualities"].([]any) {
				quality := qi.(string)
				size := map[string]int{"low": 129, "medium": 257, "high": 513}[quality]
				stem := name + "-" + quality
				g, err := terrain.Extract(r, c["latitude"].(float64), c["longitude"].(float64), c["radius_km"].(float64), size, config["vertical_unit"].(string), config["value_kind"].(string), config["elevation_reference_radius_m"].(float64))
				if err != nil {
					t.Fatal(err)
				}
				want := load(t, stem+".terrain.json").(map[string]any)
				wg := want["grid"].(map[string]any)
				values := wg["elevations_m"].([]any)
				if math.Abs(g.Landing-want["landing_elevation_m"].(float64)) > .001 {
					t.Fatalf("landing got %.17g want %.17g", g.Landing, want["landing_elevation_m"])
				}
				for i, v := range values {
					if v == nil {
						if g.Elevations[i] != nil {
							t.Fatalf("pixel %d: NoData mask differs", i)
						}
					} else {
						if g.Elevations[i] == nil {
							t.Fatalf("pixel %d: missing elevation", i)
						}
						if math.Abs(*g.Elevations[i]-v.(float64)) > .01 {
							t.Fatalf("pixel %d got %.17g want %.17g", i, *g.Elevations[i], v)
						}
						points++
					}
				}
				stats := want["statistics"].(map[string]any)
				if math.Abs(g.Minimum-stats["minimum_m"].(float64)) > .01 {
					t.Fatalf("minimum got %.17g want %.17g", g.Minimum, stats["minimum_m"])
				}
				if math.Abs(g.Maximum-stats["maximum_m"].(float64)) > .01 {
					t.Fatalf("maximum got %.17g want %.17g", g.Maximum, stats["maximum_m"])
				}
				if math.Abs(g.Range-stats["range_m"].(float64)) > .01 {
					t.Fatalf("range got %.17g want %.17g", g.Range, stats["range_m"])
				}
				if g.Coverage != stats["coverage_percent"].(float64) {
					t.Fatalf("coverage %v != %v", g.Coverage, stats["coverage_percent"])
				}
				h, err := terrain.HorizonFromGrid(g, c["latitude"].(float64), math.Mod(c["longitude"].(float64)+180, 360)-180, c["radius_km"].(float64), r.CRS.Radius, config["elevation_reference_radius_m"].(float64), 15, 2)
				if err != nil {
					t.Fatal(err)
				}
				wh := load(t, stem+".horizon.json").(map[string]any)
				for _, pair := range []struct {
					name string
					got  []float64
					want []any
				}{
					{"elevation", h.Elevations, wh["elevations_deg"].([]any)},
					{"coverage", h.Coverage, wh["ray_coverage_percent"].([]any)},
					{"range", h.Ranges, wh["max_obstacle_range_km"].([]any)},
				} {
					if len(pair.got) != len(pair.want) {
						t.Fatal("horizon length")
					}
					for i, v := range pair.got {
						if math.Abs(v-pair.want[i].(float64)) > .001 {
							t.Fatalf("horizon %s[%d] got %.17g want %.17g", pair.name, i, v, pair.want[i])
						}
					}
				}
				if h.MeanCoverage != wh["mean_coverage_percent"].(float64) {
					t.Fatal("mean coverage")
				}
			}
		})
		cases++
	}
	t.Logf("Python golden parity: %d cases, %d valid elevation comparisons; original tolerances", cases, points)
}
