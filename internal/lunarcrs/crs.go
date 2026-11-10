// Package lunarcrs handles only the spherical, zero-meridian lunar CRSs
// supported by CHANDRA. It is deliberately not a general WKT/PROJ parser.
package lunarcrs

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"
)

type CRS struct {
	Projection                                        string
	Radius, Lat0, Lon0, East0, North0, Unit, Meridian float64
	WKT                                               string
}

type node struct {
	name, text string
	children   []node
}

func parseWKT(s string) (node, error) {
	if len(s) > 65536 {
		return node{}, fmt.Errorf("WKT exceeds 64 KiB")
	}
	pos := 0
	ident := func() string {
		start := pos
		for pos < len(s) && (s[pos] == '_' || (s[pos] >= 'A' && s[pos] <= 'Z') || (s[pos] >= 'a' && s[pos] <= 'z')) {
			pos++
		}
		return strings.ToUpper(s[start:pos])
	}
	var read func(int) (node, error)
	read = func(depth int) (node, error) {
		if depth > 32 {
			return node{}, fmt.Errorf("WKT nesting too deep")
		}
		n := node{name: ident(), text: s}
		if n.name == "" || pos >= len(s) || s[pos] != '[' {
			return n, fmt.Errorf("invalid WKT node")
		}
		pos++
		start := pos
		quoted := false
		for pos < len(s) {
			c := s[pos]
			if c == '"' {
				pos++
				if quoted && pos < len(s) && s[pos] == '"' {
					pos++
					continue
				}
				quoted = !quoted
			} else if !quoted {
				if c == '[' {
					child, err := read(depth + 1)
					if err != nil {
						return n, err
					}
					n.children = append(n.children, child)
					continue
				}
				if c == ']' {
					n.text = s[start:pos]
					pos++
					return n, nil
				}
			}
			pos++
		}
		return n, fmt.Errorf("unclosed WKT")
	}
	n, err := read(0)
	if err != nil {
		return n, err
	}
	for pos < len(s) {
		if !unicode.IsSpace(rune(s[pos])) {
			return n, fmt.Errorf("trailing WKT")
		}
		pos++
	}
	return n, nil
}
func (n node) child(name string) *node {
	for i := range n.children {
		if n.children[i].name == name {
			return &n.children[i]
		}
	}
	return nil
}
func (n node) fields() []string {
	var f []string
	start := 0
	quoted := false
	for i := 0; i < len(n.text); i++ {
		if n.text[i] == '"' {
			if quoted && i+1 < len(n.text) && n.text[i+1] == '"' {
				i++
				continue
			}
			quoted = !quoted
		}
		if n.text[i] == ',' && !quoted {
			f = append(f, strings.TrimSpace(n.text[start:i]))
			start = i + 1
		}
	}
	return append(f, strings.TrimSpace(n.text[start:]))
}
func (n node) number(i int) (float64, error) {
	f := n.fields()
	if i >= len(f) {
		return 0, fmt.Errorf("missing %s value", n.name)
	}
	return strconv.ParseFloat(f[i], 64)
}
func (n node) quoted(i int) (string, error) {
	f := n.fields()
	if i >= len(f) || len(f[i]) < 2 || f[i][0] != '"' || f[i][len(f[i])-1] != '"' {
		return "", fmt.Errorf("missing %s name", n.name)
	}
	return strings.ReplaceAll(f[i][1:len(f[i])-1], `""`, `"`), nil
}
func ParseWKT(s string) (*CRS, error) {
	n, err := parseWKT(s)
	if err != nil {
		return nil, err
	}
	c := &CRS{Projection: "longlat", Unit: 1, WKT: s}
	geo := &n
	switch n.name {
	case "PROJCRS", "PROJECTEDCRS":
		p := n.child("CONVERSION")
		if p == nil {
			return nil, fmt.Errorf("projected CRS needs CONVERSION")
		}
		geo = n.child("BASEGEOGCRS")
		if geo == nil {
			geo = n.child("GEOGCRS")
		}
		if geo == nil {
			return nil, fmt.Errorf("missing base geographic CRS")
		}
		method := p.child("METHOD")
		if method == nil {
			return nil, fmt.Errorf("missing projection method")
		}
		name, _ := method.quoted(0)
		name = strings.ToLower(strings.ReplaceAll(name, " ", "_"))
		if name == "azimuthal_equidistant" {
			c.Projection = "aeqd"
		} else {
			return nil, fmt.Errorf("unsupported lunar projection %q", name)
		}
		for _, p := range p.children {
			if p.name != "PARAMETER" {
				continue
			}
			name, _ := p.quoted(0)
			v, err := p.number(1)
			if err != nil {
				return nil, err
			}
			switch strings.ToLower(name) {
			case "latitude_of_center", "latitude_of_origin":
				c.Lat0 = v
			case "longitude_of_center", "central_meridian":
				c.Lon0 = v
			case "false_easting":
				c.East0 = v
			case "false_northing":
				c.North0 = v
			default:
				return nil, fmt.Errorf("unsupported projection parameter %q", name)
			}
		}
		if u := n.child("LENGTHUNIT"); u != nil {
			c.Unit, err = u.number(1)
			if err != nil {
				return nil, err
			}
		}
	case "GEOGCRS", "GEODGEOGCRS", "GEOGRAPHICCRS":
	default:
		return nil, fmt.Errorf("unsupported CRS %s", n.name)
	}
	datum := geo.child("DATUM")
	if datum == nil {
		datum = geo.child("GEODETICDATUM")
	}
	if datum == nil {
		return nil, fmt.Errorf("missing geodetic datum")
	}
	e := datum.child("SPHEROID")
	if e == nil {
		e = datum.child("ELLIPSOID")
	}
	if e == nil {
		return nil, fmt.Errorf("missing ellipsoid")
	}
	a, err := e.number(1)
	if err != nil {
		return nil, err
	}
	inv, err := e.number(2)
	if err != nil {
		return nil, err
	}
	b := a
	if inv != 0 {
		b = a * (1 - 1/inv)
	}
	c.Radius = a
	if a < 1700000 || a > 1800000 {
		return nil, fmt.Errorf("unexpected lunar radius %.1f m", a)
	}
	if math.Abs(a-b) > 0.01 {
		return nil, fmt.Errorf("only spherical lunar CRSs are supported")
	}
	if pm := geo.child("PRIMEM"); pm != nil {
		c.Meridian, err = pm.number(1)
		if err != nil {
			return nil, err
		}
		if math.Abs(c.Meridian) > 1e-10 {
			return nil, fmt.Errorf("a zero lunar reference meridian is required")
		}
	}
	units := 0
	for _, u := range geo.children {
		if u.name == "ANGLEUNIT" {
			units++
			c.Unit, err = u.number(1)
			if err != nil {
				return nil, err
			}
			if c.Projection != "longlat" && math.Abs(c.Unit-math.Pi/180) > 1e-12 {
				return nil, fmt.Errorf("geographic coordinates must use degrees")
			}
		}
	}
	if c.Projection == "longlat" && (units != 1 || math.Abs(c.Unit-math.Pi/180) > 1e-12) {
		return nil, fmt.Errorf("geographic coordinates must use degrees")
	}
	if c.Projection == "aeqd" && (math.Abs(c.Lat0) > 90 || math.Abs(c.Lon0) > 360 || c.Unit <= 0) {
		return nil, fmt.Errorf("invalid lunar projection parameters")
	}
	for _, v := range []float64{c.Radius, c.Lat0, c.Lon0, c.East0, c.North0, c.Unit, c.Meridian} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return nil, fmt.Errorf("non-finite CRS parameter")
		}
	}
	return c, nil
}

// Forward uses the spherical PROJ AEQD equations. go-spatial/proj v0.3.0
// ships its entire AEQd implementation commented out; do not pretend it supports it.
// Input/output is longitude/latitude in degrees, always XY, not latitude/longitude.
// Forward uses the spherical PROJ AEQD equations (operation order preserved
// for float32 warp parity). Input/output is longitude/latitude in degrees, XY.
func (c *CRS) Forward(lon, lat float64) (float64, float64, error) {
	if c.Projection == "longlat" {
		return lon, lat, nil
	}
	if c.Projection != "aeqd" || c.Radius < 1700000 || c.Radius > 1800000 || math.Abs(c.Lat0) > 90 {
		return 0, 0, fmt.Errorf("unsupported lunar projection")
	}
	phi := lat * math.Pi / 180
	lam := (lon - c.Lon0) * math.Pi / 180
	sp, cp := math.Sincos(phi)
	sl, cl := math.Sincos(lam)
	var x, y float64
	switch {
	case math.Abs(c.Lat0+90) < 1e-10: // south pole
		d := math.Pi/2 + phi
		x = c.Radius * d * sl
		y = c.Radius * d * cl
	case math.Abs(c.Lat0-90) < 1e-10: // north pole
		d := math.Pi/2 - phi
		x = c.Radius * d * sl
		y = -c.Radius * d * cl
	default:
		phi0 := c.Lat0 * math.Pi / 180
		s0, c0 := math.Sincos(phi0)
		var cosc float64
		if math.Abs(c.Lat0) < 1e-10 {
			cosc = cp * cl
		} else {
			cosc = s0*sp + c0*(cp*cl)
		}
		if math.Abs(math.Abs(cosc)-1) < 1e-14 {
			if cosc < 0 {
				return 0, 0, fmt.Errorf("AEQD antipodal point")
			}
			x, y = 0, 0
		} else {
			d := math.Acos(math.Max(-1, math.Min(1, cosc)))
			k := d / math.Sin(d)
			x = c.Radius * k * cp * sl
			if math.Abs(c.Lat0) < 1e-10 {
				y = c.Radius * k * sp
			} else {
				y = c.Radius * k * (c0*sp - s0*(cp*cl))
			}
		}
	}
	return (x + c.East0) * c.Unit, (y + c.North0) * c.Unit, nil
}

// Inverse uses the spherical PROJ AEQD equations, preserving PROJ's operation
// order so downstream float32 rounding matches the Python/GDAL reference.
func (c *CRS) Inverse(x, y float64) (float64, float64, error) {
	if c.Projection == "longlat" {
		return x, y, nil
	}
	xn := (x - c.East0) / (c.Radius * c.Unit)
	yn := (y - c.North0) / (c.Radius * c.Unit)
	rho := math.Hypot(xn, yn)
	var phi, lam float64
	switch {
	case rho < 1e-10:
		phi = c.Lat0 * math.Pi / 180
		lam = 0
	case rho > math.Pi+1e-10:
		return 0, 0, fmt.Errorf("AEQD point outside sphere")
	case math.Abs(c.Lat0+90) < 1e-10:
		phi = rho - math.Pi/2
		lam = math.Atan2(xn, yn)
	case math.Abs(c.Lat0-90) < 1e-10:
		phi = math.Pi/2 - rho
		lam = math.Atan2(xn, -yn)
	default:
		if rho > math.Pi {
			rho = math.Pi
		}
		sinc, cosc := math.Sincos(rho)
		phi0 := c.Lat0 * math.Pi / 180
		s0, c0 := math.Sincos(phi0)
		if math.Abs(c.Lat0) < 1e-10 {
			phi = asin(yn * sinc / rho)
			xx := xn * sinc
			yy := cosc * rho
			if yy == 0 {
				lam = 0
			} else {
				lam = math.Atan2(xx, yy)
			}
		} else {
			phi = asin(cosc*s0 + yn*sinc*c0/rho)
			yy := (cosc - s0*math.Sin(phi)) * rho
			xx := xn * sinc * c0
			if yy == 0 {
				lam = 0
			} else {
				lam = math.Atan2(xx, yy)
			}
		}
	}
	lon := math.Mod(lam*(180/math.Pi)+c.Lon0+180, 360)
	if lon < 0 {
		lon += 360
	}
	lon -= 180
	return lon, phi * (180 / math.Pi), nil
}

// asin is PROJ's spherical aasin evaluation. The half-angle identity avoids
// the catastrophic cancellation of a direct asin near the poles and matches
// the reference libm result without relaxing any coordinate tolerance.
func asin(x float64) float64 {
	if math.IsNaN(x) || x < -1 || x > 1 {
		return math.NaN()
	}
	if math.Abs(x) > .5 {
		return math.Atan2(x, math.Sqrt((1-x)*(1+x)))
	}
	return math.Asin(x)
}

// Equivalent reports semantic identity for the supported CRS subset.
func Equivalent(a, b *CRS) bool {
	return a != nil && b != nil && a.Projection == b.Projection &&
		a.Radius == b.Radius && a.Lat0 == b.Lat0 && a.Lon0 == b.Lon0 &&
		a.East0 == b.East0 && a.North0 == b.North0 && a.Unit == b.Unit && a.Meridian == b.Meridian
}

func Local(lat, lon, radius float64) *CRS {
	return &CRS{Projection: "aeqd", Radius: radius, Lat0: lat, Lon0: lon, Unit: 1}
}

// FromGeoKeys interprets the OGC GeoTIFF 1.1 numeric keys. GDAL can serialize
// a user-defined lunar CRS without WKT; the keys remain authoritative. This
// supports only the explicitly documented sphere/AEQD subset, never Earth defaults.
func FromGeoKeys(keys [][4]uint16, doubles []float64, ascii string) (*CRS, error) {
	c := &CRS{Projection: "longlat", Unit: 1}
	values := map[uint16]float64{}
	citation := ""
	for _, k := range keys {
		switch k[1] {
		case 0:
			values[k[0]] = float64(k[3])
		case 34736:
			if int(k[3]) >= len(doubles) {
				return nil, fmt.Errorf("GeoKey double offset out of bounds")
			}
			values[k[0]] = doubles[k[3]]
		case 34737:
			if k[0] == 1026 || k[0] == 2049 {
				end := int(k[3]) + int(k[2])
				if end > len(ascii) {
					return nil, fmt.Errorf("GeoKey citation out of bounds")
				}
				citation = strings.TrimRight(ascii[k[3]:end], "\x00| ")
			}
		default:
			return nil, fmt.Errorf("unsupported GeoKey storage %d", k[1])
		}
	}
	if strings.Contains(citation, "[") {
		p, err := ParseWKT(citation)
		if err == nil {
			return p, nil
		}
	}
	radius, ok := values[2057]
	if !ok {
		return nil, fmt.Errorf("GeoKeys lack explicit lunar semi-major radius")
	}
	if minor, hasMinor := values[2058]; hasMinor && math.Abs(minor-radius) > 0.01 {
		return nil, fmt.Errorf("only spherical lunar CRSs are supported")
	}
	c.Radius = radius
	if radius < 1700000 || radius > 1800000 {
		return nil, fmt.Errorf("unexpected lunar radius %.1f m", radius)
	}
	if v, ok := values[2061]; ok && math.Abs(v) > 1e-10 {
		return nil, fmt.Errorf("a zero lunar reference meridian is required")
	}
	model := values[3072]
	if model == 0 {
		// Geographic TIFFs may omit ProjectedCSTypeGeoKey entirely.
		if values[1024] != 2 || values[3075] != 0 {
			return nil, fmt.Errorf("missing or unsupported CRS model type")
		}
		model = 1
	} else if model == 32767 {
		if values[1024] != 1 || values[3075] != 12 {
			return nil, fmt.Errorf("missing or unsupported projected CRS type")
		}
		model = 2
	}
	switch model {
	case 1:
		if values[2054] != 9102 {
			return nil, fmt.Errorf("geographic GeoKeys must use degrees")
		}
		c.Unit = math.Pi / 180
	case 2:
		c.Projection = "aeqd"
		c.Unit = 1
		if v, ok := values[3076]; ok && v != 9001 {
			return nil, fmt.Errorf("projected GeoKeys must use metres")
		}
		// GeoTIFF 1.1: 3082/3083 false easting/northing;
		// 3088/3089 projected natural-origin latitude/longitude.
		c.Lat0, c.Lon0 = values[3089], values[3088]
		c.East0, c.North0 = values[3082], values[3083]
	default:
		return nil, fmt.Errorf("unsupported GeoTIFF model type")
	}
	if citation != "" {
		c.WKT = citation
	} else {
		c.WKT = fmt.Sprintf("GeoKeys: sphere R=%.17g, projection=%s, lat_0=%.17g lon_0=%.17g", radius, c.Projection, c.Lat0, c.Lon0)
	}
	return c, nil
}
