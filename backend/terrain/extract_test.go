package terrain

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"chandra/backend/lunarcrs"
)

type goldenHorizon struct {
	HorizonRadiusKm     float64   `json:"horizon_radius_km"`
	EdgeInsetM          float64   `json:"edge_inset_m"`
	SamplingStepM       float64   `json:"sampling_step_m"`
	GridSize            int       `json:"grid_size"`
	GridSpacingM        float64   `json:"grid_spacing_m"`
	EyeHeightM          float64   `json:"eye_height_m"`
	AzimuthStepDeg      int       `json:"azimuth_step_deg"`
	AzimuthsDeg         []int     `json:"azimuths_deg"`
	ElevationsDeg       []float64 `json:"elevations_deg"`
	RayCoveragePercent  []float64 `json:"ray_coverage_percent"`
	MaxObstacleRangeKm  []float64 `json:"max_obstacle_range_km"`
	MeanCoveragePercent float64   `json:"mean_coverage_percent"`
	Synthetic           bool      `json:"synthetic"`
	Model               string    `json:"model"`
	FrameNote           string    `json:"frame_note"`
}

type goldenTerrain struct {
	Mode             string     `json:"mode"`
	Synthetic        bool       `json:"synthetic"`
	Latitude         float64    `json:"latitude"`
	Longitude        float64    `json:"longitude"`
	RadiusKm         float64    `json:"radius_km"`
	Grid             GridJSON   `json:"grid"`
	LandingElevation float64    `json:"landing_elevation_m"`
	Statistics       Statistics `json:"statistics"`
	Source           struct {
		LunarRadiusM              float64 `json:"lunar_radius_m"`
		ElevationReferenceRadiusM float64 `json:"elevation_reference_radius_m"`
	} `json:"source"`
}

func (g goldenTerrain) terrain() *Terrain {
	return &Terrain{Mode: g.Mode, Synthetic: g.Synthetic, Latitude: g.Latitude, Longitude: g.Longitude, RadiusKm: g.RadiusKm,
		Grid: g.Grid, LandingElevation: g.LandingElevation, Statistics: g.Statistics,
		lunarRadiusM: g.Source.LunarRadiusM, datumRadiusM: g.Source.ElevationReferenceRadiusM}
}

type extractGolden struct {
	Request     map[string]any `json:"request"`
	NativeScale [2]float64     `json:"native_scale"`
	Terrain     goldenTerrain  `json:"terrain"`
	HorizonAz2  goldenHorizon  `json:"horizon_az2_eye2"`
	HorizonAz5  goldenHorizon  `json:"horizon_az5_eye0"`
	Const       []*float64     `json:"gdal_exact_constscale_elevations_m"`
	Point       []*float64     `json:"gdal_exact_point_elevations_m"`
}

func compareHorizon(t *testing.T, label string, got *Horizon, want goldenHorizon) {
	t.Helper()
	if got.HorizonRadiusKm != want.HorizonRadiusKm || got.EdgeInsetM != want.EdgeInsetM || got.SamplingStepM != want.SamplingStepM ||
		got.GridSize != want.GridSize || got.GridSpacingM != want.GridSpacingM || got.EyeHeightM != want.EyeHeightM ||
		got.AzimuthStepDeg != want.AzimuthStepDeg || got.MeanCoveragePercent != want.MeanCoveragePercent ||
		got.Synthetic != want.Synthetic || got.Model != want.Model || got.FrameNote != want.FrameNote {
		t.Fatalf("%s: horizon header mismatch", label)
	}
	if len(got.ElevationsDeg) != len(want.ElevationsDeg) {
		t.Fatalf("%s: %d bins, want %d", label, len(got.ElevationsDeg), len(want.ElevationsDeg))
	}
	for i := range want.ElevationsDeg {
		// Outputs are rounded to 4 dp; libm differences can move a value by one unit in the last place.
		if got.AzimuthsDeg[i] != want.AzimuthsDeg[i] || math.Abs(got.ElevationsDeg[i]-want.ElevationsDeg[i]) > 1.0000001e-4 ||
			got.RayCoveragePercent[i] != want.RayCoveragePercent[i] || got.MaxObstacleRangeKm[i] != want.MaxObstacleRangeKm[i] {
			t.Fatalf("%s: bin %d = (%v, %v, %v), Python (%v, %v, %v)", label, i, got.ElevationsDeg[i], got.RayCoveragePercent[i],
				got.MaxObstacleRangeKm[i], want.ElevationsDeg[i], want.RayCoveragePercent[i], want.MaxObstacleRangeKm[i])
		}
	}
}

type diffStats struct {
	max, rms float64
	n, mask  int
}

func gridDiff(a, b []*float64, skip func(i int) bool) diffStats {
	var s diffStats
	sum := 0.0
	for i := range a {
		if skip != nil && skip(i) {
			continue
		}
		if (a[i] == nil) != (b[i] == nil) {
			s.mask++
			continue
		}
		if a[i] == nil {
			continue
		}
		d := math.Abs(*a[i] - *b[i])
		s.max = math.Max(s.max, d)
		sum += d * d
		s.n++
	}
	if s.n > 0 {
		s.rms = math.Sqrt(sum / float64(s.n))
	}
	return s
}

var extractCases = []struct{ name, dem string }{
	{"plane_center_low", "extract_plane_aeqd.tif"}, {"plane_offset_low", "extract_plane_aeqd.tif"},
	{"rough_r2_low", "extract_rough_spstere_20m.tif"}, {"rough_r4_low", "extract_rough_spstere_20m.tif"},
	{"rough_r1_low_upsample", "extract_rough_spstere_20m.tif"}, {"rough_r0.5_low_upsample", "extract_rough_spstere_20m.tif"},
	{"rough_gap_r2_low", "extract_rough_spstere_20m.tif"},
	{"geo360_seam_east_low", "extract_geo360.tif"}, {"geo360_seam_west_low", "extract_geo360.tif"}, {"geo360_mid_low", "extract_geo360.tif"},
}

// kernelTolM is the justified cell tolerance against GDAL run with the same
// exact transformer and kernel scale: both pipelines round the resampled value
// to float32 (ULP <= 4.9e-4 m below 8 km) and the API rounds to 0.001 m.
const kernelTolM = 0.0015

func runExtractCase(t *testing.T, name string, settings *Settings) {
	var want extractGolden
	loadGolden(t, "extract_"+name+".json.gz", &want)
	req := want.Request
	got, err := ExtractTerrain(settings, req["latitude"], req["longitude"], req["radius_km"], req["quality"])
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if math.Abs(got.LandingElevation-want.Terrain.LandingElevation) > 1e-6 {
		t.Fatalf("landing %v != Python %v", got.LandingElevation, want.Terrain.LandingElevation)
	}
	if got.Latitude != want.Terrain.Latitude || got.Longitude != want.Terrain.Longitude || got.Grid.Size != want.Terrain.Grid.Size ||
		got.Grid.SpacingM != want.Terrain.Grid.SpacingM || got.Grid.Order != want.Terrain.Grid.Order || got.Mode != "real" || got.Synthetic != want.Terrain.Synthetic {
		t.Fatalf("response header mismatch")
	}
	wantScale := want.NativeScale
	if wantScale[0] >= 0.95 && wantScale[1] >= 0.95 {
		wantScale = [2]float64{1, 1}
	}
	if math.Abs(got.Processing.KernelScale[0]-wantScale[0]) > 1e-9 || math.Abs(got.Processing.KernelScale[1]-wantScale[1]) > 1e-9 {
		t.Fatalf("kernel scale %v, golden %v", got.Processing.KernelScale, wantScale)
	}
	// Cells within half a source pixel of the 0/360° seam: GDAL clamps to the
	// edge pixel, the native engine interpolates across the seam (the raster is
	// periodic). Those cells are checked against the analytic periodic bilinear.
	var seam func(i int) bool
	if strings.HasPrefix(name, "geo360") {
		d, err := OpenDEM(settings)
		if err != nil {
			t.Fatal(err)
		}
		defer d.Close()
		g := NewGrid(got.RadiusKm, req["quality"].(string))
		local := &lunarcrs.CRS{Kind: lunarcrs.AzimuthalEquidistant, SemiMajor: 1737400, SemiMinor: 1737400, Lat0: got.Latitude, Lon0: got.Longitude, K0: 1, LinearUnitM: 1}
		px := make([]float64, g.Size*g.Size)
		for i := range px {
			lon, lat, _ := local.Inverse(g.East(i%g.Size), g.North(i/g.Size))
			px[i], _, _ = d.PixelCoords(lon, lat)
		}
		pixel := func(k int) float64 { return float64(float32(100 + 20*math.Sin((float64(k)+0.5)*math.Pi/180))) }
		checked := 0
		seam = func(i int) bool {
			x := px[i]
			if x >= 0.5 && x <= 359.5 {
				return false
			}
			if got.Grid.Elevations[i] != nil && i != len(px)/2 {
				w := x + 0.5
				if x > 359.5 {
					w = x - 359.5
				}
				expect := pixel(359)*(1-w) + pixel(0)*w
				if math.Abs(*got.Grid.Elevations[i]-expect) > kernelTolM {
					t.Fatalf("seam cell %d: native %v, periodic bilinear %v", i, *got.Grid.Elevations[i], expect)
				}
				checked++
			}
			return true
		}
		defer func() {
			if strings.Contains(name, "seam") && checked == 0 {
				t.Fatalf("seam case did not exercise any seam cell")
			}
		}()
	}
	vsConst := gridDiff(got.Grid.Elevations, want.Const, seam)
	vsDefault := gridDiff(got.Grid.Elevations, want.Terrain.Grid.Elevations, seam)
	gdalSpread := gridDiff(want.Const, want.Terrain.Grid.Elevations, seam)
	t.Logf("native vs GDAL(exact transformer, same kernel scale): max %.4f m rms %.4f m | native vs Python default: max %.3f m rms %.3f m | GDAL exact vs GDAL default: max %.3f m",
		vsConst.max, vsConst.rms, vsDefault.max, vsDefault.rms, gdalSpread.max)
	if vsConst.mask != 0 || vsDefault.mask != 0 {
		t.Fatalf("coverage mask differs from GDAL in %d / %d cells", vsConst.mask, vsDefault.mask)
	}
	if vsConst.max > kernelTolM {
		t.Fatalf("native kernel differs from GDAL by %.5f m (> %.4f m)", vsConst.max, kernelTolM)
	}
	// Transitivity: whatever separates native from the Python default is exactly
	// what separates GDAL(exact, constant scale) from GDAL(default heuristics).
	if vsDefault.max > gdalSpread.max+kernelTolM {
		t.Fatalf("native vs Python default %.4f m exceeds the GDAL-internal spread %.4f m", vsDefault.max, gdalSpread.max)
	}
	if got.Statistics.CoveragePercent != want.Terrain.Statistics.CoveragePercent {
		t.Fatalf("coverage %v%% != Python %v%%", got.Statistics.CoveragePercent, want.Terrain.Statistics.CoveragePercent)
	}
	// The ray marcher itself, isolated from resampling: same grid in, same mask out.
	for _, hc := range []struct {
		az, eye float64
		want    goldenHorizon
	}{{2, 2, want.HorizonAz2}, {5, 0, want.HorizonAz5}} {
		h, err := HorizonFromGrid(want.Terrain.terrain(), hc.az, hc.eye)
		if err != nil {
			t.Fatal(err)
		}
		compareHorizon(t, name, h, hc.want)
	}
}

func TestExtractionParityWithPython(t *testing.T) {
	for _, c := range extractCases {
		t.Run(c.name, func(t *testing.T) {
			runExtractCase(t, c.name, &Settings{DEMPath: filepath.Join(goldenRoot, "dem", c.dem), Options: fixtureOptions()})
		})
	}
}

// TestRealLOLAFixtureParity runs against the optional real LOLA-derived
// verification raster (fetched on demand, never committed).
func TestRealLOLAFixtureParity(t *testing.T) {
	path := "../../data/verification/LDEM_80S_20MPP_ADJ_512_verification.tif"
	if _, err := os.Stat(path); err != nil {
		t.Skip("real LOLA verification raster not present; run `npm run fixture:lola` to fetch it")
	}
	var opts map[string]any
	loadGolden(t, "real_fixture_config.json", &opts)
	for _, name := range []string{"real_shackleton_r5", "real_connecting_ridge_r10", "real_malapert_r20", "real_nobile_r5"} {
		t.Run(name, func(t *testing.T) {
			runExtractCase(t, name, &Settings{DEMPath: path, Options: opts})
		})
	}
}

func TestPlaneMediumHighStrided(t *testing.T) {
	for _, q := range []string{"medium", "high"} {
		var want struct {
			Stride     int        `json:"stride"`
			Strided    []*float64 `json:"elevations_m_strided"`
			Statistics Statistics `json:"statistics"`
			Landing    float64    `json:"landing_elevation_m"`
		}
		loadGolden(t, "extract_plane_center_"+q+"_strided.json.gz", &want)
		got, err := ExtractTerrain(&Settings{DEMPath: filepath.Join(goldenRoot, "dem", "extract_plane_aeqd.tif"), Options: fixtureOptions()}, -89.5, 45.0, 5.0, q)
		if err != nil {
			t.Fatal(err)
		}
		for k, w := range want.Strided {
			g := got.Grid.Elevations[k*want.Stride]
			if (g == nil) != (w == nil) || (g != nil && math.Abs(*g-*w) > kernelTolM) {
				t.Fatalf("%s cell %d mismatch", q, k*want.Stride)
			}
		}
		if got.Statistics.CoveragePercent != want.Statistics.CoveragePercent || math.Abs(got.LandingElevation-want.Landing) > 1e-9 ||
			math.Abs(got.Statistics.RangeM-want.Statistics.RangeM) > kernelTolM {
			t.Fatalf("%s statistics mismatch: %+v vs %+v", q, got.Statistics, want.Statistics)
		}
	}
}

func TestSyntheticParityWithPython(t *testing.T) {
	var want struct {
		Terrain goldenTerrain `json:"terrain"`
		Az2     goldenHorizon `json:"horizon_az2_eye2"`
		Az5     goldenHorizon `json:"horizon_az5_eye10"`
	}
	loadGolden(t, "synthetic_low.json.gz", &want)
	got, err := SyntheticTerrain(-89.5, 45.0, 5.0, "low")
	if err != nil {
		t.Fatal(err)
	}
	s := gridDiff(got.Grid.Elevations, want.Terrain.Grid.Elevations, nil)
	// 3-dp outputs: a last-bit libm difference may flip one rounding step.
	if s.mask != 0 || s.max > 0.0010000001 {
		t.Fatalf("synthetic grid differs: mask %d max %v", s.mask, s.max)
	}
	raw, _ := json.Marshal(got.Source)
	if !strings.Contains(string(raw), "NOT REAL LUNAR DATA") || !got.Synthetic || got.Mode != "synthetic" {
		t.Fatalf("synthetic provenance lost: %s", raw)
	}
	if math.Abs(got.Statistics.MinimumM-want.Terrain.Statistics.MinimumM) > 1e-6 || got.Statistics.CoveragePercent != 100 {
		t.Fatalf("statistics mismatch")
	}
	for _, hc := range []struct {
		az, eye float64
		want    goldenHorizon
	}{{2, 2, want.Az2}, {5, 10, want.Az5}} {
		h, err := HorizonFromGrid(want.Terrain.terrain(), hc.az, hc.eye)
		if err != nil {
			t.Fatal(err)
		}
		compareHorizon(t, "synthetic", h, hc.want)
	}
}
