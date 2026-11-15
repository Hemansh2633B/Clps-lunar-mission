package terrain

import (
	"math"
)

// Horizon is the /api/horizon response: a ray-marched local horizon mask in the
// landing tangent frame. It is a geometric terrain horizon; it does not
// validate the DEM body frame against an ephemeris frame.
type Horizon struct {
	Latitude            float64     `json:"latitude"`
	Longitude           float64     `json:"longitude"`
	RadiusKm            float64     `json:"radius_km"`
	HorizonRadiusKm     float64     `json:"horizon_radius_km"`
	EdgeInsetM          float64     `json:"edge_inset_m"`
	SamplingStepM       float64     `json:"sampling_step_m"`
	GridSize            int         `json:"grid_size"`
	GridSpacingM        float64     `json:"grid_spacing_m"`
	EyeHeightM          float64     `json:"eye_height_m"`
	AzimuthStepDeg      int         `json:"azimuth_step_deg"`
	AzimuthsDeg         []int       `json:"azimuths_deg"`
	ElevationsDeg       []float64   `json:"elevations_deg"`
	RayCoveragePercent  []float64   `json:"ray_coverage_percent"`
	MaxObstacleRangeKm  []float64   `json:"max_obstacle_range_km"`
	MeanCoveragePercent float64     `json:"mean_coverage_percent"`
	Synthetic           bool        `json:"synthetic"`
	Source              any         `json:"source"`
	Model               string      `json:"model"`
	FrameNote           string      `json:"frame_note"`
	Processing          *Processing `json:"processing,omitempty"`
}

const (
	horizonModel = "Ray-marched DEM grid horizon in the landing tangent frame; spherical curvature included. A conservative edge inset keeps bilinear stencils inside the analysis disk. NoData rays are reported, never filled."
	frameNote    = "Verify the DEM lunar_reference_frame matches the ephemeris body frame before using this mask for mission visibility."
)

func (t *Terrain) sampleGrid(east, north, radiusM float64) (float64, bool) {
	n := t.Grid.Size
	spacing := t.Grid.SpacingM
	col := (east + radiusM) / spacing
	row := (radiusM - north) / spacing
	c, r := int(math.Floor(col)), int(math.Floor(row))
	if c < 0 || r < 0 || c >= n-1 || r >= n-1 {
		return 0, false
	}
	e := t.Grid.Elevations
	h0, h1, h2, h3 := e[r*n+c], e[r*n+c+1], e[(r+1)*n+c], e[(r+1)*n+c+1]
	if h0 == nil || h1 == nil || h2 == nil || h3 == nil {
		return 0, false
	}
	u, v := col-float64(c), row-float64(r)
	return *h0*(1-u)*(1-v) + *h1*u*(1-v) + *h2*(1-u)*v + *h3*u*v, true
}

// HorizonFromGrid ray-marches a 360° horizon mask from an extracted grid.
// A conservative edge inset of sqrt(2) grid spacings keeps every bilinear
// stencil inside the analysis disk; the excluded annulus is disclosed.
func HorizonFromGrid(t *Terrain, azStepDeg, eyeHeightM any) (*Horizon, error) {
	if _, isBool := azStepDeg.(bool); isBool {
		return nil, Errorf("az_step_deg and eye_height_m must be numbers.")
	}
	if _, isBool := eyeHeightM.(bool); isBool {
		return nil, Errorf("az_step_deg and eye_height_m must be numbers.")
	}
	azf, ok1 := toFloat(azStepDeg)
	eye, ok2 := toFloat(eyeHeightM)
	if !ok1 || !ok2 {
		return nil, Errorf("az_step_deg and eye_height_m must be numbers.")
	}
	if math.IsNaN(azf) || math.IsInf(azf, 0) || azf != math.Trunc(azf) {
		return nil, Errorf("az_step_deg must be an integer between 1 and 15 that divides 360.")
	}
	azStep := int(azf)
	if azStep < 1 || azStep > 15 || 360%azStep != 0 {
		return nil, Errorf("az_step_deg must be an integer between 1 and 15 that divides 360.")
	}
	if math.IsNaN(eye) || math.IsInf(eye, 0) || eye < 0 || eye > 50 {
		return nil, Errorf("eye_height_m must be between 0 and 50 meters.")
	}
	radiusM := t.RadiusKm * 1000
	spacing := t.Grid.SpacingM
	edgeInset := spacing * math.Sqrt2
	horizonRadius := math.Max(spacing, radiusM-edgeInset)
	step := math.Max(spacing*0.5, 1.0)
	lunarRadius, datumRadius := t.lunarRadiusM, t.datumRadiusM
	observerHeight := t.LandingElevation + eye
	count := 360 / azStep
	h := &Horizon{
		Latitude: t.Latitude, Longitude: t.Longitude, RadiusKm: t.RadiusKm,
		HorizonRadiusKm: roundDecimal(horizonRadius/1000, 4), EdgeInsetM: roundDecimal(edgeInset, 3), SamplingStepM: roundDecimal(step, 3),
		GridSize: t.Grid.Size, GridSpacingM: spacing, EyeHeightM: eye, AzimuthStepDeg: azStep,
		AzimuthsDeg: make([]int, count), ElevationsDeg: make([]float64, count), RayCoveragePercent: make([]float64, count),
		MaxObstacleRangeKm: make([]float64, count), Synthetic: t.Synthetic, Source: t.Source, Model: horizonModel, FrameNote: frameNote,
		Processing: t.Processing,
	}
	sumCoverage := 0.0
	for i := 0; i < count; i++ {
		az := i * azStep
		bearing := float64(az) * math.Pi / 180
		best, bestRange := -90.0, 0.0
		valid, total := 0, 0
		for distance := spacing; distance <= horizonRadius+1e-6; distance += step {
			total++
			east, north := distance*math.Sin(bearing), distance*math.Cos(bearing)
			if height, ok := t.sampleGrid(east, north, radiusM); ok {
				valid++
				angle := distance / lunarRadius
				radial := datumRadius + height
				scale := radial * math.Sin(angle) / distance
				up := radial*math.Cos(angle) - (datumRadius + observerHeight)
				elevation := math.Atan2(up, distance*scale) * 180 / math.Pi
				if elevation > best {
					best, bestRange = elevation, distance
				}
			}
		}
		h.AzimuthsDeg[i] = az
		h.ElevationsDeg[i] = roundDecimal(best, 4)
		if total > 0 {
			h.RayCoveragePercent[i] = roundDecimal(100*float64(valid)/float64(total), 2)
		}
		h.MaxObstacleRangeKm[i] = roundDecimal(bestRange/1000, 4)
		sumCoverage += h.RayCoveragePercent[i]
	}
	h.MeanCoveragePercent = roundDecimal(sumCoverage/float64(count), 2)
	return h, nil
}

// Request is a decoded /api/terrain or /api/horizon JSON body.
type Request map[string]any

func (r Request) get(key string, def any) any {
	if v, ok := r[key]; ok {
		return v
	}
	return def
}

// Opener yields the DEM a real-mode request should read.
type Opener func() (*DEM, error)

// Build produces the terrain for a request body (real or synthetic). Inputs are
// validated before the DEM is opened. Real mode never falls back to synthetic data.
func Build(open Opener, body Request) (*Terrain, error) {
	switch mode := body.get("mode", "real"); mode {
	case "synthetic":
		return SyntheticTerrain(body["latitude"], body["longitude"], body["radius_km"], body.get("quality", "medium"))
	case "real":
		lat, lon, radius, q, err := ValidateLocation(body["latitude"], body["longitude"], body["radius_km"], body.get("quality", "medium"))
		if err != nil {
			return nil, err
		}
		d, err := open()
		if err != nil {
			return nil, err
		}
		defer d.Close()
		return d.Extract(lat, lon, radius, q)
	default:
		return nil, Errorf("Mode must be real or synthetic.")
	}
}

// ExtractHorizon builds the terrain for a request and ray-marches its horizon.
func ExtractHorizon(open Opener, body Request) (*Horizon, error) {
	t, err := Build(open, body)
	if err != nil {
		return nil, err
	}
	return HorizonFromGrid(t, body.get("az_step_deg", 2.0), body.get("eye_height_m", 2.0))
}

// SettingsOpener opens the single configured DEM.
func SettingsOpener(s *Settings) Opener { return func() (*DEM, error) { return OpenDEM(s) } }
