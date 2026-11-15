package frames

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

// Ports tests/python/test_lunar_frame.py (allowlist + constant conversion) and
// replays golden outputs recorded from backend/lunar_frame.py.
func TestGoldenParityWithPython(t *testing.T) {
	raw, err := os.ReadFile("../../tests/golden/python/frames.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden struct {
		Classify []struct {
			Frame  *string        `json:"frame"`
			Result Classification `json:"result"`
		} `json:"classify"`
		Convert []struct {
			Lat, Lon  float64
			Transform string
			Result    Converted
		} `json:"convert"`
		Matrices map[string][9]float64 `json:"matrices_row_major"`
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	if len(golden.Classify) < 20 || len(golden.Convert) < 27 {
		t.Fatal("frame golden set is incomplete")
	}
	str := func(p *string) string {
		if p == nil {
			return "<nil>"
		}
		return *p
	}
	for _, c := range golden.Classify {
		frame := ""
		if c.Frame != nil {
			frame = *c.Frame
		}
		got := Classify(frame)
		if got.Recognized != c.Result.Recognized || str(got.Transform) != str(c.Result.Transform) || str(got.Identifier) != str(c.Result.Identifier) ||
			str(got.Realization) != str(c.Result.Realization) || got.Note != c.Result.Note {
			t.Fatalf("classify(%q) = %+v, Python %+v", frame, got, c.Result)
		}
	}
	for name, m := range golden.Matrices {
		R, ok := Rotation(name)
		if !ok || *R != m {
			t.Fatalf("shipped %s matrix differs from the SPICE-derived reference", name)
		}
	}
	for _, c := range golden.Convert {
		R, _ := Rotation(c.Transform)
		got := ConvertSite(c.Lat, c.Lon, R)
		// asin is ill-conditioned within ~0.001 deg of the pole (d/dx ~ 5e4): 1e-8 deg = 0.3 mm on the surface.
		if math.Abs(got.Latitude-c.Result.Latitude) > 1e-8 || math.Abs(got.AzimuthOffsetDeg-c.Result.AzimuthOffsetDeg) > 1e-7 ||
			math.Abs(math.Mod(got.Longitude-c.Result.Longitude+540, 360)-180)*math.Cos(c.Lat*math.Pi/180) > 1e-10 {
			t.Fatalf("convert(%v,%v,%s) = %+v, Python %+v", c.Lat, c.Lon, c.Transform, got, c.Result)
		}
	}
}

func TestAllowlistIsExactNotSubstring(t *testing.T) {
	for _, bad := range []string{"MOON_ME_DE440", "NOT_MOON_ME", "WEIRD_IAU_FRAME", "MysteryFrame", "", "MOON_PA_DE440", "Synthetic test frame", "IAU_MARS", "XMOON_ME"} {
		if c := Classify(bad); c.Recognized || c.Transform != nil {
			t.Fatalf("%q must stay unverified", bad)
		}
	}
	for good, tr := range map[string]string{"MOON_ME": "me", "MOON_ME (JPL DE421)": "me", "moon_me": "me", "MOON_PA_DE421": "pa", "IAU_MOON": "iau",
		"MOON_ME (DE421) — third-party 512px verification downsample; gap-filled; NOT flight data": "me"} {
		if c := Classify(good); !c.Recognized || *c.Transform != tr {
			t.Fatalf("%q should classify as %s", good, tr)
		}
	}
}

func TestRotationsAreProperAndInverseRoundTrips(t *testing.T) {
	for _, R := range []*[9]float64{&METoIAU, &PAToIAU} {
		det := R[0]*(R[4]*R[8]-R[5]*R[7]) - R[1]*(R[3]*R[8]-R[5]*R[6]) + R[2]*(R[3]*R[7]-R[4]*R[6])
		if math.Abs(det-1) > 1e-12 {
			t.Fatalf("matrix is not a proper rotation (det %v)", det)
		}
		for _, site := range [][2]float64{{-89.9, 0}, {-85.2, 53.5}, {0.6741, 23.4729}, {-89.99, 30}} {
			fwd := ConvertSite(site[0], site[1], R)
			back := ConvertSite(fwd.Latitude, fwd.Longitude, Transpose(R))
			if math.Abs(back.Latitude-site[0]) > 1e-10 || math.Abs(back.AzimuthOffsetDeg+fwd.AzimuthOffsetDeg) > 1e-6 {
				t.Fatalf("round trip failed for %v: %+v / %+v", site, fwd, back)
			}
		}
	}
	if MEMaxResidualDeg > 0.0039 || PAMaxResidualDeg > 0.0039 {
		t.Fatal("disclosed residual changed")
	}
}
