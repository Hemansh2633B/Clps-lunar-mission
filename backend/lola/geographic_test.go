package lola

import (
	"bytes"
	"testing"

	"chandra/backend/geotiff"
	"chandra/backend/lunarcrs"
	"chandra/backend/terrain"
)

// This is a software fixture, not a lunar dataset. It proves that the generic
// acquisition window planner handles an explicitly georeferenced global
// longitude/latitude raster without pretending that a south-polar COG covers it.
func TestPlanSubsetSupportsValidatedGeographicLunarRasters(t *testing.T) {
	const width, height = 360, 180
	data := make([]float64, width*height)
	var raw bytes.Buffer
	if err := geotiff.Write(&raw, geotiff.WriteOptions{
		Width: width, Height: height, BitsPerSample: 16, SampleFormat: geotiff.SampleInt,
		Data: data, Geotransform: [6]float64{0, 1, 0, 90, 0, -1},
		GeoKeys: lunarcrs.Sphere(lunarcrs.Geographic, 1_737_400, 0, 0, 0).GeoKeys(),
		NoData:  -32768, HasNoData: true, TileSize: 32, Deflate: true,
	}); err != nil {
		t.Fatal(err)
	}
	file, err := geotiff.Open(bytes.NewReader(raw.Bytes()), int64(raw.Len()))
	if err != nil {
		t.Fatal(err)
	}
	dem, err := terrain.Inspect(file, map[string]any{
		"vertical_unit": "m", "value_kind": "elevation",
		"elevation_reference":          "Software test fixture only, not a scientific product",
		"elevation_reference_radius_m": 1_737_400.0,
		"lunar_reference_frame":        "MOON_ME (JPL DE421)",
	}, "global-geographic-fixture.tif")
	if err != nil {
		t.Fatal(err)
	}
	plan, err := PlanSubset(dem, -44, 176, 1)
	if err != nil {
		t.Fatalf("geographic subset plan failed: %v", err)
	}
	if plan.Pixels <= 0 || plan.Pixels >= 100 || plan.ResolutionUnit != "degree" {
		t.Fatalf("unexpected geographic subset plan: %+v", plan)
	}
	if plan.Window[0] < 0 || plan.Window[1] < 0 || plan.Window[0]+plan.Window[2] > width || plan.Window[1]+plan.Window[3] > height {
		t.Fatalf("window is outside the raster: %+v", plan.Window)
	}
}
