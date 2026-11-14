package terrain

import (
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"

	"chandra/backend/geotiff"
	"chandra/backend/lunarcrs"
)

// SourceInfo is the validated provenance block of a real DEM (`source`).
type SourceInfo struct {
	Filename                  string     `json:"filename"`
	CRSName                   string     `json:"crs_name"`
	CRSWKT                    string     `json:"crs_wkt"`
	LunarRadiusM              float64    `json:"lunar_radius_m"`
	ElevationReferenceRadiusM float64    `json:"elevation_reference_radius_m"`
	LatitudeConvention        string     `json:"latitude_convention"`
	ElevationReference        string     `json:"elevation_reference"`
	VerticalUnit              string     `json:"vertical_unit"`
	LunarReferenceFrame       string     `json:"lunar_reference_frame"`
	ValueKind                 string     `json:"value_kind"`
	Scale                     float64    `json:"scale"`
	Offset                    float64    `json:"offset"`
	SourceResolution          [2]float64 `json:"source_resolution"`
	SourceResolutionUnit      string     `json:"source_resolution_unit"`
	Width                     int        `json:"width"`
	Height                    int        `json:"height"`
	Synthetic                 bool       `json:"synthetic"`
	// Additive provenance (v1.12): never invented — absent when unknown.
	DatasetID  string         `json:"dataset_id,omitempty"`
	Provenance map[string]any `json:"provenance,omitempty"`
}

// DEM is an opened, validated elevation raster.
type DEM struct {
	File  *geotiff.File
	CRS   *lunarcrs.CRS
	Info  SourceInfo
	GT    [6]float64
	wrapX bool // geographic raster spanning the full 360° of longitude
	close io.Closer
}

// Close releases the underlying file.
func (d *DEM) Close() {
	if d.close != nil {
		d.close.Close()
	}
}

func thousands(v float64) string {
	s := fmt.Sprintf("%.1f", math.Abs(v))
	whole, frac, _ := strings.Cut(s, ".")
	var b strings.Builder
	for i, ch := range whole {
		if i > 0 && (len(whole)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(ch)
	}
	sign := ""
	if v < 0 {
		sign = "-"
	}
	return sign + b.String() + "." + frac
}

func optString(options map[string]any, key string) (string, bool) {
	s, ok := options[key].(string)
	return s, ok
}

// Inspect validates lunar georeferencing and the explicitly supplied vertical
// datum/units/frame. Nothing about the datum is ever inferred.
func Inspect(f *geotiff.File, options map[string]any, name string) (*DEM, error) {
	if f.SamplesPerPixel != 1 {
		return nil, Errorf("Use a single-band elevation raster, not imagery or a multiband raster.")
	}
	crs, err := lunarcrs.FromGeoTIFF(f)
	if err != nil {
		var unsupported *lunarcrs.UnsupportedError
		if errors.As(err, &unsupported) {
			return nil, Errorf("DEM needs a supported geographic or projected lunar CRS. %s.", strings.TrimSuffix(unsupported.Reason, "."))
		}
		return nil, Errorf("DEM has no CRS. Supply verified lunar georeferencing with GDAL before loading it.")
	}
	gt, ok := f.Geotransform()
	if !ok || gt[1]*gt[5]-gt[2]*gt[4] == 0 {
		return nil, Errorf("DEM has a CRS but no usable geotransform. Supply verified lunar georeferencing with GDAL before loading it.")
	}
	if crs.IsGeographic() && math.Abs(crs.AngularUnitRad-math.Pi/180) > 1e-12 {
		return nil, Errorf("Geographic lunar raster coordinates must use degrees in this version.")
	}
	a, b := crs.SemiMajor, crs.SemiMinor
	if !(a >= LunarRadiusLimitsM[0] && a <= LunarRadiusLimitsM[1]) {
		return nil, Errorf("Unexpected CRS body radius (%s m). An Earth CRS cannot be used for lunar terrain.", thousands(a))
	}
	if math.Abs(a-b) > 0.01 {
		return nil, Errorf("This version supports spherical lunar CRSs only. Verify/convert the DEM and latitude convention first.")
	}
	if f.MaskIFD {
		return nil, Errorf("DEM stores validity in an internal mask band, which this version cannot read. Convert the mask to a NoData value first; coverage is never assumed.")
	}
	reference, ok := optString(options, "elevation_reference")
	if !ok || strings.TrimSpace(reference) == "" || strings.HasPrefix(strings.ToUpper(strings.TrimSpace(reference)), "REPLACE") {
		return nil, Errorf("Set elevation_reference in --dem-config from the product label (datum is never inferred).")
	}
	unit, _ := optString(options, "vertical_unit")
	if unit != "m" && unit != "km" {
		return nil, Errorf("Set vertical_unit to 'm' or 'km' in --dem-config after checking the product label.")
	}
	kind, _ := optString(options, "value_kind")
	if kind != "elevation" && kind != "radius" {
		return nil, Errorf("Set value_kind to 'elevation' or 'radius' in --dem-config; confirm this in the product label.")
	}
	rawRadius, present := options["elevation_reference_radius_m"]
	if !present || rawRadius == nil {
		return nil, Errorf("Set elevation_reference_radius_m explicitly; check the product's elevation datum.")
	}
	refRadius, ok := toFloat(rawRadius)
	if _, isBool := rawRadius.(bool); !ok || isBool {
		return nil, Errorf("elevation_reference_radius_m must be a finite lunar radius in meters.")
	}
	if math.IsNaN(refRadius) || math.IsInf(refRadius, 0) || refRadius < LunarRadiusLimitsM[0] || refRadius > LunarRadiusLimitsM[1] {
		return nil, Errorf("elevation_reference_radius_m must be a lunar radius in meters.")
	}
	scale, offset := f.Scale, f.Offset
	if v, present := options["scale"]; present {
		if scale, ok = toFloat(v); !ok {
			return nil, Errorf("DEM scale and offset must be finite numbers.")
		}
	}
	if v, present := options["offset"]; present {
		if offset, ok = toFloat(v); !ok {
			return nil, Errorf("DEM scale and offset must be finite numbers.")
		}
	}
	if math.IsNaN(scale) || math.IsInf(scale, 0) || math.IsNaN(offset) || math.IsInf(offset, 0) || scale == 0 {
		return nil, Errorf("DEM scale must be finite and nonzero; offset must be finite.")
	}
	frame, ok := optString(options, "lunar_reference_frame")
	if !ok || strings.TrimSpace(frame) == "" || strings.HasPrefix(strings.ToUpper(strings.TrimSpace(frame)), "REPLACE") {
		return nil, Errorf("Set lunar_reference_frame from the product documentation (for example MOON_ME with its ephemeris realization).")
	}
	if math.Abs(crs.PrimeMeridianDeg) > 1e-10 {
		return nil, Errorf("This version requires a zero lunar reference meridian. Verify and convert this CRS first.")
	}
	d := &DEM{File: f, CRS: crs, GT: gt}
	d.Info = SourceInfo{
		Filename: name, CRSName: crs.Name, CRSWKT: crs.WKT(), LunarRadiusM: a,
		ElevationReferenceRadiusM: refRadius, LatitudeConvention: LatitudeConvention,
		ElevationReference: strings.TrimSpace(reference), VerticalUnit: unit,
		LunarReferenceFrame: strings.TrimSpace(frame), ValueKind: kind, Scale: scale, Offset: offset,
		SourceResolution:     [2]float64{math.Hypot(gt[1], gt[4]), math.Hypot(gt[2], gt[5])},
		SourceResolutionUnit: crs.UnitName(), Width: f.Width, Height: f.Height,
		Synthetic: f.Tags["LUNAR_SIM_SOURCE"] == "SYNTHETIC",
	}
	prov := map[string]any{}
	for _, key := range []string{"subset_provenance", "source_url", "product_page", "product_id", "product_version", "source_checksum"} {
		if v, ok := options[key]; ok && v != nil {
			prov[key] = v
		}
	}
	if len(prov) > 0 {
		d.Info.Provenance = prov
	}
	left, right := d.bounds()
	d.wrapX = crs.IsGeographic() && gt[2] == 0 && gt[4] == 0 && math.Abs(math.Abs(right-left)-360) <= 1e-5
	return d, nil
}

// bounds returns the raster x extent (left, right) in CRS units.
func (d *DEM) bounds() (float64, float64) {
	l, r := d.GT[0], d.GT[0]+float64(d.File.Width)*d.GT[1]
	return math.Min(l, r), math.Max(l, r)
}

// OpenDEM opens and validates the configured raster. Real mode never falls
// back to synthetic terrain: every failure is an explicit error.
func OpenDEM(s *Settings) (*DEM, error) {
	if s == nil || s.DEMPath == "" {
		return nil, Errorf("No DEM configured. Start with --dem data/your_dem.tif --dem-config dem_config.json, or choose Synthetic Demo Mode.")
	}
	st, err := os.Stat(s.DEMPath)
	if err != nil || !st.Mode().IsRegular() {
		return nil, Errorf("DEM file does not exist: %s. Check --dem and the data directory.", filepath.Base(s.DEMPath))
	}
	fh, err := os.Open(s.DEMPath)
	if err != nil {
		return nil, Errorf("Cannot read DEM. Check that the raster is intact and its label/georeferencing is available. %v", err)
	}
	f, err := geotiff.Open(fh, st.Size())
	if err != nil {
		fh.Close()
		return nil, Errorf("Cannot read DEM. Check that the raster is intact and its label/georeferencing is available. %v", err)
	}
	d, err := Inspect(f, s.Options, filepath.Base(s.DEMPath))
	if err != nil {
		fh.Close()
		return nil, err
	}
	d.close = fh
	d.Info.DatasetID = s.DatasetID
	return d, nil
}

// ToElevationM converts a raw sample to metres above the reference sphere.
func (d *DEM) ToElevationM(raw float64) float64 {
	v := raw*d.Info.Scale + d.Info.Offset
	if d.Info.VerticalUnit == "km" {
		v *= 1000.0
	}
	if d.Info.ValueKind == "radius" {
		v -= d.Info.ElevationReferenceRadiusM
	}
	return v
}

// PixelCoords maps lon/lat to fractional pixel-edge coordinates.
func (d *DEM) PixelCoords(lon, lat float64) (px, py float64, ok bool) {
	x, y, ok := d.CRS.Forward(lon, lat)
	if !ok {
		return 0, 0, false
	}
	if d.CRS.IsGeographic() {
		// Accommodate a geographic raster stored with longitudes in 0…360.
		left, right := d.bounds()
		for _, cand := range []float64{x, x + 360, x - 360} {
			if left <= cand && cand <= right {
				x = cand
				break
			}
		}
	}
	g := d.GT
	det := g[1]*g[5] - g[2]*g[4]
	px = (g[5]*(x-g[0]) - g[2]*(y-g[3])) / det
	py = (-g[4]*(x-g[0]) + g[1]*(y-g[3])) / det
	return px, py, true
}

// sample returns a raw value and whether it is valid data.
func (d *DEM) sample(win *window, col, row int) (float64, bool, error) {
	if d.wrapX {
		col = ((col % d.File.Width) + d.File.Width) % d.File.Width
	}
	if col < 0 || row < 0 || col >= d.File.Width || row >= d.File.Height {
		return 0, false, nil
	}
	var v float64
	if win != nil && col >= win.x0 && row >= win.y0 && col < win.x0+win.w && row < win.y0+win.h {
		v = win.data[(row-win.y0)*win.w+(col-win.x0)]
	} else {
		var err error
		if v, _, err = d.File.Pixel(col, row); err != nil {
			return 0, false, err
		}
	}
	if d.File.IsNoData(v) || math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, false, nil
	}
	return v, true, nil
}

type window struct {
	x0, y0, w, h int
	data         []float64
}

func readErr(err error) error {
	return Errorf("Cannot read DEM. Check that the raster is intact and its label/georeferencing is available. %v", err)
}

// LandingElevation is a bilinear sample of the native raster, independent of
// the displayed grid quality. Any masked stencil cell is an error, never filled.
func (d *DEM) LandingElevation(latitude, longitude float64) (float64, error) {
	col, row, ok := d.PixelCoords(longitude, latitude)
	if !ok || !(col >= 0 && col < float64(d.File.Width) && row >= 0 && row < float64(d.File.Height)) {
		return 0, Errorf("Selected landing point is outside the DEM. Choose a coordinate covered by this product.")
	}
	col -= 0.5
	row -= 0.5
	left, top := int(math.Floor(col)), int(math.Floor(row))
	u, v := col-float64(left), row-float64(top)
	weights := [4]float64{(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v}
	sum := 0.0
	for i, w := range weights {
		raw, valid, err := d.sample(nil, left+i%2, top+i/2)
		if err != nil {
			return 0, readErr(err)
		}
		if !valid {
			if w > 1e-10 {
				return 0, Errorf("Landing point is on a DEM edge or NoData gap; its elevation cannot be interpolated.")
			}
			continue
		}
		sum += d.ToElevationM(raw) * w
	}
	if math.IsNaN(sum) || math.IsInf(sum, 0) {
		return 0, Errorf("DEM contains an invalid elevation at the landing point.")
	}
	return sum, nil
}

// groundResolution returns the ground size (m) of one source pixel along the
// raster x and y axes at a site.
func (d *DEM) groundResolution(lon, lat float64) (float64, float64) {
	rx, ry := d.Info.SourceResolution[0], d.Info.SourceResolution[1]
	switch d.CRS.Kind {
	case lunarcrs.Geographic:
		m := math.Pi / 180 * d.Info.LunarRadiusM
		return rx * m * math.Max(math.Cos(lat*math.Pi/180), 1e-12), ry * m
	case lunarcrs.Equirectangular:
		return rx * d.CRS.LinearUnitM * math.Cos(lat*math.Pi/180) / math.Max(math.Cos(d.CRS.LatTS*math.Pi/180), 1e-12), ry * d.CRS.LinearUnitM
	}
	k := d.CRS.MeridionalScale(lon, lat)
	return rx * d.CRS.LinearUnitM / k, ry * d.CRS.LinearUnitM / k
}

func tent(x float64) float64 {
	if x = math.Abs(x); x <= 1 {
		return 1 - x
	}
	return 0
}

// resample evaluates the GDAL-compatible masked bilinear kernel at fractional
// pixel-edge coordinates. With sx,sy >= 0.95 it is the classic four-sample
// bilinear; otherwise the tent is widened by 1/scale (anti-aliasing when the
// output grid is coarser than the source). Invalid samples are skipped and the
// weights renormalised; a cell whose containing source pixel is invalid, or
// which lies outside the raster, is a gap.
func (d *DEM) resample(win *window, px, py, sx, sy float64) (float64, bool, error) {
	w, h := float64(d.File.Width), float64(d.File.Height)
	if d.wrapX {
		px = math.Mod(px, w)
		if px < 0 {
			px += w
		}
	}
	if !(px >= 0 && py >= 0 && px+1e-10 <= w && py+1e-10 <= h) {
		return 0, false, nil
	}
	nearX, nearY := int(math.Floor(px+1e-10)), int(math.Floor(py+1e-10))
	if nearX == d.File.Width {
		nearX--
	}
	if nearY == d.File.Height {
		nearY--
	}
	if _, valid, err := d.sample(win, nearX, nearY); err != nil || !valid {
		return 0, false, err
	}
	ix, iy := int(math.Floor(px-0.5)), int(math.Floor(py-0.5))
	var acc, div float64
	if sx >= 0.95 && sy >= 0.95 {
		rx, ry := 1.5-(px-float64(ix)), 1.5-(py-float64(iy))
		if ix == -1 && !d.wrapX {
			ix, rx = 0, 1
		}
		if iy == -1 {
			iy, ry = 0, 1
		}
		for k, wt := range [4]float64{rx * ry, (1 - rx) * ry, rx * (1 - ry), (1 - rx) * (1 - ry)} {
			v, valid, err := d.sample(win, ix+k%2, iy+k/2)
			if err != nil {
				return 0, false, err
			}
			if valid {
				acc += v * wt
				div += wt
			}
		}
		if div < 0.00001 {
			return 0, false, nil
		}
		if div != 1.0 {
			acc /= div
		}
		return acc, true, nil
	}
	dx, dy := px-0.5-float64(ix), py-0.5-float64(iy)
	radX, radY := 1, 1
	if sx < 1 {
		radX = int(math.Ceil(1 / sx))
	}
	if sy < 1 {
		radY = int(math.Ceil(1 / sy))
	}
	for j := -radY; j <= radY; j++ {
		row := iy + j
		if row < 0 || row >= d.File.Height {
			continue
		}
		wy := tent(float64(j) - dy)
		if sy < 1 {
			wy = tent((float64(j) - dy) * sy)
		}
		var accRow, divRow float64
		for i := -radX; i <= radX; i++ {
			v, valid, err := d.sample(win, ix+i, row)
			if err != nil {
				return 0, false, err
			}
			if !valid {
				continue
			}
			wx := tent(float64(i) - dx)
			if sx < 1 {
				wx = tent((float64(i) - dx) * sx)
			}
			accRow += v * wx
			divRow += wx
		}
		acc += accRow * wy
		div += divRow * wy
	}
	if div < 0.000001 {
		return 0, false, nil
	}
	if div < 0.99999 || div > 1.00001 {
		acc /= div
	}
	return acc, true, nil
}

// ExtractOptions tunes extraction for diagnostics/tests. The zero value is the
// production configuration.
type ExtractOptions struct {
	// ForcePointKernel disables the downsampling-aware kernel (diagnostics only).
	ForcePointKernel bool
}

// ExtractTerrain resamples only the requested region into a bounded,
// landing-centred grid in a local azimuthal-equidistant frame on the DEM's own
// lunar sphere.
func ExtractTerrain(s *Settings, latitude, longitude, radiusKm, quality any, opts ...ExtractOptions) (*Terrain, error) {
	lat, lon, radius, q, err := ValidateLocation(latitude, longitude, radiusKm, quality)
	if err != nil {
		return nil, err
	}
	d, err := OpenDEM(s)
	if err != nil {
		return nil, err
	}
	defer d.Close()
	return d.Extract(lat, lon, radius, q, opts...)
}

// Extract performs the extraction on an already opened DEM (validated inputs).
func (d *DEM) Extract(lat, lon, radius float64, q string, opts ...ExtractOptions) (*Terrain, error) {
	g := NewGrid(radius, q)
	n := g.Size
	landing, err := d.LandingElevation(lat, lon)
	if err != nil {
		return nil, err
	}
	local := &lunarcrs.CRS{Kind: lunarcrs.AzimuthalEquidistant, SemiMajor: d.Info.LunarRadiusM, SemiMinor: d.Info.LunarRadiusM, Lat0: lat, Lon0: lon, K0: 1, LinearUnitM: 1}
	gx, gy := d.groundResolution(lon, lat)
	sx, sy := math.Min(1, gx/g.SpacingM), math.Min(1, gy/g.SpacingM)
	if len(opts) > 0 && opts[0].ForcePointKernel {
		sx, sy = 1, 1
	}
	kernel := "bilinear-4-sample"
	if sx >= 0.95 && sy >= 0.95 {
		sx, sy = 1, 1
	} else {
		kernel = "bilinear-scaled-tent"
	}
	// Pass 1: exact per-cell transform; collect the source footprint.
	px := make([]float64, n*n)
	py := make([]float64, n*n)
	minX, minY, maxX, maxY := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	for r := 0; r < n; r++ {
		for c := 0; c < n; c++ {
			i := r*n + c
			px[i] = math.NaN()
			if !g.InDisk(r, c) {
				continue
			}
			lo, la, ok := local.Inverse(g.East(c), g.North(r))
			if !ok {
				continue
			}
			x, y, ok := d.PixelCoords(lo, la)
			if !ok {
				continue
			}
			px[i], py[i] = x, y
			minX, maxX = math.Min(minX, x), math.Max(maxX, x)
			minY, maxY = math.Min(minY, y), math.Max(maxY, y)
		}
	}
	var win *window
	if !math.IsInf(minX, 0) {
		pad := int(math.Ceil(1/math.Min(sx, sy))) + 2
		x0, y0 := max(0, int(math.Floor(minX))-pad), max(0, int(math.Floor(minY))-pad)
		x1, y1 := min(d.File.Width, int(math.Ceil(maxX))+pad), min(d.File.Height, int(math.Ceil(maxY))+pad)
		if x1 > x0 && y1 > y0 && (x1-x0)*(y1-y0) <= MaxSubsetPixels {
			data, err := d.File.ReadWindow(x0, y0, x1-x0, y1-y0)
			if err != nil {
				return nil, readErr(err)
			}
			win = &window{x0, y0, x1 - x0, y1 - y0, data}
		}
	}
	elev := make([]float64, n*n)
	for i := range elev {
		elev[i] = math.NaN()
		if math.IsNaN(px[i]) {
			continue
		}
		v, ok, err := d.resample(win, px[i], py[i], sx, sy)
		if err != nil {
			return nil, readErr(err)
		}
		if ok {
			// The former GDAL pipeline produced float32 samples; keep that precision.
			elev[i] = d.ToElevationM(float64(float32(v)))
		}
	}
	// Anchor the exact native-resolution landing sample even after resampling.
	elev[n/2*n+n/2] = landing
	info := d.Info
	t, err := packageGrid(elev, landing, lat, lon, radius, q, &info, info.Synthetic, "real", info.LunarRadiusM, info.ElevationReferenceRadiusM)
	if err != nil {
		return nil, err
	}
	t.Processing = &Processing{Engine: Engine, Resampling: "bilinear", Kernel: kernel, KernelScale: [2]float64{sx, sy},
		Transform: "exact per-cell local azimuthal-equidistant to source projection (no approximation grid)", DatasetID: info.DatasetID}
	return t, nil
}
