package horizons

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func fixture(t testing.TB, name string) string {
	t.Helper()
	raw, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func shackletonQuery(target string) Query {
	return Query{Target: target, LonE: 359.450513, Lat: -89.900807, AltKm: -1.2,
		Start: time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC), StepMinutes: 720, Samples: 42}
}

func TestParseCompleteRecordedResponse(t *testing.T) {
	r, err := Parse(fixture(t, "sun_site-0E-89.9S_2026-12-18_1h.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if r.TargetName != "Sun (10)" || r.CenterName != "Moon (301)" || r.EphemerisSrc != "DE441" || r.APIVersion != "1.2" ||
		r.CenterFrame != "MEAN_ME (high precision)" || r.CenterRadiiKm != [3]float64{1737.4, 1737.4, 1737.4} ||
		r.SiteLonE != 0 || r.SiteLat != -89.9 || r.SiteAltKm != -1.2 || r.Refraction != "NO (AIRLESS)" || r.EOPFile != "eop.261113.p270209" {
		t.Fatalf("header parsed incorrectly: %+v", r)
	}
	if len(r.Rows) != 4 {
		t.Fatalf("rows = %d", len(r.Rows))
	}
	first := r.Rows[0]
	if first.UTC != "2026-12-18T00:00:00.000Z" || first.AzimuthDeg != 73.029882115 || first.ElevationDeg != 1.351204756 ||
		first.RangeKm != 1.4727212576e8 || first.RangeRateKmS != 0.7482370 || first.TDBMinusUTSec != 69.183526 ||
		first.SolarPresence != "*" || first.InterfererFlag != "i" || first.JDUT != 2461392.5 {
		t.Fatalf("first row parsed incorrectly: %+v", first)
	}
	q := Query{Target: "sun", LonE: 0, Lat: -89.9, AltKm: -1.2, Start: time.Date(2026, 12, 18, 0, 0, 0, 0, time.UTC), StepMinutes: 60, Samples: 4}
	if err := q.Validate(); err != nil {
		t.Fatal(err)
	}
	if err := r.ValidateAgainst(&q); err != nil {
		t.Fatalf("recorded response must validate against its own query: %v", err)
	}
}

func TestRecordedLunationValidatesAndMatchesBundledJSON(t *testing.T) {
	bundle := map[string]*Result{}
	for _, target := range []string{"sun", "earth"} {
		r, err := Parse(fixture(t, target+"_shackleton-me_2026-12_720m.partial.txt"))
		if err != nil {
			t.Fatal(err)
		}
		q := shackletonQuery(target)
		if err := q.Validate(); err != nil {
			t.Fatal(err)
		}
		if err := r.ValidateAgainst(&q); err != nil {
			t.Fatal(err)
		}
		if len(r.Rows) != 42 || r.Rows[41].UTC != "2026-12-21T12:00:00.000Z" || r.Rows[0].JDUT != 2461375.5 {
			t.Fatalf("%s rows wrong", target)
		}
		bundle[target] = r
	}
	if bundle["earth"].Rows[34].ElevationDeg != 4.321489297 || bundle["sun"].Rows[34].AzimuthDeg != 73.579356524 {
		t.Fatal("recorded values changed")
	}
	doc := map[string]any{
		"recorded_utc": "2026-11-14", "service": "NASA/JPL Horizons API", "endpoint": OfficialBaseURL,
		"note": "Parsed form of backend/horizons/testdata/*_shackleton-me_2026-12_720m.partial.txt (rows 1-42 of a 61-row response). Reference data only; regenerate with CHANDRA_UPDATE_RECORDED=1 go test ./backend/horizons.",
		"site": map[string]any{"frame": "MEAN_ME", "east_longitude_deg": 359.450513, "latitude_deg": -89.900807, "altitude_km": -1.2,
			"chandra_site_id": "shackleton-rim", "iau_latitude_deg": -89.9, "iau_east_longitude_deg": 0.0},
		"targets": bundle,
	}
	want, _ := json.MarshalIndent(doc, "", " ")
	want = append(want, '\n')
	const path = "../../src/verification/recordedHorizons.json"
	if os.Getenv("CHANDRA_UPDATE_RECORDED") == "1" {
		os.MkdirAll("../../src/verification", 0o755)
		if err := os.WriteFile(path, want, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != string(want) {
		t.Fatalf("src/verification/recordedHorizons.json is missing or drifted from the recorded responses (%v)", err)
	}
}

func TestRequestMatchesRecordedQuery(t *testing.T) {
	q := shackletonQuery("sun")
	q.Samples = 61
	got := q.URL(OfficialBaseURL)
	want := "https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND=%2710%27&OBJ_DATA=%27NO%27&MAKE_EPHEM=%27YES%27&EPHEM_TYPE=%27OBSERVER%27&CENTER=%27coord%40301%27&COORD_TYPE=%27GEODETIC%27&SITE_COORD=%27359.450513%2C-89.900807%2C-1.2000%27&START_TIME=%272026-12-01%2000%3A00%27&STOP_TIME=%272026-12-31%2000%3A00%27&STEP_SIZE=%27720%20m%27&QUANTITIES=%274%2C20%2C30%27&ANG_FORMAT=%27DEG%27&APPARENT=%27AIRLESS%27&CAL_FORMAT=%27BOTH%27&TIME_DIGITS=%27SECONDS%27&TIME_TYPE=%27UT%27&CSV_FORMAT=%27YES%27&RANGE_UNITS=%27KM%27&EXTRA_PREC=%27YES%27"
	if got != want {
		t.Fatalf("request drifted from the recorded query:\n got  %s\n want %s", got, want)
	}
}

func TestValidationRejectsIncompatibleResponses(t *testing.T) {
	text := fixture(t, "sun_shackleton-me_2026-12_720m.partial.txt")
	mutate := func(old, new string) string {
		if !strings.Contains(text, old) {
			t.Fatalf("fixture lacks %q", old)
		}
		return strings.Replace(text, old, new, 1)
	}
	cases := map[string]string{
		"wrong target":   mutate("Target body name: Sun (10)", "Target body name: Mars (499)"),
		"wrong centre":   mutate("Center body name: Moon (301)", "Center body name: Earth (399)"),
		"wrong frame":    mutate("Center pole/equ : MEAN_ME (high precision)", "Center pole/equ : IAU_MOON"),
		"wrong site":     mutate("Center geodetic : 359.450513, -89.900807, -1.2", "Center geodetic : 359.450513, -89.800807, -1.2"),
		"non-spherical":  mutate("Center radii    : 1737.4, 1737.4, 1737.4 km", "Center radii    : 1738.1, 1738.1, 1736.0 km"),
		"refraction":     mutate("Atmos refraction: NO (AIRLESS)", "Atmos refraction: YES (Earth refraction model)"),
		"missing sample": mutate(" 2026-Dec-05 12:00:00, 2461380.000000000,*, ,  225.832702081,       1.383633965,  1.4712749414E+08, -0.8508030,     69.183196,\n", ""),
	}
	for name, body := range cases {
		r, err := Parse(body)
		if err == nil {
			q := shackletonQuery("sun")
			err = r.ValidateAgainst(&q)
		}
		var up *UpstreamError
		if !errors.As(err, &up) {
			t.Fatalf("%s: expected a validation failure, got %v", name, err)
		}
	}
	for name, body := range map[string]string{
		"truncated":     strings.Replace(text, "$$EOE", "", 1),
		"api error":     "API VERSION: 1.2\nAPI SOURCE: NASA/JPL Horizons API\n\nNo site matches. Use \"*@body\" to list, \"c@body\" to enter coords, ?! for help.\n",
		"bad number":    mutate("280.610768755", "n.a."),
		"jd mismatch":   mutate("2461375.500000000", "2461375.600000000"),
		"out of bounds": mutate("       1.488402111", "      91.488402111"),
		"html":          "<html><body>503 Service Unavailable</body></html>",
	} {
		if _, err := Parse(body); err == nil {
			t.Fatalf("%s: malformed response was accepted", name)
		}
	}
}

func TestQueryValidation(t *testing.T) {
	ok := shackletonQuery("sun")
	bad := []func(*Query){
		func(q *Query) { q.Target = "mars" }, func(q *Query) { q.Lat = -91 }, func(q *Query) { q.LonE = 400 },
		func(q *Query) { q.AltKm = 50 }, func(q *Query) { q.StepMinutes = 0 }, func(q *Query) { q.Samples = MaxSamples + 1 },
		func(q *Query) { q.Samples = 0 }, func(q *Query) { q.Start = q.Start.Add(30 * time.Second) },
		func(q *Query) { q.Start = time.Date(1800, 1, 1, 0, 0, 0, 0, time.UTC) }, func(q *Query) { q.Lat = nan() },
	}
	for i, m := range bad {
		q := ok
		m(&q)
		var in *InputError
		if err := q.Validate(); !errors.As(err, &in) {
			t.Fatalf("case %d accepted: %v", i, err)
		}
	}
	q := ok
	q.LonE = -0.549487
	if err := q.Validate(); err != nil || q.LonE < 359.45 {
		t.Fatalf("west longitudes must normalise to 0-360 east: %v %v", q.LonE, err)
	}
}

func nan() float64 { var z float64; return z / z }

func TestClientCachesValidatesAndRateLimits(t *testing.T) {
	var hits atomic.Int32
	mode := "ok"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.URL.Query().Get("CENTER") != "'coord@301'" || r.URL.Query().Get("COORD_TYPE") != "'GEODETIC'" || r.URL.Query().Get("format") != "text" {
			http.Error(w, "unexpected query", 400)
			return
		}
		switch mode {
		case "down":
			http.Error(w, "maintenance", http.StatusServiceUnavailable)
		default:
			name := "sun"
			if r.URL.Query().Get("COMMAND") == "'399'" {
				name = "earth"
			}
			w.Write([]byte(fixture(t, name+"_shackleton-me_2026-12_720m.partial.txt")))
		}
	}))
	defer srv.Close()
	c := &Client{BaseURL: srv.URL, MinInterval: 10 * time.Millisecond}
	ctx := context.Background()
	first, err := c.Fetch(ctx, shackletonQuery("sun"))
	if err != nil || first.Cache != "miss" || len(first.Rows) != 42 || first.BodyID != "10" || first.ResponseSHA256 == "" {
		t.Fatalf("first fetch: %+v %v", first, err)
	}
	second, err := c.Fetch(ctx, shackletonQuery("sun"))
	if err != nil || second.Cache != "hit" || hits.Load() != 1 {
		t.Fatalf("identical query must be served from cache (hits=%d, %v)", hits.Load(), err)
	}
	if earth, err := c.Fetch(ctx, shackletonQuery("earth")); err != nil || earth.BodyID != "399" || hits.Load() != 2 {
		t.Fatalf("earth fetch failed: %v", err)
	}
	// A response for a different site must not validate (and must not be cached).
	wrong := shackletonQuery("sun")
	wrong.Lat = -85
	var up *UpstreamError
	if _, err := c.Fetch(ctx, wrong); !errors.As(err, &up) {
		t.Fatalf("mismatched site accepted: %v", err)
	}
	mode = "down"
	outage := shackletonQuery("sun")
	outage.Samples = 10
	if _, err := c.Fetch(ctx, outage); !errors.As(err, &up) || !strings.Contains(err.Error(), "503") {
		t.Fatalf("outage must surface as an upstream error: %v", err)
	}
	if _, err := (&Client{BaseURL: "https://example.com/api"}).Fetch(ctx, shackletonQuery("sun")); !errors.As(err, &up) {
		t.Fatalf("non-allowlisted endpoint accepted: %v", err)
	}
	for base, want := range map[string]bool{OfficialBaseURL: true, "http://127.0.0.1:9/x": true, "http://ssd.jpl.nasa.gov/api": false,
		"https://ssd.jpl.nasa.gov.evil.example/api": false, "https://user:pw@ssd.jpl.nasa.gov/api": false, "http://169.254.169.254/": false, "file:///etc/passwd": false} {
		if AllowedBase(base) != want {
			t.Fatalf("AllowedBase(%q) != %v", base, want)
		}
	}
}

// TestLiveHorizons is opt-in: CHANDRA_LIVE_TESTS=1 go test ./backend/horizons -run Live
func TestLiveHorizons(t *testing.T) {
	if os.Getenv("CHANDRA_LIVE_TESTS") != "1" {
		t.Skip("live NASA/JPL service test; set CHANDRA_LIVE_TESTS=1 to run")
	}
	q := shackletonQuery("sun")
	q.Samples = 3
	r, err := (&Client{}).Fetch(context.Background(), q)
	if err != nil {
		t.Fatal(err)
	}
	if d := r.Rows[0].ElevationDeg - 1.488402111; d > 1e-4 || d < -1e-4 {
		t.Fatalf("live value moved from the recorded one: %v", r.Rows[0].ElevationDeg)
	}
}
