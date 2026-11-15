// Package terrain is the native CHANDRA terrain engine: DEM inspection, bounded
// regional extraction, landing-point interpolation, horizon ray marching and the
// isolated synthetic demo surface. It is a behaviour-preserving port of the
// former Python backend (backend/*.py, v1.11.0) and is regression-tested against
// golden outputs recorded from that implementation (tests/golden).
package terrain

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Scientific conventions, limits, and explicitly supplied DEM assumptions.
const (
	DefaultLunarRadiusM        = 1_737_400.0 // Demo only; real mode uses the DEM CRS sphere.
	MaxSubsetPixels            = 16_000_000
	MaxRequestBytes            = 16_384
	LongitudeConvention        = "east-positive, -180 to +180 degrees (0–360 input also accepted)"
	LatitudeConvention         = "planetocentric degrees; spherical lunar CRSs only"
	SyntheticWarning           = "SYNTHETIC TERRAIN — NOT REAL LUNAR DATA"
	RenderCoordinateConvention = "landing tangent frame: east/up/north; Three.js X= east, Y= up, Z= south; units km"
	GeometryModel              = "radial elevation on a sphere; local AEQD distances converted to a curved landing tangent frame"
	GridOrder                  = "row-major; rows north-to-south, columns west-to-east"
	Engine                     = "chandra-native-go"
)

var (
	LunarRadiusLimitsM = [2]float64{1_700_000.0, 1_800_000.0}
	RadiusLimitsKm     = [2]float64{0.5, 20.0}
	QualityGrids       = map[string]int{"low": 129, "medium": 257, "high": 513} // Odd: exact centre vertex.
)

// Error is an actionable message that is safe to show to the user (HTTP 400).
type Error struct{ Message string }

func (e *Error) Error() string { return e.Message }

// Errorf builds a user-facing terrain error.
func Errorf(format string, args ...any) *Error { return &Error{fmt.Sprintf(format, args...)} }

// Settings selects one DEM and its explicitly supplied vertical/frame metadata.
type Settings struct {
	DEMPath string
	Options map[string]any
	// DatasetID identifies the dataset in provenance (for example "configured").
	DatasetID string
}

// LoadSettings mirrors the former Settings.load: an optional JSON options file
// plus an optional raster path (CLI/env overrides the file's dem_path).
func LoadSettings(demPath, configPath, projectRoot string) (*Settings, error) {
	options := map[string]any{}
	if configPath != "" {
		raw, err := os.ReadFile(configPath)
		if err != nil {
			return nil, Errorf("Cannot read DEM configuration: %v", err)
		}
		var parsed any
		if err := json.Unmarshal(raw, &parsed); err != nil {
			return nil, Errorf("Cannot read DEM configuration: %v", err)
		}
		obj, ok := parsed.(map[string]any)
		if !ok {
			return nil, Errorf("DEM configuration must be a JSON object.")
		}
		options = obj
	}
	supplied := demPath
	if supplied == "" {
		if s, ok := options["dem_path"].(string); ok {
			supplied = s
		}
	}
	if strings.HasPrefix(supplied, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			supplied = filepath.Join(home, supplied[2:])
		}
	}
	if supplied != "" && !filepath.IsAbs(supplied) {
		supplied = filepath.Join(projectRoot, supplied)
	}
	return &Settings{DEMPath: supplied, Options: options, DatasetID: "configured"}, nil
}

// toFloat follows Python float(): numbers and numeric strings, never booleans.
func toFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	case int:
		return float64(t), true
	case string:
		f, err := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(t), "_", ""), 64)
		return f, err == nil
	}
	return 0, false
}

// ValidateLocation checks and normalises a request location.
func ValidateLocation(latitude, longitude, radiusKm, quality any) (lat, lon, radius float64, q string, err error) {
	vals := [3]float64{}
	for i, item := range []struct {
		name  string
		value any
	}{{"Latitude", latitude}, {"Longitude", longitude}, {"Radius", radiusKm}} {
		f, ok := toFloat(item.value)
		if !ok || math.IsNaN(f) || math.IsInf(f, 0) {
			return 0, 0, 0, "", Errorf("%s must be a finite number.", item.name)
		}
		vals[i] = f
	}
	lat, lon, radius = vals[0], vals[1], vals[2]
	if lat < -90 || lat > 90 {
		return 0, 0, 0, "", Errorf("Latitude must be between -90 and +90 degrees.")
	}
	if lon < -180 || lon > 360 {
		return 0, 0, 0, "", Errorf("Longitude must be in -180…180 or 0…360 degrees, east-positive.")
	}
	if radius < RadiusLimitsKm[0] || radius > RadiusLimitsKm[1] {
		return 0, 0, 0, "", Errorf("Radius must be between %s and %s km.", pyFloat(RadiusLimitsKm[0]), pyFloat(RadiusLimitsKm[1]))
	}
	q, ok := quality.(string)
	if _, known := QualityGrids[q]; !ok || !known {
		return 0, 0, 0, "", Errorf("Terrain quality must be low, medium, or high.")
	}
	lon = math.Mod(lon+180.0, 360.0)
	if lon < 0 {
		lon += 360
	}
	return lat, lon - 180.0, radius, q, nil
}

func pyFloat(v float64) string {
	s := strconv.FormatFloat(v, 'f', -1, 64)
	if !strings.Contains(s, ".") {
		s += ".0"
	}
	return s
}

// roundHalfEven matches Python's built-in round(x, n): correctly rounded decimal.
func roundDecimal(v float64, places int) float64 {
	f, _ := strconv.ParseFloat(strconv.FormatFloat(v, 'f', places, 64), 64)
	return f
}

// roundNumpy matches numpy.round(x, n): rint(x * 10^n) / 10^n.
func roundNumpy(v float64, places int) float64 {
	p := math.Pow(10, float64(places))
	return math.RoundToEven(v*p) / p
}

// Grid is the landing-centred sampling lattice of one request.
type Grid struct {
	Size     int
	RadiusM  float64
	SpacingM float64
}

// NewGrid builds the lattice for a radius and quality tier.
func NewGrid(radiusKm float64, quality string) Grid {
	size := QualityGrids[quality]
	radiusM := radiusKm * 1000
	return Grid{Size: size, RadiusM: radiusM, SpacingM: 2 * radiusM / float64(size-1)}
}

// East/North give the cell-centre coordinates exactly as numpy.linspace does.
func (g Grid) East(col int) float64 {
	if col == g.Size-1 {
		return g.RadiusM
	}
	return float64(col)*(2*g.RadiusM/float64(g.Size-1)) + -g.RadiusM
}
func (g Grid) North(row int) float64 {
	if row == g.Size-1 {
		return -g.RadiusM
	}
	return float64(row)*(-2*g.RadiusM/float64(g.Size-1)) + g.RadiusM
}

// InDisk reports whether a cell centre lies inside the analysis disk.
func (g Grid) InDisk(row, col int) bool {
	return math.Hypot(g.East(col), g.North(row)) <= g.RadiusM+1e-6
}

// GridJSON is the wire form of the elevation lattice.
type GridJSON struct {
	Size       int        `json:"size"`
	SpacingM   float64    `json:"spacing_m"`
	Order      string     `json:"order"`
	Elevations []*float64 `json:"elevations_m"`
}

// Statistics summarises valid in-disk cells.
type Statistics struct {
	MinimumM        float64 `json:"minimum_m"`
	MaximumM        float64 `json:"maximum_m"`
	RangeM          float64 `json:"range_m"`
	CoveragePercent float64 `json:"coverage_percent"`
}

// Processing discloses how a real-DEM grid was resampled (additive field).
type Processing struct {
	Engine      string     `json:"engine"`
	Resampling  string     `json:"resampling"`
	Kernel      string     `json:"kernel"`
	KernelScale [2]float64 `json:"kernel_scale"`
	Transform   string     `json:"transform"`
	DatasetID   string     `json:"dataset_id,omitempty"`
}

// Terrain is the /api/terrain response.
type Terrain struct {
	Mode             string      `json:"mode"`
	Synthetic        bool        `json:"synthetic"`
	Latitude         float64     `json:"latitude"`
	Longitude        float64     `json:"longitude"`
	RadiusKm         float64     `json:"radius_km"`
	Grid             GridJSON    `json:"grid"`
	LandingElevation float64     `json:"landing_elevation_m"`
	Statistics       Statistics  `json:"statistics"`
	Source           any         `json:"source"`
	Processing       *Processing `json:"processing,omitempty"`

	lunarRadiusM float64
	datumRadiusM float64
}

// SyntheticSource is the provenance block of the demo surface.
type SyntheticSource struct {
	Filename                  string  `json:"filename"`
	Synthetic                 bool    `json:"synthetic"`
	LunarRadiusM              float64 `json:"lunar_radius_m"`
	ElevationReferenceRadiusM float64 `json:"elevation_reference_radius_m"`
	ElevationReference        string  `json:"elevation_reference"`
	Warning                   string  `json:"warning"`
}

// packageGrid mirrors package_grid(): disk mask, 3-dp rounding, exact centre.
func packageGrid(elev []float64, landingM, lat, lon, radiusKm float64, quality string, source any, synthetic bool, mode string, lunarR, datumR float64) (*Terrain, error) {
	g := NewGrid(radiusKm, quality)
	n := g.Size
	out := make([]*float64, n*n)
	count, disk := 0, 0
	lo, hi := math.Inf(1), math.Inf(-1)
	for r := 0; r < n; r++ {
		for c := 0; c < n; c++ {
			if !g.InDisk(r, c) {
				continue
			}
			disk++
			v := elev[r*n+c]
			if math.IsNaN(v) || math.IsInf(v, 0) {
				continue
			}
			count++
			lo, hi = math.Min(lo, v), math.Max(hi, v)
			rounded := roundNumpy(v, 3)
			out[r*n+c] = &rounded
		}
	}
	if count < 4 {
		return nil, Errorf("This DEM has insufficient valid data inside the selected analysis radius.")
	}
	centre := landingM
	out[n/2*n+n/2] = &centre
	return &Terrain{
		Mode: mode, Synthetic: synthetic, Latitude: lat, Longitude: lon, RadiusKm: radiusKm,
		Grid:             GridJSON{Size: n, SpacingM: g.SpacingM, Order: GridOrder, Elevations: out},
		LandingElevation: landingM,
		Statistics:       Statistics{MinimumM: lo, MaximumM: hi, RangeM: hi - lo, CoveragePercent: roundDecimal(100*float64(count)/float64(disk), 2)},
		Source:           source, lunarRadiusM: lunarR, datumRadiusM: datumR,
	}, nil
}

// SyntheticTerrain is deliberately artificial terrain, isolated from every real
// DEM code path. It exists for mesh/shadow/interface development only.
func SyntheticTerrain(latitude, longitude, radiusKm, quality any) (*Terrain, error) {
	lat, lon, radius, q, err := ValidateLocation(latitude, longitude, radiusKm, quality)
	if err != nil {
		return nil, err
	}
	g := NewGrid(radius, q)
	n := g.Size
	elev := make([]float64, n*n)
	for r := 0; r < n; r++ {
		y := g.North(r) / g.RadiusM
		for c := 0; c < n; c++ {
			x := g.East(c) / g.RadiusM
			d := math.Hypot(x-0.23, y+0.12)
			// A crater, ridge, and smooth relief.
			elev[r*n+c] = -1850 + 230*math.Exp(-math.Pow((d-0.43)/0.075, 2)) -
				320*math.Exp(-math.Pow(d/0.29, 4)) +
				110*math.Exp(-math.Pow((x+0.6+y*0.3)/0.11, 2)) +
				25*math.Sin(8*x)*math.Cos(6*y)
		}
	}
	src := &SyntheticSource{Filename: "Synthetic Demo Mode", Synthetic: true, LunarRadiusM: DefaultLunarRadiusM,
		ElevationReferenceRadiusM: DefaultLunarRadiusM, ElevationReference: "Artificial test elevations; no scientific datum", Warning: SyntheticWarning}
	return packageGrid(elev, elev[n/2*n+n/2], lat, lon, radius, q, src, true, "synthetic", DefaultLunarRadiusM, DefaultLunarRadiusM)
}
