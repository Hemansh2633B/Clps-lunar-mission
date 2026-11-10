// Package terrain contains the isolated Go migration candidate. Python remains
// the production reference until the complete parity gate passes.
package terrain

import (
	"errors"
	"math"
	"strconv"

	"github.com/Hemansh2633B/Clps-lunar-mission/internal/geotiff"
	"github.com/Hemansh2633B/Clps-lunar-mission/internal/lunarcrs"
)

type Grid struct {
	Size                              int
	Spacing                           float64
	Elevations                        []*float64
	Landing                           float64
	Minimum, Maximum, Range, Coverage float64
}

func ptr(v float64) *float64 { return &v }

// Round matches Python's decimal half-even rounding of the binary float, not
// the common scale-round-unscale approximation (which rounds exact .5 ties up).
func Round(v float64, places int) float64 {
	if !finite(v) {
		return v
	}
	s := strconv.FormatFloat(v, 'f', places, 64)
	n, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return v
	}
	return n
}
func elevation(raw float64, r *geotiff.Raster, unit, kind string, datum float64) float64 {
	return convertElevation(float64(float32(raw)), r, unit, kind, datum)
}
func convertElevation(raw float64, r *geotiff.Raster, unit, kind string, datum float64) float64 {
	v := raw*r.Scale + r.Offset
	if unit == "km" {
		v *= 1000
	}
	if kind == "radius" {
		v -= datum
	}
	return v
}
func nativeSample(r *geotiff.Raster, col, row float64, shift float64) (float64, bool) {
	col += shift / r.C
	col -= .5
	row -= .5
	left, top := int(math.Floor(col)), int(math.Floor(row))
	full := r.CRS.Projection == "longlat" && math.Abs(float64(r.Width)*r.C-360) < 1e-5
	values := make([]float64, 4)
	for j := 0; j < 2; j++ {
		for i := 0; i < 2; i++ {
			x, y := left+i, top+j
			if y < 0 || y >= r.Height {
				return 0, false
			}
			if full {
				x = ((x % r.Width) + r.Width) % r.Width
			} else if x < 0 || x >= r.Width {
				return 0, false
			}
			a, err := r.ReadWindow(x, y, 1, 1)
			if err != nil || !r.RawValid(a[0]) {
				return 0, false
			}
			values[j*2+i] = a[0]
		}
	}
	u, v := col-float64(left), row-float64(top)
	// GDAL's four-weight accumulator, in its exact source order. This matters
	// at a float32 tie (the radius fixture deliberately exercises that case).
	rx, ry := 1-u, 1-v
	w0, w1, w2, w3 := rx*ry, u*ry, u*v, rx*v
	return ((values[0]*w0 + values[1]*w1) + values[3]*w2) + values[2]*w3, true
}

// globalWarpWindow mirrors GDAL's source→destination 23×23 sampling used to
// estimate the source window when the inverse edge transform crosses a seam.
func globalWarpWindow(r *geotiff.Raster, target *lunarcrs.CRS, radius, spacing float64, size int) (int, int, int, int, float64, float64, error) {
	minX, minY := math.Inf(1), math.Inf(1)
	maxX, maxY := math.Inf(-1), math.Inf(-1)
	steps := make([]float64, 23)
	steps[0], steps[22] = .5/float64(size), 1-.5/float64(size)
	for i := 1; i <= 21; i++ {
		steps[i] = float64(i-1) / 20
	}
	for _, yr := range steps {
		for _, xr := range steps {
			sx := r.X0 + xr*float64(r.Width)*r.C
			sy := r.Y0 - yr*float64(r.Height)*r.PixelHeight()
			var east, north float64
			if lunarcrs.Equivalent(r.CRS, target) {
				east, north = sx, sy
			} else {
				lon, lat, e := r.CRS.Inverse(sx, sy)
				if e != nil {
					continue
				}
				east, north, e = target.Forward(lon, lat)
				if e != nil {
					continue
				}
			}
			dx, dy := (east+radius)/spacing, (radius-north)/spacing
			if dx >= 0 && dx <= float64(size) && dy >= 0 && dy <= float64(size) {
				minX, maxX = math.Min(minX, xr*float64(r.Width)), math.Max(maxX, xr*float64(r.Width))
				minY, maxY = math.Min(minY, yr*float64(r.Height)), math.Max(maxY, yr*float64(r.Height))
			}
		}
	}
	if !finite(minX) {
		return 0, 0, 0, 0, 0, 0, errors.New("unable to estimate warp source window")
	}
	xScale := math.Max(.001, float64(size)/(maxX-minX))
	yScale := math.Max(.001, float64(size)/(maxY-minY))
	xRadius, yRadius := int(math.Ceil(1/xScale)), int(math.Ceil(1/yScale))
	x0, x1 := int(math.Floor(minX))-xRadius, int(math.Ceil(maxX))+xRadius
	y0, y1 := int(math.Floor(minY))-yRadius, int(math.Ceil(maxY))+yRadius
	if maxX-minX > .9*float64(r.Width) {
		x0, x1 = 0, r.Width
	}
	if maxY-minY > .9*float64(r.Height) {
		y0, y1 = 0, r.Height
	}
	if x0 < 0 {
		x0 = 0
	}
	if y0 < 0 {
		y0 = 0
	}
	if x1 > r.Width {
		x1 = r.Width
	}
	if y1 > r.Height {
		y1 = r.Height
	}
	return x0, y0, x1 - x0, y1 - y0, xScale, yScale, nil
}

type globalWarpPlan struct {
	x0, y0, width, height, size int
	xScale, yScale              float64
	cols, rows                  []float64
	aliasCols, aliasRows        []float64
	hasAlias                    bool
}

func makeGlobalWarp(r *geotiff.Raster, target *lunarcrs.CRS, radius, spacing float64, size int) (*globalWarpPlan, error) {
	x0, y0, w, h, xs, ys, err := globalWarpWindow(r, target, radius, spacing, size)
	if err != nil {
		return nil, err
	}
	p := &globalWarpPlan{x0: x0, y0: y0, width: w, height: h, size: size, xScale: xs, yScale: ys, cols: make([]float64, size*size), rows: make([]float64, size*size)}
	p.hasAlias = math.Abs(r.X0) < 1e-10 && math.Abs(float64(r.Width)*r.C-360) < 1e-5
	if p.hasAlias {
		p.aliasCols = make([]float64, size*size)
		p.aliasRows = make([]float64, size*size)
	}
	for iy := 0; iy < size; iy++ {
		north := radius - float64(iy)*spacing
		exact := func(ix int, shift float64) (float64, float64, error) {
			east := -radius + float64(ix)*spacing
			lon, lat, e := target.Inverse(east, north)
			if e != nil {
				return 0, 0, e
			}
			col, row := r.GeoToPixel(lon+shift, lat)
			return col, row, nil
		}
		build := func(cols, rows []float64, shift float64) error {
			var approximate func(int, int) error
			approximate = func(lo, hi int) error {
				count := hi - lo + 1
				if count <= 5 {
					for i := lo; i <= hi; i++ {
						c, rw, e := exact(i, shift)
						if e != nil {
							return e
						}
						if shift == 0 && p.hasAlias && c > 180 {
							c -= 360
						}
						cols[iy*size+i], rows[iy*size+i] = c, rw
					}
					return nil
				}
				mid := lo + (count-1)/2
				c0, r0, e := exact(lo, shift)
				if e != nil {
					return e
				}
				cm, rm, e := exact(mid, shift)
				if e != nil {
					return e
				}
				c1, r1, e := exact(hi, shift)
				if e != nil {
					return e
				}
				f := float64(mid-lo) / float64(hi-lo)
				errorDist := math.Abs(c0+(c1-c0)*f-cm) + math.Abs(r0+(r1-r0)*f-rm)
				if errorDist <= .125 {
					for i := lo; i <= hi; i++ {
						f = float64(i-lo) / float64(hi-lo)
						c := c0 + (c1-c0)*f
						if shift == 0 && p.hasAlias && c > 180 {
							c -= 360
						}
						cols[iy*size+i], rows[iy*size+i] = c, r0+(r1-r0)*f
					}
					return nil
				}
				if e = approximate(lo, mid-1); e != nil {
					return e
				}
				return approximate(mid, hi)
			}
			if e := approximate(0, size-1); e != nil {
				return e
			}
			// Do not let an allowed sub-pixel approximation change whether the
			// transformed center lies just inside or outside a source seam.
			for i := 0; i < size; i++ {
				at := iy*size + i
				c := cols[at]
				if math.Abs(c) < .1 || math.Abs(c-float64(r.Width)) < .1 {
					ec, er, e := exact(i, shift)
					if e != nil {
						return e
					}
					cols[at], rows[at] = ec, er
				}
			}
			return nil
		}
		if err = build(p.cols, p.rows, 0); err != nil {
			return nil, err
		}
		if p.hasAlias {
			if err = build(p.aliasCols, p.aliasRows, 360/r.C); err != nil {
				return nil, err
			}
		}
	}
	return p, nil
}

func globalWarpSample(r *geotiff.Raster, p *globalWarpPlan, ix, iy int) (float64, bool, error) {
	if p.width == 0 || p.height == 0 {
		return 0, false, nil
	}
	idx := iy*p.size + ix
	if v, ok, e := warpKernelSample(r, p, p.cols[idx], p.rows[idx]); e != nil || ok {
		return v, ok, e
	}
	if p.hasAlias {
		return warpKernelSample(r, p, p.aliasCols[idx], p.aliasRows[idx])
	}
	return 0, false, nil
}

func warpKernelSample(r *geotiff.Raster, p *globalWarpPlan, col, row float64) (float64, bool, error) {
	// GDAL skips a destination pixel when its transformed source center is outside
	// the source image; the shifted alias pass is then tried only for that NaN.
	if col < 0 || col >= float64(r.Width) || row < 0 || row >= float64(r.Height) {
		return 0, false, nil
	}
	px, py := col-float64(p.x0), row-float64(p.y0)
	ix, iy := int(math.Floor(px-.5)), int(math.Floor(py-.5))
	dx, dy := px-.5-float64(ix), py-.5-float64(iy)
	rx, ry := int(math.Ceil(1/math.Min(p.xScale, 1))), int(math.Ceil(1/math.Min(p.yScale, 1)))
	acc, den := 0., 0.
	for j := 1 - ry; j <= ry; j++ {
		wy := 1 - math.Abs((float64(j)-dy)*math.Min(p.yScale, 1))
		if wy <= 0 {
			continue
		}
		line, lineDen := 0., 0.
		for i := 1 - rx; i <= rx; i++ {
			wx := 1 - math.Abs((float64(i)-dx)*math.Min(p.xScale, 1))
			if wx <= 0 {
				continue
			}
			x, y := ix+i+p.x0, iy+j+p.y0
			if x < 0 || x >= r.Width || y < 0 || y >= r.Height {
				continue
			}
			v, e := r.ReadWindow(x, y, 1, 1)
			if e != nil {
				return 0, false, e
			}
			if !r.RawValid(v[0]) {
				continue
			}
			line += v[0] * wx
			lineDen += wx
		}
		acc += line * wy
		den += lineDen * wy
	}
	if den < 1e-12 {
		return 0, false, nil
	}
	return float64(float32(acc / den)), true, nil
}

func Extract(r *geotiff.Raster, lat, lon, radiusKM float64, size int, unit, kind string, datum float64) (*Grid, error) {
	if size != 129 && size != 257 && size != 513 || radiusKM < .5 || radiusKM > 20 || lat < -90 || lat > 90 {
		return nil, errors.New("invalid terrain request")
	}
	originalLon := lon
	lon = math.Mod(lon+180, 360)
	if lon < 0 {
		lon += 360
	}
	lon -= 180
	radius := radiusKM * 1000
	spacing := 2 * radius / float64(size-1)
	target := lunarcrs.Local(lat, lon, r.CRS.Radius)
	var globalPlan *globalWarpPlan
	if r.CRS.Projection == "longlat" && math.Abs(float64(r.Width)*r.C-360) < 1e-5 {
		var e error
		globalPlan, e = makeGlobalWarp(r, target, radius, spacing, size)
		if e != nil {
			return nil, e
		}
	}
	// Match the native-resolution landing sampler's representation choice before
	// normalizing longitude for the local AEQD frame (0…360 products use +360).
	sampleX := originalLon
	if r.CRS.Projection == "longlat" {
		for _, candidate := range []float64{originalLon, originalLon + 360, originalLon - 360} {
			if candidate >= r.X0 && candidate <= r.X0+float64(r.Width)*r.C {
				sampleX = candidate
				break
			}
		}
	}
	sourceX, sourceY, err := r.CRS.Forward(sampleX, lat)
	if err != nil {
		return nil, err
	}
	sampleCol, sampleRow := r.GeoToPixel(sourceX, sourceY)
	landingRaw, ok := nativeSample(r, sampleCol, sampleRow, 0)
	if !ok {
		return nil, errors.New("Landing point is on a DEM edge or NoData gap; its elevation cannot be interpolated.")
	}
	landing := convertElevation(landingRaw, r, unit, kind, datum)
	g := &Grid{Size: size, Spacing: spacing, Elevations: make([]*float64, size*size), Landing: landing, Minimum: math.Inf(1), Maximum: math.Inf(-1)}
	count, disk := 0, 0
	for iy := 0; iy < size; iy++ {
		north := radius - float64(iy)*spacing
		for ix := 0; ix < size; ix++ {
			east := -radius + float64(ix)*spacing
			if math.Hypot(east, north) > radius+1e-6 {
				continue
			}
			disk++
			var raw float64
			var ok bool
			if globalPlan != nil {
				raw, ok, err = globalWarpSample(r, globalPlan, ix, iy)
			} else {
				glon, glat, e := target.Inverse(east, north)
				if e != nil {
					return nil, e
				}
				var sx, sy float64
				if lunarcrs.Equivalent(r.CRS, target) {
					sx, sy = east, north
				} else {
					sx, sy, e = r.CRS.Forward(glon, glat)
					if e != nil {
						return nil, e
					}
				}
				c, rw := r.GeoToPixel(sx, sy)
				raw, ok = nativeSample(r, c, rw, 0)
			}
			if err != nil {
				return nil, err
			}
			if !ok {
				continue
			}
			v := elevation(raw, r, unit, kind, datum)
			if !finite(v) {
				continue
			}
			count++
			g.Minimum = math.Min(g.Minimum, v)
			g.Maximum = math.Max(g.Maximum, v)
			g.Elevations[iy*size+ix] = ptr(Round(v, 3))
		}
	}
	if count < 4 {
		return nil, errors.New("This DEM has insufficient valid data inside the selected analysis radius.")
	}
	g.Range = g.Maximum - g.Minimum
	g.Coverage = Round(100*float64(count)/float64(disk), 2)
	g.Elevations[size/2*size+size/2] = ptr(landing)
	return g, nil
}
func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func sample(g *Grid, east, north, radius float64) (float64, bool) {
	col := (east + radius) / g.Spacing
	row := (radius - north) / g.Spacing
	c, r := int(math.Floor(col)), int(math.Floor(row))
	n := g.Size
	if c < 0 || r < 0 || c >= n-1 || r >= n-1 {
		return 0, false
	}
	a, b, c2, d := g.Elevations[r*n+c], g.Elevations[r*n+c+1], g.Elevations[(r+1)*n+c], g.Elevations[(r+1)*n+c+1]
	if a == nil || b == nil || c2 == nil || d == nil {
		return 0, false
	}
	u, v := col-float64(c), row-float64(r)
	return *a*(1-u)*(1-v) + *b*u*(1-v) + *c2*(1-u)*v + *d*u*v, true
}

type Horizon struct {
	Elevations, Coverage, Ranges      []float64
	MeanCoverage, Radius, Inset, Step float64
}

func HorizonFromGrid(g *Grid, lat, lon, radiusKM, lunarRadius, datum float64, azStep int, eye float64) (*Horizon, error) {
	if azStep < 1 || azStep > 15 || 360%azStep != 0 || eye < 0 || eye > 50 {
		return nil, errors.New("invalid horizon request")
	}
	radius := radiusKM * 1000
	inset := g.Spacing * math.Sqrt2
	hr := math.Max(g.Spacing, radius-inset)
	step := math.Max(g.Spacing*.5, 1)
	observer := g.Landing + eye
	h := &Horizon{Radius: Round(hr/1000, 4), Inset: Round(inset, 3), Step: Round(step, 3)}
	for az := 0; az < 360; az += azStep {
		bearing := float64(az) * math.Pi / 180
		best, bestRange := -90., 0.
		valid, total := 0, 0
		for distance := g.Spacing; distance <= hr+1e-6; distance += step {
			total++
			east, north := distance*math.Sin(bearing), distance*math.Cos(bearing)
			if v, ok := sample(g, east, north, radius); ok {
				valid++
				angle := distance / lunarRadius
				radial := datum + v
				scale := radial * math.Sin(angle) / distance
				horizontal := distance * scale
				up := radial*math.Cos(angle) - (datum + observer)
				elevation := math.Atan2(up, horizontal) * 180 / math.Pi
				if elevation > best {
					best = elevation
					bestRange = distance
				}
			}
		}
		h.Elevations = append(h.Elevations, Round(best, 4))
		h.Coverage = append(h.Coverage, Round(100*float64(valid)/float64(total), 2))
		h.Ranges = append(h.Ranges, Round(bestRange/1000, 4))
	}
	sum := 0.
	for _, v := range h.Coverage {
		sum += v
	}
	h.MeanCoverage = Round(sum/float64(len(h.Coverage)), 2)
	return h, nil
}
