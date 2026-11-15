package catalog

import (
	"image"
	_ "image/jpeg"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// The bundled LROC WAC south-pole basemap carries no georeferencing, so its
// orientation is established from the image itself: floors of permanently
// shadowed craters are dark in the mosaic. Under the documented orientation
// (0° meridian up, 90°E right) the published crater centres land on dark
// floors; under the three mirrored/rotated alternatives they do not.
//
// v1.11 and earlier drew markers with the 0° meridian DOWN, which mirrored every
// site north-south against this imagery. This test keeps the evidence executable.
func TestBundledBasemapOrientation(t *testing.T) {
	f, err := os.Open(filepath.Join("..", "..", "public", "assets", "lroc-south-pole.jpg"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	b := img.Bounds()
	if b.Dx() != b.Dy() {
		t.Fatalf("basemap must be square, got %v", b)
	}
	// IAU Gazetteer of Planetary Nomenclature centre coordinates (east longitude) and diameters.
	craters := []struct {
		name          string
		lat, lon, dkm float64
	}{
		{"Haworth", -87.45, 354.83, 51.4}, {"Shoemaker", -88.14, 45.91, 51.8}, {"Faustini", -87.18, 84.31, 42.5},
		{"Sverdrup", -88.3, 208.0, 32.8}, {"Slater", -88.08, 111.29, 25}, {"Nobile", -85.28, 53.27, 79},
		{"Amundsen", -84.44, 83.07, 103},
	}
	const radiusKm = 1737.4
	half := float64(b.Dx()) / 2
	rhoEdge := 2 * radiusKm * math.Tan(5*math.Pi/180) // the image edge is 80°S (colatitude 10°)
	gray := func(x, y int) float64 {
		r, g, bl, _ := img.At(x, y).RGBA()
		return (float64(r) + float64(g) + float64(bl)) / 3 / 257
	}
	floor := func(lat, lon, dkm, sx, sy float64) float64 {
		rho := 2 * radiusKm * math.Tan((90+lat)*math.Pi/360)
		px := half + sx*rho*math.Sin(lon*math.Pi/180)/rhoEdge*half
		py := half - sy*rho*math.Cos(lon*math.Pi/180)/rhoEdge*half
		rad := int(0.3 * dkm / 2 / rhoEdge * half)
		sum, n := 0.0, 0
		for dy := -rad; dy <= rad; dy++ {
			for dx := -rad; dx <= rad; dx++ {
				if dx*dx+dy*dy <= rad*rad {
					sum += gray(int(px)+dx, int(py)+dy)
					n++
				}
			}
		}
		return sum / float64(n)
	}
	mean := func(sx, sy float64) float64 {
		total := 0.0
		for _, c := range craters {
			total += floor(c.lat, c.lon, c.dkm, sx, sy)
		}
		return total / float64(len(craters))
	}
	documented := mean(1, 1) // 0° up, 90°E right
	alternatives := map[string]float64{"0° down / 90°E right (v1.11 marker convention)": mean(1, -1), "0° up / 90°E left": mean(-1, 1), "0° down / 90°E left": mean(-1, -1)}
	t.Logf("mean crater-floor brightness (0-255): documented orientation %.1f", documented)
	if documented > 12 {
		t.Errorf("crater floors should be dark under the documented orientation, got %.1f", documented)
	}
	for name, v := range alternatives {
		t.Logf("  %s: %.1f", name, v)
		if v < 2*documented+10 {
			t.Errorf("orientation %q is not clearly rejected (%.1f vs %.1f)", name, v, documented)
		}
	}
	for _, c := range craters {
		if v := floor(c.lat, c.lon, c.dkm, 1, 1); v > 20 {
			t.Errorf("%s floor is not dark under the documented orientation (%.1f)", c.name, v)
		}
	}
}

func TestCatalogueLoads(t *testing.T) {
	doc, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Sources) < 15 {
		t.Fatalf("expected a populated catalogue, got %d sources", len(doc.Sources))
	}
}
