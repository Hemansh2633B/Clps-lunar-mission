// Package horizons is CHANDRA's client for the NASA/JPL Horizons API, used as an
// INDEPENDENT verification source for Sun/Earth geometry at a lunar surface
// site. It never replaces the application's own ephemeris engine.
//
// Conventions fixed by this client (and re-validated on every response):
//   - observer: CENTER='coord@301' (Moon body centre 301), COORD_TYPE='GEODETIC',
//     SITE_COORD = east longitude (deg), latitude (deg), altitude (km) above the
//     1737.4 km reference sphere, expressed in Horizons' lunar body-fixed frame
//     MEAN_ME (the Mean-Earth/polar-axis frame). On a sphere geodetic latitude is
//     planetocentric latitude;
//   - targets: Sun (10) and Earth (399), body centres;
//   - quantities: 4 (airless apparent azimuth/elevation: light-time, stellar
//     aberration and gravitational deflection), 20 (apparent range and
//     range-rate), 30 (TDB-UT);
//   - time scale: UT (UTC after 1962), requested on a whole-minute grid.
//
// Horizons geometry contains no terrain: it can verify ephemeris geometry only,
// never the DEM obstruction model.
package horizons

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// OfficialBaseURL is the documented API endpoint.
	OfficialBaseURL = "https://ssd.jpl.nasa.gov/api/horizons.api"
	DocsURL         = "https://ssd-api.jpl.nasa.gov/doc/horizons.html"
	MaxSamples      = 400
	maxResponse     = 2 << 20
	MoonRadiusKm    = 1737.4
)

// Targets maps a CHANDRA target name to its validated Horizons body id.
var Targets = map[string]struct{ ID, Name string }{
	"sun":   {"10", "Sun"},
	"earth": {"399", "Earth"},
}

// InputError is a client-side validation failure (HTTP 400).
type InputError struct{ Message string }

func (e *InputError) Error() string { return e.Message }

// UpstreamError is a failed, refused or unparseable Horizons exchange (HTTP 502).
type UpstreamError struct{ Message string }

func (e *UpstreamError) Error() string { return e.Message }

// Query is one validated lunar-surface observer request.
type Query struct {
	Target      string
	LonE        float64 // MEAN_ME east longitude, degrees [0,360)
	Lat         float64 // MEAN_ME planetocentric latitude, degrees
	AltKm       float64 // above the 1737.4 km sphere
	Start       time.Time
	StepMinutes int
	Samples     int
}

// Validate enforces the supported envelope.
func (q *Query) Validate() error {
	if _, ok := Targets[q.Target]; !ok {
		return &InputError{"target must be \"sun\" or \"earth\"."}
	}
	for _, v := range []float64{q.LonE, q.Lat, q.AltKm} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return &InputError{"site coordinates must be finite numbers."}
		}
	}
	if q.Lat < -90 || q.Lat > 90 {
		return &InputError{"site latitude must be between -90 and +90 degrees."}
	}
	if q.LonE < -180 || q.LonE > 360 {
		return &InputError{"site longitude must be in -180…180 or 0…360 degrees, east-positive."}
	}
	q.LonE = math.Mod(q.LonE+360, 360)
	if q.AltKm < -12 || q.AltKm > 12 {
		return &InputError{"site altitude must be within ±12 km of the 1737.4 km reference sphere."}
	}
	if q.StepMinutes < 1 || q.StepMinutes > 100000 {
		return &InputError{"step_minutes must be an integer between 1 and 100000."}
	}
	if q.Samples < 1 || q.Samples > MaxSamples {
		return &InputError{fmt.Sprintf("sample count must be between 1 and %d.", MaxSamples)}
	}
	if q.Start.IsZero() || q.Start.Year() < 1900 || q.Stop().Year() > 2199 {
		return &InputError{"start time must be a UTC instant between 1900 and 2199."}
	}
	if q.Start.Second() != 0 || q.Start.Nanosecond() != 0 {
		return &InputError{"start time must fall on a whole UTC minute."}
	}
	return nil
}

// Stop is the last sample instant.
func (q *Query) Stop() time.Time {
	return q.Start.Add(time.Duration(q.Samples-1) * time.Duration(q.StepMinutes) * time.Minute)
}

// Params returns the exact API parameters, in a stable order.
func (q *Query) Params() [][2]string {
	stop := q.Stop()
	if q.Samples == 1 { // Horizons needs stop > start; request one extra step and keep the first row
		stop = q.Start.Add(time.Duration(q.StepMinutes) * time.Minute)
	}
	quote := func(s string) string { return "'" + s + "'" }
	const layout = "2006-01-02 15:04"
	return [][2]string{
		{"format", "text"},
		{"COMMAND", quote(Targets[q.Target].ID)},
		{"OBJ_DATA", quote("NO")},
		{"MAKE_EPHEM", quote("YES")},
		{"EPHEM_TYPE", quote("OBSERVER")},
		{"CENTER", quote("coord@301")},
		{"COORD_TYPE", quote("GEODETIC")},
		{"SITE_COORD", quote(fmt.Sprintf("%.6f,%.6f,%.4f", q.LonE, q.Lat, q.AltKm))},
		{"START_TIME", quote(q.Start.UTC().Format(layout))},
		{"STOP_TIME", quote(stop.UTC().Format(layout))},
		{"STEP_SIZE", quote(strconv.Itoa(q.StepMinutes) + " m")},
		{"QUANTITIES", quote("4,20,30")},
		{"ANG_FORMAT", quote("DEG")},
		{"APPARENT", quote("AIRLESS")},
		{"CAL_FORMAT", quote("BOTH")},
		{"TIME_DIGITS", quote("SECONDS")},
		{"TIME_TYPE", quote("UT")},
		{"CSV_FORMAT", quote("YES")},
		{"RANGE_UNITS", quote("KM")},
		{"EXTRA_PREC", quote("YES")},
	}
}

// URL renders the request URL against a base endpoint.
func (q *Query) URL(base string) string {
	var b strings.Builder
	b.WriteString(base)
	for i, kv := range q.Params() {
		if i == 0 {
			b.WriteByte('?')
		} else {
			b.WriteByte('&')
		}
		b.WriteString(kv[0] + "=" + strings.ReplaceAll(url.QueryEscape(kv[1]), "+", "%20"))
	}
	return b.String()
}

// Row is one ephemeris sample.
type Row struct {
	UTC            string  `json:"utc"`
	JDUT           float64 `json:"jd_ut"`
	AzimuthDeg     float64 `json:"azimuth_deg"`
	ElevationDeg   float64 `json:"elevation_deg"`
	RangeKm        float64 `json:"range_km"`
	RangeRateKmS   float64 `json:"range_rate_km_s"`
	TDBMinusUTSec  float64 `json:"tdb_minus_ut_s"`
	SolarPresence  string  `json:"solar_presence"`
	InterfererFlag string  `json:"interferer_presence"`
}

// Result is a parsed and validated Horizons observer table.
type Result struct {
	Target         string     `json:"target"`
	BodyID         string     `json:"body_id"`
	TargetName     string     `json:"target_name"`
	CenterName     string     `json:"center_name"`
	EphemerisSrc   string     `json:"ephemeris_source"`
	CenterFrame    string     `json:"center_frame"`
	CenterRadiiKm  [3]float64 `json:"center_radii_km"`
	SiteLonE       float64    `json:"site_east_longitude_deg"`
	SiteLat        float64    `json:"site_latitude_deg"`
	SiteAltKm      float64    `json:"site_altitude_km"`
	Refraction     string     `json:"atmospheric_refraction"`
	EOPFile        string     `json:"eop_file,omitempty"`
	GeneratedLine  string     `json:"generated,omitempty"`
	APIVersion     string     `json:"api_version,omitempty"`
	Columns        []string   `json:"columns"`
	Rows           []Row      `json:"rows"`
	RequestURL     string     `json:"request_url,omitempty"`
	RetrievedUTC   string     `json:"retrieved_utc,omitempty"`
	Cache          string     `json:"cache,omitempty"`
	ResponseSHA256 string     `json:"response_sha256,omitempty"`
}

var months = map[string]time.Month{"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6, "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}

func headerValue(lines []string, label string) (string, bool) {
	for _, line := range lines {
		if strings.HasPrefix(line, label) {
			rest := strings.TrimSpace(strings.TrimPrefix(line, label))
			rest = strings.TrimSpace(strings.TrimPrefix(rest, ":"))
			return rest, true
		}
	}
	return "", false
}

func stripBraces(s string) (value, note string) {
	if i := strings.Index(s, "{"); i >= 0 {
		return strings.TrimSpace(s[:i]), strings.Trim(strings.TrimSpace(s[i:]), "{}")
	}
	return strings.TrimSpace(s), ""
}

func floats(s string, n int) ([]float64, bool) {
	parts := strings.Split(s, ",")
	if len(parts) < n {
		return nil, false
	}
	out := make([]float64, n)
	for i := 0; i < n; i++ {
		f := strings.Fields(parts[i])
		if len(f) == 0 {
			return nil, false
		}
		v, err := strconv.ParseFloat(f[0], 64)
		if err != nil {
			return nil, false
		}
		out[i] = v
	}
	return out, true
}

// Parse decodes a text-format Horizons observer table. It is strict: missing
// markers, unknown columns or malformed rows are errors, never guesses.
func Parse(text string) (*Result, error) {
	if len(text) > maxResponse {
		return nil, &UpstreamError{"Horizons response is larger than expected."}
	}
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	soe, eoe := -1, -1
	for i, line := range lines {
		switch strings.TrimSpace(line) {
		case "$$SOE":
			if soe < 0 {
				soe = i
			}
		case "$$EOE":
			eoe = i
		}
	}
	if soe < 0 || eoe < soe {
		excerpt := strings.TrimSpace(text)
		if len(excerpt) > 300 {
			excerpt = excerpt[:300] + "…"
		}
		return nil, &UpstreamError{"Horizons returned no ephemeris table (missing $$SOE/$$EOE). Response began: " + excerpt}
	}
	head := lines[:soe]
	r := &Result{}
	if v, ok := headerValue(head, "API VERSION"); ok {
		r.APIVersion = v
	}
	for _, line := range head {
		if strings.HasPrefix(line, "Ephemeris / ") {
			r.GeneratedLine = strings.TrimSpace(line)
		}
	}
	target, ok := headerValue(head, "Target body name")
	if !ok {
		return nil, &UpstreamError{"Horizons response has no target body line."}
	}
	r.TargetName, r.EphemerisSrc = stripBraces(target)
	r.EphemerisSrc = strings.TrimSpace(strings.TrimPrefix(r.EphemerisSrc, "source:"))
	center, ok := headerValue(head, "Center body name")
	if !ok {
		return nil, &UpstreamError{"Horizons response has no center body line."}
	}
	r.CenterName, _ = stripBraces(center)
	if geo, ok := headerValue(head, "Center geodetic"); ok {
		value, note := stripBraces(geo)
		v, okv := floats(value, 3)
		if !okv || !strings.HasPrefix(note, "E-lon(deg),Lat(deg),Alt(km)") {
			return nil, &UpstreamError{"Horizons site echo is not E-lon(deg),Lat(deg),Alt(km)."}
		}
		r.SiteLonE, r.SiteLat, r.SiteAltKm = v[0], v[1], v[2]
	} else {
		return nil, &UpstreamError{"Horizons response does not echo a user-defined surface site."}
	}
	if frame, ok := headerValue(head, "Center pole/equ"); ok {
		r.CenterFrame, _ = stripBraces(frame)
	}
	if radii, ok := headerValue(head, "Center radii"); ok {
		value, _ := stripBraces(radii)
		if v, okv := floats(strings.TrimSuffix(strings.TrimSpace(value), "km"), 3); okv {
			r.CenterRadiiKm = [3]float64{v[0], v[1], v[2]}
		}
	}
	if v, ok := headerValue(head, "Atmos refraction"); ok {
		r.Refraction = v
	}
	if v, ok := headerValue(head, "EOP file"); ok {
		r.EOPFile = strings.TrimSpace(v)
	}
	// Column header: the last comma-separated line before $$SOE.
	col := map[string]int{}
	for i := soe - 1; i >= 0 && len(col) == 0; i-- {
		if strings.Contains(lines[i], "Date__(") && strings.Contains(lines[i], ",") {
			for j, name := range strings.Split(lines[i], ",") {
				name = strings.TrimSpace(name)
				if name != "" {
					col[name] = j
					r.Columns = append(r.Columns, name)
				}
			}
		}
	}
	need := map[string]string{"date": "Date__(UT)__HR:MN:SS", "az": "Azimuth_(a-app)", "el": "Elevation_(a-app)", "delta": "delta", "deldot": "deldot", "tdb": "TDB-UT"}
	for _, name := range need {
		if _, ok := col[name]; !ok {
			return nil, &UpstreamError{"Horizons table is missing the expected column " + name + " (time scale must be UT, angles airless-apparent)."}
		}
	}
	jdCol, hasJD := col["Date_________JDUT"]
	for _, line := range lines[soe+1 : eoe] {
		if strings.TrimSpace(line) == "" {
			continue
		}
		f := strings.Split(line, ",")
		get := func(i int) string {
			if i < len(f) {
				return strings.TrimSpace(f[i])
			}
			return ""
		}
		num := func(i int) (float64, error) { return strconv.ParseFloat(get(i), 64) }
		var row Row
		var err error
		stamp := strings.Fields(get(col[need["date"]]))
		if len(stamp) != 2 {
			return nil, &UpstreamError{"Horizons row has a malformed date: " + strings.TrimSpace(line)}
		}
		d := strings.Split(stamp[0], "-")
		hms := strings.Split(stamp[1], ":")
		if len(d) != 3 || len(hms) != 3 {
			return nil, &UpstreamError{"Horizons row has a malformed date: " + strings.TrimSpace(line)}
		}
		year, e1 := strconv.Atoi(d[0])
		day, e2 := strconv.Atoi(d[2])
		hh, e3 := strconv.Atoi(hms[0])
		mm, e4 := strconv.Atoi(hms[1])
		sec, e5 := strconv.ParseFloat(hms[2], 64)
		month, okm := months[d[1]]
		if e1 != nil || e2 != nil || e3 != nil || e4 != nil || e5 != nil || !okm {
			return nil, &UpstreamError{"Horizons row has a malformed date: " + strings.TrimSpace(line)}
		}
		when := time.Date(year, month, day, hh, mm, 0, 0, time.UTC).Add(time.Duration(math.Round(sec*1e3)) * time.Millisecond)
		row.UTC = when.Format("2006-01-02T15:04:05.000Z")
		if hasJD {
			if row.JDUT, err = num(jdCol); err != nil {
				return nil, &UpstreamError{"Horizons row has a malformed Julian date."}
			}
			if jd := float64(when.UnixMilli())/86400000 + 2440587.5; math.Abs(jd-row.JDUT) > 1e-6 {
				return nil, &UpstreamError{"Horizons calendar date and Julian date disagree."}
			}
		} else {
			row.JDUT = float64(when.UnixMilli())/86400000 + 2440587.5
		}
		// The two flag columns sit between the date(s) and the azimuth.
		azCol := col[need["az"]]
		row.SolarPresence, row.InterfererFlag = get(azCol-2), get(azCol-1)
		vals := [5]float64{}
		for i, name := range []string{"az", "el", "delta", "deldot", "tdb"} {
			if vals[i], err = num(col[need[name]]); err != nil || math.IsNaN(vals[i]) || math.IsInf(vals[i], 0) {
				return nil, &UpstreamError{"Horizons row has a non-numeric " + need[name] + " value: " + strings.TrimSpace(line)}
			}
		}
		row.AzimuthDeg, row.ElevationDeg, row.RangeKm, row.RangeRateKmS, row.TDBMinusUTSec = vals[0], vals[1], vals[2], vals[3], vals[4]
		if row.AzimuthDeg < 0 || row.AzimuthDeg > 360 || row.ElevationDeg < -90 || row.ElevationDeg > 90 || row.RangeKm <= 0 {
			return nil, &UpstreamError{"Horizons row is outside physical bounds: " + strings.TrimSpace(line)}
		}
		r.Rows = append(r.Rows, row)
	}
	if len(r.Rows) == 0 {
		return nil, &UpstreamError{"Horizons returned an empty ephemeris table."}
	}
	return r, nil
}

// ValidateAgainst proves the response answers exactly the question asked: the
// right bodies, the lunar surface site, the MEAN_ME frame, a spherical 1737.4 km
// Moon, no refraction, and every expected timestamp. Any mismatch is an error;
// incompatible data is never compared.
func (r *Result) ValidateAgainst(q *Query) error {
	t := Targets[q.Target]
	fail := func(format string, args ...any) error {
		return &UpstreamError{"Horizons response failed validation: " + fmt.Sprintf(format, args...)}
	}
	if !strings.HasPrefix(r.TargetName, t.Name) || !strings.Contains(r.TargetName, "("+t.ID+")") {
		return fail("target is %q, expected %s (%s)", r.TargetName, t.Name, t.ID)
	}
	if !strings.Contains(r.CenterName, "Moon (301)") {
		return fail("observer centre is %q, expected Moon (301)", r.CenterName)
	}
	dLon := math.Abs(math.Mod(r.SiteLonE-q.LonE+540, 360) - 180)
	if dLon > 1.5e-6 || math.Abs(r.SiteLat-q.Lat) > 1.5e-6 || math.Abs(r.SiteAltKm-q.AltKm) > 1.5e-4 {
		return fail("site echo %.6f,%.6f,%.4f does not match the request %.6f,%.6f,%.4f", r.SiteLonE, r.SiteLat, r.SiteAltKm, q.LonE, q.Lat, q.AltKm)
	}
	if !strings.HasPrefix(r.CenterFrame, "MEAN_ME") {
		return fail("lunar body-fixed frame is %q, expected MEAN_ME", r.CenterFrame)
	}
	for _, radius := range r.CenterRadiiKm {
		if math.Abs(radius-MoonRadiusKm) > 1e-6 {
			return fail("Moon radii %v are not the 1737.4 km sphere", r.CenterRadiiKm)
		}
	}
	if !strings.HasPrefix(r.Refraction, "NO") {
		return fail("refraction model is %q, expected NO (AIRLESS)", r.Refraction)
	}
	rows := r.Rows
	if q.Samples == 1 && len(rows) >= 1 {
		rows = rows[:1]
	}
	if len(rows) != q.Samples {
		return fail("%d rows returned, %d requested", len(rows), q.Samples)
	}
	for i, row := range rows {
		want := q.Start.Add(time.Duration(i) * time.Duration(q.StepMinutes) * time.Minute)
		got, err := time.Parse("2006-01-02T15:04:05.000Z", row.UTC)
		if err != nil || got.Sub(want).Abs() > 500*time.Millisecond {
			return fail("row %d is at %s, expected %s", i, row.UTC, want.Format(time.RFC3339))
		}
	}
	r.Rows = rows
	r.Target, r.BodyID = q.Target, t.ID
	return nil
}

// Transport performs the HTTP exchange; replaceable for recorded-fixture replay.
type Transport interface {
	Get(ctx context.Context, requestURL string) (body string, err error)
}

// HTTPTransport calls the live API.
type HTTPTransport struct{ Client *http.Client }

func (t *HTTPTransport) Get(ctx context.Context, requestURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "CHANDRA-lunar-mission-planner (independent ephemeris verification)")
	client := t.Client
	if client == nil {
		client = &http.Client{Timeout: 25 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error {
			return errors.New("unexpected redirect from the Horizons API")
		}}
	}
	resp, err := client.Do(req)
	if err != nil {
		// Never echo the transport error: it repeats the whole request URL and can
		// expose resolver or proxy addresses of the host. A short reason is enough.
		return "", &UpstreamError{"JPL Horizons could not be reached (" + transportReason(ctx, err) + ")."}
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponse+1))
	if err != nil {
		return "", &UpstreamError{"JPL Horizons response could not be read (" + transportReason(ctx, err) + ")."}
	}
	if len(raw) > maxResponse {
		return "", &UpstreamError{"Horizons response is larger than expected."}
	}
	if resp.StatusCode != http.StatusOK {
		return "", &UpstreamError{fmt.Sprintf("JPL Horizons returned HTTP %d.", resp.StatusCode)}
	}
	return string(raw), nil
}

// transportReason reduces a transport error to a short, non-identifying phrase.
func transportReason(ctx context.Context, err error) string {
	var netErr net.Error
	switch {
	case ctx.Err() != nil || errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &netErr) && netErr.Timeout()):
		return "timed out"
	case strings.Contains(err.Error(), "unexpected redirect"):
		return "unexpected redirect"
	default:
		return "network error"
	}
}

// AllowedBase reports whether a base URL may be contacted: the official JPL
// endpoint, or a loopback address (recorded-fixture servers in tests).
func AllowedBase(base string) bool {
	u, err := url.Parse(base)
	if err != nil || u.User != nil {
		return false
	}
	if u.Scheme == "https" && (u.Host == "ssd.jpl.nasa.gov" || u.Host == "ssd-api.jpl.nasa.gov") {
		return true
	}
	host := u.Hostname()
	return u.Scheme == "http" && (host == "127.0.0.1" || host == "localhost" || host == "::1")
}

// Client adds caching and outbound rate limiting. Horizons asks clients not to
// issue concurrent requests, so calls are serialised and spaced.
type Client struct {
	BaseURL     string
	Transport   Transport
	MinInterval time.Duration
	TTL         time.Duration
	Now         func() time.Time

	mu    sync.Mutex
	last  time.Time
	cache map[string]cached
	order []string
}

type cached struct {
	text string
	at   time.Time
}

const maxCacheEntries = 256

// Fetch returns a validated result for a query, from cache when possible.
func (c *Client) Fetch(ctx context.Context, q Query) (*Result, error) {
	if err := q.Validate(); err != nil {
		return nil, err
	}
	base := c.BaseURL
	if base == "" {
		base = OfficialBaseURL
	}
	if !AllowedBase(base) {
		return nil, &UpstreamError{"Horizons endpoint is not on the allowlist."}
	}
	now := time.Now
	if c.Now != nil {
		now = c.Now
	}
	ttl := c.TTL
	if ttl == 0 {
		ttl = 24 * time.Hour
	}
	requestURL := q.URL(base)
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cache == nil {
		c.cache = map[string]cached{}
	}
	text, state, at := "", "miss", now()
	if hit, ok := c.cache[requestURL]; ok && now().Sub(hit.at) < ttl {
		text, state, at = hit.text, "hit", hit.at
	} else {
		if wait := c.MinInterval - now().Sub(c.last); wait > 0 && !c.last.IsZero() {
			select {
			case <-time.After(wait):
			case <-ctx.Done():
				return nil, &UpstreamError{"Horizons request cancelled while rate-limited."}
			}
		}
		transport := c.Transport
		if transport == nil {
			transport = &HTTPTransport{}
		}
		var err error
		text, err = transport.Get(ctx, requestURL)
		c.last = now()
		if err != nil {
			var up *UpstreamError
			if errors.As(err, &up) {
				return nil, err
			}
			return nil, &UpstreamError{"JPL Horizons request failed: " + err.Error()}
		}
	}
	result, err := Parse(text)
	if err != nil {
		return nil, err
	}
	if err := result.ValidateAgainst(&q); err != nil {
		return nil, err
	}
	if state == "miss" { // cache only responses that passed validation
		if len(c.order) >= maxCacheEntries {
			delete(c.cache, c.order[0])
			c.order = c.order[1:]
		}
		c.cache[requestURL] = cached{text, at}
		c.order = append(c.order, requestURL)
	}
	sum := sha256.Sum256([]byte(text))
	result.RequestURL, result.Cache, result.ResponseSHA256 = requestURL, state, hex.EncodeToString(sum[:])
	result.RetrievedUTC = at.UTC().Format(time.RFC3339)
	return result, nil
}
