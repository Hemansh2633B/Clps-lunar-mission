package terrain

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const goldenRoot = "../../tests/golden"

func fixtureOptions() map[string]any {
	return map[string]any{"vertical_unit": "m", "value_kind": "elevation",
		"elevation_reference":   "Synthetic fixture, no scientific datum",
		"lunar_reference_frame": "Synthetic test frame", "elevation_reference_radius_m": 1737400.0}
}

func loadGolden(t testing.TB, name string, into any) {
	t.Helper()
	fh, err := os.Open(filepath.Join(goldenRoot, "python", name))
	if err != nil {
		t.Fatalf("golden fixture %s: %v", name, err)
	}
	defer fh.Close()
	var r io.Reader = fh
	if strings.HasSuffix(name, ".gz") {
		zr, err := gzip.NewReader(fh)
		if err != nil {
			t.Fatal(err)
		}
		r = zr
	}
	if err := json.NewDecoder(r).Decode(into); err != nil {
		t.Fatalf("decode %s: %v", name, err)
	}
}

type readerGolden struct {
	File  string `json:"file"`
	Error string `json:"error"`
	Info  *struct {
		LunarRadiusM         float64    `json:"lunar_radius_m"`
		Scale                float64    `json:"scale"`
		Offset               float64    `json:"offset"`
		SourceResolution     [2]float64 `json:"source_resolution"`
		SourceResolutionUnit string     `json:"source_resolution_unit"`
		Width                int        `json:"width"`
		Height               int        `json:"height"`
		Synthetic            bool       `json:"synthetic"`
		CRSName              string     `json:"crs_name"`
	} `json:"info"`
	Transform    []float64  `json:"transform"`
	Pixels       []*float64 `json:"pixels"`
	IsGeographic bool       `json:"is_geographic"`
	Samples      []struct {
		Col, Row, X, Y, Lon, Lat float64
		Landing                  json.RawMessage `json:"landing_elevation_m"`
	} `json:"samples"`
}

// TestReaderParityWithGDAL reads GDAL-written rasters of every supported layout
// and compares pixels, georeferencing, CRS maths and native landing samples
// with the values rasterio/GDAL 3.10.3 and PROJ 9.5.1 produced.
func TestReaderParityWithGDAL(t *testing.T) {
	var golden map[string]readerGolden
	loadGolden(t, "readers.json.gz", &golden)
	if len(golden) < 16 {
		t.Fatalf("expected the full reader fixture set, got %d", len(golden))
	}
	for name, want := range golden {
		t.Run(name, func(t *testing.T) {
			d, err := OpenDEM(&Settings{DEMPath: filepath.Join(goldenRoot, "dem", want.File), Options: fixtureOptions()})
			if name == "unsupported_tmerc" {
				// PROJ accepted any projection; the native engine supports a closed,
				// regression-tested set and must refuse the rest explicitly.
				if err == nil || !strings.Contains(err.Error(), "unsupported DEM map projection") {
					t.Fatalf("transverse Mercator must be refused explicitly, got %v", err)
				}
				return
			}
			if want.Error != "" {
				if err == nil {
					t.Fatalf("expected error %q", want.Error)
				}
				if err.Error() != want.Error {
					t.Fatalf("error mismatch:\n got  %q\n want %q", err.Error(), want.Error)
				}
				return
			}
			if err != nil {
				t.Fatalf("open: %v", err)
			}
			defer d.Close()
			in := d.Info
			if in.LunarRadiusM != want.Info.LunarRadiusM || in.Scale != want.Info.Scale || in.Offset != want.Info.Offset ||
				in.Width != want.Info.Width || in.Height != want.Info.Height || in.Synthetic != want.Info.Synthetic ||
				in.SourceResolutionUnit != want.Info.SourceResolutionUnit {
				t.Fatalf("info mismatch: got %+v want %+v", in, *want.Info)
			}
			for i := range in.SourceResolution {
				if math.Abs(in.SourceResolution[i]-want.Info.SourceResolution[i]) > 1e-12*math.Max(1, want.Info.SourceResolution[i]) {
					t.Fatalf("resolution %v != %v", in.SourceResolution, want.Info.SourceResolution)
				}
			}
			// rasterio Affine order: a, b, c, d, e, f  == GDAL gt[1], gt[2], gt[0], gt[4], gt[5], gt[3]
			gt := d.GT
			got := []float64{gt[1], gt[2], gt[0], gt[4], gt[5], gt[3]}
			for i := range got {
				if math.Abs(got[i]-want.Transform[i]) > 1e-9*math.Max(1, math.Abs(want.Transform[i])) {
					t.Fatalf("geotransform %v != %v", got, want.Transform)
				}
			}
			raw, err := d.File.ReadWindow(0, 0, d.File.Width, d.File.Height)
			if err != nil {
				t.Fatalf("read: %v", err)
			}
			if len(raw) != len(want.Pixels) {
				t.Fatalf("pixel count %d != %d", len(raw), len(want.Pixels))
			}
			for i, v := range raw {
				masked := d.File.IsNoData(v) || math.IsNaN(v)
				if masked != (want.Pixels[i] == nil) {
					t.Fatalf("pixel %d mask mismatch (value %v)", i, v)
				}
				if !masked && v != *want.Pixels[i] {
					t.Fatalf("pixel %d = %v, GDAL read %v", i, v, *want.Pixels[i])
				}
			}
			if d.CRS.IsGeographic() != want.IsGeographic {
				t.Fatalf("geographic flag mismatch")
			}
			for _, s := range want.Samples {
				lon, lat, ok := d.CRS.Inverse(s.X, s.Y)
				if !ok {
					t.Fatalf("inverse failed at %v,%v", s.X, s.Y)
				}
				if !d.CRS.IsGeographic() {
					dLon := math.Abs(math.Mod(lon-s.Lon+540, 360)-180) * math.Cos(lat*math.Pi/180)
					if dLon > 1e-9 || math.Abs(lat-s.Lat) > 1e-9 {
						t.Fatalf("inverse(%v,%v) = %.12f,%.12f; PROJ %.12f,%.12f", s.X, s.Y, lon, lat, s.Lon, s.Lat)
					}
				}
				px, py, ok := d.PixelCoords(s.Lon, s.Lat)
				if !ok || math.Abs(px-s.Col) > 1e-6 || math.Abs(py-s.Row) > 1e-6 {
					t.Fatalf("PixelCoords(%v,%v) = %v,%v; want %v,%v", s.Lon, s.Lat, px, py, s.Col, s.Row)
				}
				elev, err := d.LandingElevation(s.Lat, s.Lon)
				var wantElev float64
				if json.Unmarshal(s.Landing, &wantElev) == nil {
					if err != nil || math.Abs(elev-wantElev) > 1e-6*math.Max(1, math.Abs(wantElev)) {
						t.Fatalf("landing elevation at col %.2f row %.2f = %v (%v); Python %v", s.Col, s.Row, elev, err, wantElev)
					}
				} else {
					var wantErr struct{ Error string }
					json.Unmarshal(s.Landing, &wantErr)
					if err == nil || err.Error() != wantErr.Error {
						t.Fatalf("landing error at col %.2f row %.2f = %v; Python %q", s.Col, s.Row, err, wantErr.Error)
					}
				}
			}
		})
	}
}
