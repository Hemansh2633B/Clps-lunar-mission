// Package frames is the native port of the lunar reference-frame authority
// (formerly backend/lunar_frame.py; twin of src/engine/lunarFrame.ts).
//
// The mission ephemeris uses the IAU 2015 Moon rotation. NASA LOLA polar DEMs and
// JPL Horizons lunar surface sites are MOON_ME. SPICE verification (preserved in
// tests/data/frame-reference.json) shows a constant rotation removes the mean
// bias with a residual <= 0.0039 deg over 2020-2035. Frames are never combined
// silently: anything off the explicit allowlist is unverified and blocked.
package frames

import (
	"math"
	"regexp"
	"strings"
)

// Constant body-fixed -> IAU 2015 rotations (row-major), SPICE DE421-derived.
// Source: tests/data/frame-reference.json (constants), generated with spiceypy.
var (
	METoIAU = [9]float64{0.9999999997098705, 1.9486900868821106e-05, -1.4160507259429924e-05,
		-1.9487136453649353e-05, 0.9999999996717341, -1.6636802573870367e-05,
		1.4160183055056395e-05, 1.6637078516988887e-05, 0.9999999997613488}
	PAToIAU = [9]float64{0.9999998847746482, -0.00030979854483912875, 0.0003667090839859224,
		0.0003098052025635221, 0.9999999518465864, -1.8098664362923326e-05,
		-0.00036670345938775973, 1.821227065930304e-05, 0.9999999325984408}
	Identity = [9]float64{1, 0, 0, 0, 1, 0, 0, 0, 1}
)

const (
	MEMaxResidualDeg  = 0.0038689340382152475
	PAMaxResidualDeg  = 0.003868934226620998
	ValidatedStartUTC = "2020-01-01T00:00:00Z"
	ValidatedEndUTC   = "2035-12-31T23:59:59Z"
	EphemerisFrame    = "IAU 2015 Moon (astronomy-engine RotationAxis)"
)

// Classification is the result of matching a declared frame to the allowlist.
type Classification struct {
	Recognized  bool    `json:"recognized"`
	Transform   *string `json:"transform"`
	Identifier  *string `json:"identifier"`
	Realization *string `json:"realization"`
	Note        string  `json:"note"`
}

var (
	meAllow  = map[string]bool{"MOONME": true, "MOONMEDE421": true, "MOONMEJPLDE421": true, "ME": true, "MEDE421": true}
	paAllow  = map[string]bool{"MOONPA": true, "MOONPADE421": true, "MOONPAJPLDE421": true, "PA": true, "PADE421": true}
	iauAllow = map[string]bool{"IAUMOON": true, "IAU2015MOON": true, "IAUMOON2015": true, "IAU2015": true}
	tailSep  = regexp.MustCompile(`\s*[—;,]\s*|\s+-{1,2}\s+`)
	nonAlnum = regexp.MustCompile(`[^A-Z0-9]`)
)

// Normalize extracts the leading frame identifier (dropping any free-text tail)
// and reduces it to upper-case alphanumerics.
func Normalize(frame string) string {
	if frame == "" {
		return ""
	}
	head := strings.TrimSpace(tailSep.Split(frame, 2)[0])
	return nonAlnum.ReplaceAllString(strings.ToUpper(head), "")
}

func ptr(s string) *string { return &s }

// Classify matches a declared lunar body-fixed frame EXACTLY against the
// allowlist. Unknown frames / realizations are unverified and blocked.
func Classify(frame string) Classification {
	n := Normalize(frame)
	switch {
	case meAllow[n]:
		return Classification{true, ptr("me"), ptr(n), ptr("DE421"), "MOON_ME (DE421). Compatible with the IAU 2015 ephemeris frame after a verified <=0.004 deg correction (validated 2020-2035)."}
	case paAllow[n]:
		return Classification{true, ptr("pa"), ptr(n), ptr("DE421"), "MOON_PA (DE421). Converted to the IAU 2015 ephemeris frame via the fixed 0.0288 deg PA->ME rotation plus a verified <=0.004 deg residual (validated 2020-2035)."}
	case iauAllow[n]:
		return Classification{true, ptr("iau"), ptr(n), ptr("IAU 2015"), "Already an IAU Moon frame; no correction required (verify the report version matches IAU 2015)."}
	}
	shown := frame
	if shown == "" {
		shown = "(unspecified)"
	}
	return Classification{Note: "Unrecognized lunar reference frame '" + shown + "'. Not on the supported-frame allowlist (validated: MOON_ME/MOON_PA with DE421, IAU 2015 Moon); blocked from quantitative mission visibility."}
}

// Rotation returns the source->IAU matrix for a transform name.
func Rotation(transform string) (*[9]float64, bool) {
	switch transform {
	case "me":
		return &METoIAU, true
	case "pa":
		return &PAToIAU, true
	case "iau":
		return &Identity, true
	}
	return nil, false
}

// Converted is a site expressed in the destination frame.
type Converted struct {
	Latitude         float64 `json:"latitude"`
	Longitude        float64 `json:"longitude"`
	AzimuthOffsetDeg float64 `json:"azimuth_offset_deg"`
}

// ConvertSite rotates a body-fixed site (planetocentric lat, east lon) and its
// local north by R. AzimuthOffsetDeg is added to source-frame azimuths to obtain
// destination-frame azimuths measured from local north.
func ConvertSite(latDeg, lonDeg float64, R *[9]float64) Converted {
	lat, lon := latDeg*math.Pi/180, lonDeg*math.Pi/180
	cl, sl, co, so := math.Cos(lat), math.Sin(lat), math.Cos(lon), math.Sin(lon)
	apply := func(v [3]float64) [3]float64 {
		return [3]float64{R[0]*v[0] + R[1]*v[1] + R[2]*v[2], R[3]*v[0] + R[4]*v[1] + R[5]*v[2], R[6]*v[0] + R[7]*v[1] + R[8]*v[2]}
	}
	dot := func(a, b [3]float64) float64 { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] }
	unit := func(a [3]float64) [3]float64 {
		l := math.Sqrt(dot(a, a))
		if l == 0 {
			l = 1
		}
		return [3]float64{a[0] / l, a[1] / l, a[2] / l}
	}
	up2 := unit(apply([3]float64{cl * co, cl * so, sl}))
	north2 := apply([3]float64{-sl * co, -sl * so, cl})
	lat2 := math.Asin(math.Max(-1, math.Min(1, up2[2])))
	lon2 := math.Atan2(up2[1], up2[0])
	d := dot(north2, up2)
	proj := unit([3]float64{north2[0] - up2[0]*d, north2[1] - up2[1]*d, north2[2] - up2[2]*d})
	northDst := [3]float64{-math.Sin(lat2) * math.Cos(lon2), -math.Sin(lat2) * math.Sin(lon2), math.Cos(lat2)}
	eastDst := [3]float64{-math.Sin(lon2), math.Cos(lon2), 0}
	return Converted{lat2 * 180 / math.Pi, lon2 * 180 / math.Pi, math.Atan2(dot(proj, eastDst), dot(proj, northDst)) * 180 / math.Pi}
}

// Transpose returns the inverse of a rotation matrix.
func Transpose(R *[9]float64) *[9]float64 {
	return &[9]float64{R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]}
}
