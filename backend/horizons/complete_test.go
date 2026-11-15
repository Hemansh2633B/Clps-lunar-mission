package horizons

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// The two *_x6 files hold full-length responses (header, six rows, $$EOE and
// footer) to the exact URL this client generates, recorded from the live
// service on 2026-11-14. They are transcriptions made through a page-fetch
// tool, not byte-exact captures: see testdata/README.md for what that means.
// Every number in them is as the service returned it. They show, without a
// network, that:
//   - the request this client sends is one the real service answers;
//   - the parser handles a full-length response end to end;
//   - the response validates against its own query (site echo, frame, grid).
const recordedX6URL = "https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND=%27COMMAND_ID%27&OBJ_DATA=%27NO%27&MAKE_EPHEM=%27YES%27&EPHEM_TYPE=%27OBSERVER%27&CENTER=%27coord%40301%27&COORD_TYPE=%27GEODETIC%27&SITE_COORD=%27359.450513%2C-89.900807%2C-1.2000%27&START_TIME=%272026-12-01%2000%3A00%27&STOP_TIME=%272026-12-03%2012%3A00%27&STEP_SIZE=%27720%20m%27&QUANTITIES=%274%2C20%2C30%27&ANG_FORMAT=%27DEG%27&APPARENT=%27AIRLESS%27&CAL_FORMAT=%27BOTH%27&TIME_DIGITS=%27SECONDS%27&TIME_TYPE=%27UT%27&CSV_FORMAT=%27YES%27&RANGE_UNITS=%27KM%27&EXTRA_PREC=%27YES%27"

func x6Query(target string) Query {
	return Query{Target: target, LonE: 359.450513, Lat: -89.900807, AltKm: -1.2,
		Start: time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC), StepMinutes: 720, Samples: 6}
}

func TestCompleteLiveRecordingsRoundTrip(t *testing.T) {
	cases := []struct {
		target, id, file   string
		az0, el0, rangeKm0 float64
		az5, el5           float64
	}{
		{"sun", "10", "sun_shackleton-me_2026-12-01_720m_x6.txt", 280.610768755, 1.488402111, 1.4755309705e8, 250.192879304, 1.425487320},
		{"earth", "399", "earth_shackleton-me_2026-12-01_720m_x6.txt", 7.218731111, -1.511612945, 3.7655894421e5, 7.237089175, -4.813776473},
	}
	for _, c := range cases {
		q := x6Query(c.target)
		if err := q.Validate(); err != nil {
			t.Fatal(err)
		}
		if got, want := q.URL(OfficialBaseURL), strings.Replace(recordedX6URL, "COMMAND_ID", c.id, 1); got != want {
			t.Fatalf("%s: client URL drifted from the recorded live query:\n got  %s\n want %s", c.target, got, want)
		}
		text := fixture(t, c.file)
		if !strings.Contains(text, "$$EOE") || !strings.Contains(text, "Stop  time      : A.D. 2026-Dec-03 12:00:00.0000 UT") {
			t.Fatalf("%s: recording is not the full-length response", c.target)
		}
		r, err := Parse(text)
		if err != nil {
			t.Fatalf("%s: %v", c.target, err)
		}
		if err := r.ValidateAgainst(&q); err != nil {
			t.Fatalf("%s: the recorded response must validate against its own query: %v", c.target, err)
		}
		if len(r.Rows) != 6 || r.EphemerisSrc != "DE441" || r.CenterFrame != "MEAN_ME (high precision)" || r.Refraction != "NO (AIRLESS)" || r.APIVersion != "1.2" {
			t.Fatalf("%s: unexpected header/rows: %+v", c.target, r)
		}
		first, last := r.Rows[0], r.Rows[5]
		if first.UTC != "2026-12-01T00:00:00.000Z" || first.AzimuthDeg != c.az0 || first.ElevationDeg != c.el0 || first.RangeKm != c.rangeKm0 || first.TDBMinusUTSec != 69.183086 {
			t.Fatalf("%s: first row %+v", c.target, first)
		}
		if last.UTC != "2026-12-03T12:00:00.000Z" || last.AzimuthDeg != c.az5 || last.ElevationDeg != c.el5 {
			t.Fatalf("%s: last row %+v", c.target, last)
		}
		// The 61-row lunation recording was made earlier the same day; its first six rows are the same instants.
		long, err := Parse(fixture(t, c.target+"_shackleton-me_2026-12_720m.partial.txt"))
		if err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 6; i++ {
			if long.Rows[i].UTC != r.Rows[i].UTC || long.Rows[i].AzimuthDeg != r.Rows[i].AzimuthDeg || long.Rows[i].ElevationDeg != r.Rows[i].ElevationDeg || long.Rows[i].RangeKm != r.Rows[i].RangeKm {
				t.Fatalf("%s row %d: the two recordings disagree: %+v vs %+v", c.target, i, long.Rows[i], r.Rows[i])
			}
		}
	}
}

// Transport failures must not echo the request URL or host/resolver details.
func TestTransportErrorsAreNotLeaked(t *testing.T) {
	c := &Client{BaseURL: "http://127.0.0.1:1/api/horizons.api", MinInterval: time.Millisecond}
	_, err := c.Fetch(context.Background(), x6Query("sun"))
	var up *UpstreamError
	if !errors.As(err, &up) {
		t.Fatalf("expected an UpstreamError, got %v", err)
	}
	for _, leak := range []string{"127.0.0.1", "http://", "dial", "COMMAND", "connect:"} {
		if strings.Contains(up.Message, leak) {
			t.Fatalf("upstream error leaks %q: %s", leak, up.Message)
		}
	}
	if up.Message != "JPL Horizons could not be reached (network error)." {
		t.Fatalf("unexpected message: %s", up.Message)
	}
}
