// Package lunarcrs models the spherical lunar coordinate reference systems
// CHANDRA accepts for elevation rasters and implements their projection maths.
//
// It replaces PROJ/pyproj for the closed set of projections found in lunar DEM
// products (geographic, polar/oblique stereographic, azimuthal equidistant,
// equirectangular). Every formula is the exact spherical form; results are
// regression-tested against PROJ 9.5.1 reference values. Any other projection is
// rejected explicitly — a CRS is never approximated or silently assumed.
package lunarcrs

import (
	"fmt"
	"math"
	"strings"

	"chandra/backend/geotiff"
)

// Kind enumerates supported coordinate systems.
type Kind int

const (
	Geographic Kind = iota
	PolarStereographic
	ObliqueStereographic
	AzimuthalEquidistant
	Equirectangular
)

func (k Kind) String() string {
	return [...]string{"Geographic", "Polar_Stereographic", "Stereographic", "Azimuthal_Equidistant", "Equirectangular"}[k]
}

// CRS is a validated-on-demand description of a raster coordinate system.
type CRS struct {
	Kind              Kind
	Name              string
	SemiMajor         float64
	SemiMinor         float64
	PrimeMeridianDeg  float64
	AngularUnitRad    float64 // size of one geographic raster unit in radians
	LinearUnitM       float64 // size of one projected raster unit in metres
	Lat0, Lon0        float64 // degrees: projection centre / origin
	LatTS             float64 // degrees: standard parallel (eqc) or true-scale latitude (polar stere)
	K0                float64 // scale factor at the natural origin
	FalseE, FalseN    float64
	AuthorityCode     int // EPSG/ESRI code when the file relies on one
	EllipsoidExplicit bool
}

// ErrNoCRS is returned when a raster carries no georeferencing keys at all.
var ErrNoCRS = fmt.Errorf("raster has no coordinate reference system")

// UnsupportedError explains why a CRS cannot be used.
type UnsupportedError struct{ Reason string }

func (e *UnsupportedError) Error() string { return e.Reason }

const (
	keyModelType      = 1024
	keyGTCitation     = 1026
	keyGeographicType = 2048
	keyGeogCitation   = 2049
	keyGeogAngUnits   = 2054
	keyGeogAngSize    = 2055
	keyGeogEllipsoid  = 2056
	keySemiMajor      = 2057
	keySemiMinor      = 2058
	keyInvFlattening  = 2059
	keyPrimeMeridian  = 2061
	keyProjectedCS    = 3072
	keyPCSCitation    = 3073
	keyProjection     = 3074
	keyCoordTrans     = 3075
	keyLinearUnits    = 3076
	keyLinearUnitSize = 3077
	keyStdParallel1   = 3078
	keyNatOriginLong  = 3080
	keyNatOriginLat   = 3081
	keyFalseEasting   = 3082
	keyFalseNorthing  = 3083
	keyCenterLong     = 3088
	keyCenterLat      = 3089
	keyScaleAtOrigin  = 3092
	keyStraightPole   = 3095
)

// Known authority-coded geographic systems (code -> semi-major, semi-minor).
// Only codes whose body is unambiguous are listed; everything else must carry
// explicit ellipsoid keys.
var knownGeographic = map[int][2]float64{
	4326:   {6378137.0, 6356752.314245179}, // WGS 84 (Earth) — recognised so it can be rejected by radius
	4269:   {6378137.0, 6356752.314140356}, // NAD83 (Earth)
	104903: {1737400.0, 1737400.0},         // ESRI GCS_Moon_2000
	30100:  {1737400.0, 1737400.0},         // IAU 2015 Moon (sphere)
}

// FromGeoTIFF derives the CRS from GeoTIFF keys.
func FromGeoTIFF(f *geotiff.File) (*CRS, error) {
	k := f.GeoKeys
	model, hasModel := k[keyModelType]
	if !f.HasGeoKeys || !hasModel || (model.Short != 1 && model.Short != 2) {
		return nil, ErrNoCRS
	}
	dbl := func(id int, def float64) float64 {
		if v, ok := k[id]; ok && v.Kind == 'd' && len(v.Double) > 0 {
			return v.Double[0]
		}
		return def
	}
	has := func(id int) bool { _, ok := k[id]; return ok }
	c := &CRS{K0: 1, AngularUnitRad: math.Pi / 180, LinearUnitM: 1, Name: "unknown"}
	// --- ellipsoid ---------------------------------------------------------
	if has(keySemiMajor) {
		c.SemiMajor, c.EllipsoidExplicit = dbl(keySemiMajor, 0), true
		switch {
		case has(keySemiMinor):
			c.SemiMinor = dbl(keySemiMinor, 0)
		case has(keyInvFlattening) && dbl(keyInvFlattening, 0) != 0:
			c.SemiMinor = c.SemiMajor * (1 - 1/dbl(keyInvFlattening, 0))
		default:
			c.SemiMinor = c.SemiMajor
		}
	} else {
		code := k[keyGeographicType].Short
		axes, ok := knownGeographic[code]
		if !ok {
			if pcs := k[keyProjectedCS].Short; pcs != 0 && pcs != 32767 {
				return nil, &UnsupportedError{fmt.Sprintf("DEM CRS is defined only by authority code EPSG:%d without explicit lunar sphere parameters; such a CRS cannot be verified as lunar", pcs)}
			}
			return nil, &UnsupportedError{fmt.Sprintf("DEM CRS does not state its ellipsoid (geographic code %d); a lunar sphere radius is required", code)}
		}
		c.SemiMajor, c.SemiMinor, c.AuthorityCode = axes[0], axes[1], code
	}
	c.PrimeMeridianDeg = dbl(keyPrimeMeridian, 0)
	if u, ok := k[keyGeogAngUnits]; ok {
		switch u.Short {
		case 9102, 9122: // degree
		case 9101:
			c.AngularUnitRad = 1
		case 9105:
			c.AngularUnitRad = math.Pi / 200
		case 32767:
			c.AngularUnitRad = dbl(keyGeogAngSize, math.Pi/180)
		default:
			return nil, &UnsupportedError{fmt.Sprintf("unsupported angular unit code %d in the DEM CRS", u.Short)}
		}
	}
	for _, id := range []int{keyPCSCitation, keyGTCitation, keyGeogCitation} {
		if v, ok := k[id]; ok && v.Kind == 'a' {
			if name := citationName(v.ASCII); name != "" {
				c.Name = name
				break
			}
		}
	}
	if model.Short == 2 {
		c.Kind = Geographic
		return c, nil
	}
	// --- projection --------------------------------------------------------
	if u, ok := k[keyLinearUnits]; ok {
		switch u.Short {
		case 9001:
		case 9036:
			c.LinearUnitM = 1000
		case 32767:
			c.LinearUnitM = dbl(keyLinearUnitSize, 1)
		default:
			return nil, &UnsupportedError{fmt.Sprintf("unsupported linear unit code %d in the DEM CRS (metres required)", u.Short)}
		}
	}
	if !(c.LinearUnitM > 0) || math.IsInf(c.LinearUnitM, 0) {
		return nil, &UnsupportedError{"invalid linear unit size in the DEM CRS"}
	}
	c.FalseE, c.FalseN = dbl(keyFalseEasting, 0), dbl(keyFalseNorthing, 0)
	c.K0 = dbl(keyScaleAtOrigin, 1)
	ct, ok := k[keyCoordTrans]
	if !ok {
		if pcs := k[keyProjectedCS].Short; pcs != 0 && pcs != 32767 {
			return nil, &UnsupportedError{fmt.Sprintf("DEM CRS is defined only by authority code EPSG:%d without explicit projection parameters; such a CRS cannot be verified as lunar", pcs)}
		}
		return nil, &UnsupportedError{"DEM CRS does not define its map projection"}
	}
	switch ct.Short {
	case 15: // CT_PolarStereographic
		c.Kind = PolarStereographic
		c.LatTS = dbl(keyNatOriginLat, -90)
		c.Lon0 = dbl(keyStraightPole, dbl(keyNatOriginLong, 0))
		if c.LatTS == 0 {
			return nil, &UnsupportedError{"polar stereographic CRS has no pole (latitude of origin is 0)"}
		}
		c.Lat0 = math.Copysign(90, c.LatTS)
	case 14, 16: // CT_Stereographic / CT_ObliqueStereographic (identical on a sphere)
		c.Lat0 = dbl(keyCenterLat, dbl(keyNatOriginLat, 0))
		c.Lon0 = dbl(keyCenterLong, dbl(keyNatOriginLong, 0))
		if math.Abs(math.Abs(c.Lat0)-90) < 1e-12 {
			c.Kind, c.LatTS = PolarStereographic, c.Lat0
		} else {
			c.Kind = ObliqueStereographic
		}
	case 12: // CT_AzimuthalEquidistant
		c.Kind = AzimuthalEquidistant
		c.Lat0, c.Lon0 = dbl(keyCenterLat, dbl(keyNatOriginLat, 0)), dbl(keyCenterLong, dbl(keyNatOriginLong, 0))
	case 17: // CT_Equirectangular
		c.Kind = Equirectangular
		c.Lat0, c.Lon0 = dbl(keyCenterLat, dbl(keyNatOriginLat, 0)), dbl(keyCenterLong, dbl(keyNatOriginLong, 0))
		c.LatTS = dbl(keyStdParallel1, 0)
	default:
		return nil, &UnsupportedError{fmt.Sprintf("unsupported DEM map projection (GeoTIFF coordinate transformation code %d). Supported: geographic, polar stereographic, stereographic, azimuthal equidistant, equirectangular. Reproject the DEM (for example with gdalwarp) first", ct.Short)}
	}
	return c, nil
}

func citationName(s string) string {
	s = strings.TrimSpace(s)
	for _, prefix := range []string{"PCS Name = ", "GCS Name = "} {
		if strings.HasPrefix(s, prefix) {
			s = strings.SplitN(s[len(prefix):], "|", 2)[0]
		}
	}
	if i := strings.Index(s, "|"); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}

// IsGeographic reports whether raster coordinates are longitude/latitude.
func (c *CRS) IsGeographic() bool { return c.Kind == Geographic }

// UnitName mirrors the axis unit name reported by the former PROJ-based backend.
func (c *CRS) UnitName() string {
	if c.Kind == Geographic {
		return "degree"
	}
	return "metre"
}

func rad(d float64) float64 { return d * math.Pi / 180 }
func deg(r float64) float64 { return r * 180 / math.Pi }

// Wrap180 normalises a longitude to [-180, 180).
func Wrap180(lon float64) float64 {
	w := math.Mod(lon+180, 360)
	if w < 0 {
		w += 360
	}
	return w - 180
}

func (c *CRS) polarScale() float64 {
	// Variant B: true scale at LatTS -> equivalent scale factor at the pole.
	return c.K0 * (1 + math.Sin(rad(math.Abs(c.LatTS)))) / 2
}

// Forward projects planetocentric lon/lat (degrees, east-positive) to raster
// coordinates. For geographic rasters it returns degrees unchanged.
func (c *CRS) Forward(lon, lat float64) (x, y float64, ok bool) {
	R := c.SemiMajor
	phi := rad(lat)
	dl := rad(Wrap180(lon - c.Lon0))
	switch c.Kind {
	case Geographic:
		return lon / deg(c.AngularUnitRad), lat / deg(c.AngularUnitRad), true
	case PolarStereographic:
		k := c.polarScale()
		if c.Lat0 > 0 {
			rho := 2 * R * k * math.Tan(math.Pi/4-phi/2)
			x, y = rho*math.Sin(dl), -rho*math.Cos(dl)
		} else {
			rho := 2 * R * k * math.Tan(math.Pi/4+phi/2)
			x, y = rho*math.Sin(dl), rho*math.Cos(dl)
		}
	case ObliqueStereographic:
		p1 := rad(c.Lat0)
		den := 1 + math.Sin(p1)*math.Sin(phi) + math.Cos(p1)*math.Cos(phi)*math.Cos(dl)
		if den < 1e-12 {
			return 0, 0, false
		}
		k := 2 * c.K0 / den
		x = R * k * math.Cos(phi) * math.Sin(dl)
		y = R * k * (math.Cos(p1)*math.Sin(phi) - math.Sin(p1)*math.Cos(phi)*math.Cos(dl))
	case AzimuthalEquidistant:
		p1 := rad(c.Lat0)
		sp1, cp1 := math.Sincos(p1)
		if math.Abs(math.Abs(c.Lat0)-90) < 1e-12 { // exact polar form
			cp1, sp1 = 0, math.Copysign(1, c.Lat0)
		}
		a := math.Cos(phi) * math.Sin(dl)
		b := cp1*math.Sin(phi) - sp1*math.Cos(phi)*math.Cos(dl)
		cosc := sp1*math.Sin(phi) + cp1*math.Cos(phi)*math.Cos(dl)
		sinc := math.Hypot(a, b)
		cc := math.Atan2(sinc, cosc)
		kp := 1.0
		if sinc > 1e-15 {
			kp = cc / sinc
		} else if cosc < 0 {
			return 0, 0, false // antipode
		}
		x, y = R*kp*a, R*kp*b
	case Equirectangular:
		x = R * dl * math.Cos(rad(c.LatTS))
		y = R * (phi - rad(c.Lat0))
	}
	x = (x + c.FalseE*c.LinearUnitM) / c.LinearUnitM
	y = (y + c.FalseN*c.LinearUnitM) / c.LinearUnitM
	return x, y, !math.IsNaN(x) && !math.IsNaN(y) && !math.IsInf(x, 0) && !math.IsInf(y, 0)
}

// Inverse converts raster coordinates to lon/lat degrees (lon in [-180,180)).
func (c *CRS) Inverse(x, y float64) (lon, lat float64, ok bool) {
	R := c.SemiMajor
	if c.Kind == Geographic {
		return x * deg(c.AngularUnitRad), y * deg(c.AngularUnitRad), true
	}
	x = (x - c.FalseE) * c.LinearUnitM
	y = (y - c.FalseN) * c.LinearUnitM
	var phi, dl float64
	switch c.Kind {
	case PolarStereographic:
		rho := math.Hypot(x, y)
		cc := 2 * math.Atan(rho/(2*R*c.polarScale()))
		if c.Lat0 > 0 {
			phi = math.Pi/2 - cc
			dl = math.Atan2(x, -y)
		} else {
			phi = cc - math.Pi/2
			dl = math.Atan2(x, y)
		}
		if rho == 0 {
			dl = 0
		}
	case ObliqueStereographic, AzimuthalEquidistant:
		p1 := rad(c.Lat0)
		sp1, cp1 := math.Sincos(p1)
		if math.Abs(math.Abs(c.Lat0)-90) < 1e-12 {
			cp1, sp1 = 0, math.Copysign(1, c.Lat0)
		}
		rho := math.Hypot(x, y)
		var cc float64
		if c.Kind == AzimuthalEquidistant {
			cc = rho / R
			if cc > math.Pi {
				return 0, 0, false
			}
		} else {
			cc = 2 * math.Atan(rho/(2*R*c.K0))
		}
		if rho == 0 {
			phi, dl = p1, 0
		} else {
			// atan2 form: well-conditioned at the poles, where asin loses digits.
			sc, ccos := math.Sincos(cc)
			a := x / rho * sc
			b := cp1*ccos - y/rho*sc*sp1
			phi = math.Atan2(ccos*sp1+y/rho*sc*cp1, math.Hypot(a, b))
			dl = math.Atan2(a, b)
		}
	case Equirectangular:
		cts := math.Cos(rad(c.LatTS))
		if cts < 1e-12 {
			return 0, 0, false
		}
		dl = x / (R * cts)
		phi = rad(c.Lat0) + y/R
		if math.Abs(phi) > math.Pi/2+1e-12 {
			return 0, 0, false
		}
	}
	lon, lat = Wrap180(c.Lon0+deg(dl)), deg(phi)
	return lon, lat, !math.IsNaN(lon) && !math.IsNaN(lat)
}

// MeridionalScale is the map scale factor along the meridian at a point: the
// ratio of raster distance to ground distance. It sizes the anti-aliasing
// kernel when a grid is coarser than the source raster.
func (c *CRS) MeridionalScale(lon, lat float64) float64 {
	phi := rad(lat)
	switch c.Kind {
	case PolarStereographic:
		return 2 * c.polarScale() / (1 + math.Sin(math.Abs(phi)))
	case ObliqueStereographic:
		p1 := rad(c.Lat0)
		return 2 * c.K0 / (1 + math.Sin(p1)*math.Sin(phi) + math.Cos(p1)*math.Cos(phi)*math.Cos(rad(Wrap180(lon-c.Lon0))))
	}
	return 1
}

// WKT renders an OGC WKT1 description of the CRS.
func (c *CRS) WKT() string {
	invf := 0.0
	if c.SemiMajor != c.SemiMinor && c.SemiMajor > 0 {
		invf = c.SemiMajor / (c.SemiMajor - c.SemiMinor)
	}
	geog := fmt.Sprintf(`GEOGCS["%s",DATUM["unknown",SPHEROID["unknown",%s,%s]],PRIMEM["Reference_Meridian",%s],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]]]`,
		geogName(c), num(c.SemiMajor), num(invf), num(c.PrimeMeridianDeg))
	if c.Kind == Geographic {
		return geog
	}
	var p strings.Builder
	param := func(name string, v float64) { fmt.Fprintf(&p, `,PARAMETER["%s",%s]`, name, num(v)) }
	switch c.Kind {
	case PolarStereographic:
		param("latitude_of_origin", c.LatTS)
		param("central_meridian", c.Lon0)
		param("scale_factor", c.K0)
	case ObliqueStereographic:
		param("latitude_of_origin", c.Lat0)
		param("central_meridian", c.Lon0)
		param("scale_factor", c.K0)
	case AzimuthalEquidistant:
		param("latitude_of_center", c.Lat0)
		param("longitude_of_center", c.Lon0)
	case Equirectangular:
		param("standard_parallel_1", c.LatTS)
		param("central_meridian", c.Lon0)
		if c.Lat0 != 0 {
			param("latitude_of_origin", c.Lat0)
		}
	}
	param("false_easting", c.FalseE)
	param("false_northing", c.FalseN)
	return fmt.Sprintf(`PROJCS["%s",%s,PROJECTION["%s"]%s,UNIT["metre",%s],AXIS["Easting",EAST],AXIS["Northing",NORTH]]`, c.Name, geog, c.Kind, p.String(), num(c.LinearUnitM))
}

func geogName(c *CRS) string {
	if c.Kind == Geographic {
		return c.Name
	}
	return "unknown"
}

func num(v float64) string { return strings.TrimSuffix(fmt.Sprintf("%.15g", v), ".0") }

// GeoKeys serialises the CRS as user-defined GeoTIFF keys (the same key layout
// GDAL writes for lunar spheres), for rasters produced by CHANDRA itself.
func (c *CRS) GeoKeys() map[int]geotiff.GeoKey {
	k := map[int]geotiff.GeoKey{}
	short := func(id, v int) { k[id] = geotiff.GeoKey{ID: id, Kind: 's', Short: v} }
	dbl := func(id int, v float64) { k[id] = geotiff.GeoKey{ID: id, Kind: 'd', Double: []float64{v}} }
	txt := func(id int, v string) { k[id] = geotiff.GeoKey{ID: id, Kind: 'a', ASCII: v} }
	short(1025, 1) // RasterPixelIsArea
	short(keyGeographicType, 32767)
	txt(keyGeogCitation, "GCS Name = "+geogName(c)+"|Datum = unknown|Ellipsoid = unknown|Primem = Reference_Meridian|")
	short(keyGeogAngUnits, 9102)
	short(keyGeogEllipsoid, 32767)
	dbl(keySemiMajor, c.SemiMajor)
	dbl(keySemiMinor, c.SemiMinor)
	if c.PrimeMeridianDeg != 0 {
		dbl(keyPrimeMeridian, c.PrimeMeridianDeg)
	}
	if c.Kind == Geographic {
		short(keyModelType, 2)
		return k
	}
	short(keyModelType, 1)
	short(keyProjectedCS, 32767)
	txt(keyPCSCitation, c.Name)
	short(keyProjection, 32767)
	short(keyLinearUnits, 9001)
	dbl(keyFalseEasting, c.FalseE)
	dbl(keyFalseNorthing, c.FalseN)
	switch c.Kind {
	case PolarStereographic:
		short(keyCoordTrans, 15)
		dbl(keyNatOriginLat, c.LatTS)
		dbl(keyStraightPole, c.Lon0)
		dbl(keyScaleAtOrigin, c.K0)
	case ObliqueStereographic:
		short(keyCoordTrans, 16)
		dbl(keyNatOriginLat, c.Lat0)
		dbl(keyNatOriginLong, c.Lon0)
		dbl(keyScaleAtOrigin, c.K0)
	case AzimuthalEquidistant:
		short(keyCoordTrans, 12)
		dbl(keyCenterLat, c.Lat0)
		dbl(keyCenterLong, c.Lon0)
	case Equirectangular:
		short(keyCoordTrans, 17)
		dbl(keyCenterLat, c.Lat0)
		dbl(keyCenterLong, c.Lon0)
		dbl(keyStdParallel1, c.LatTS)
	}
	return k
}

// Sphere returns a spherical lunar CRS of the given kind and parameters.
func Sphere(kind Kind, radius, lat0, lon0, latTS float64) *CRS {
	return &CRS{Kind: kind, Name: "unknown", SemiMajor: radius, SemiMinor: radius, AngularUnitRad: math.Pi / 180, LinearUnitM: 1, Lat0: lat0, Lon0: lon0, LatTS: latTS, K0: 1}
}
