package lola

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"chandra/backend/geotiff"
	"chandra/backend/terrain"
)

const roughDEM = "../../tests/golden/dem/extract_rough_spstere_20m.tif"

func synthOptions() map[string]any {
	return map[string]any{"vertical_unit": "m", "value_kind": "elevation", "elevation_reference": "Synthetic fixture, no scientific datum",
		"lunar_reference_frame": "Synthetic test frame", "elevation_reference_radius_m": 1737400.0}
}

type goldenWindow struct {
	Latitude  float64     `json:"latitude"`
	Longitude float64     `json:"longitude"`
	RadiusKm  float64     `json:"radius_km"`
	Window    []int       `json:"source_pixel_window"`
	Landing   float64     `json:"native_landing_elevation_m"`
	Shape     []int       `json:"subset_shape"`
	Transform []float64   `json:"subset_transform"`
	First     [][]float64 `json:"first_pixels"`
	Error     string      `json:"error"`
}

func loadWindows(t *testing.T) []goldenWindow {
	raw, err := os.ReadFile("../../tests/golden/python/downloader_windows.json")
	if err != nil {
		t.Fatal(err)
	}
	var out []goldenWindow
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// rangeServer serves a local raster like a COG host: Range supported, requests logged.
type rangeServer struct {
	mu       sync.Mutex
	requests []*http.Request
	ignore   bool // ignore Range (always 200 with the full body)
	*httptest.Server
}

func newRangeServer(t *testing.T, path string) *rangeServer {
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s := &rangeServer{}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		s.requests = append(s.requests, r.Clone(context.Background()))
		ignore := s.ignore
		s.mu.Unlock()
		if ignore {
			r.Header.Del("Range")
		}
		w.Header().Set("ETag", `"fixture-v1"`)
		http.ServeContent(w, r, "dem.tif", time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC), bytes.NewReader(data))
	}))
	t.Cleanup(s.Close)
	return s
}

func (s *rangeServer) product() Product {
	return Product{ID: "test-synthetic", URL: s.URL + "/data/LDEM_TEST.TIF", ProductPage: "https://example.invalid/product", Assumptions: synthOptions()}
}

func TestPlanMatchesPythonDownloader(t *testing.T) {
	d, err := terrain.OpenDEM(&terrain.Settings{DEMPath: roughDEM, Options: synthOptions()})
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	cases := loadWindows(t)
	if len(cases) != 5 {
		t.Fatalf("golden set changed: %d", len(cases))
	}
	for _, c := range cases {
		plan, err := PlanSubset(d, c.Latitude, c.Longitude, c.RadiusKm)
		if c.Error != "" {
			if err == nil || err.Error() != c.Error {
				t.Fatalf("%v: error %v, Python %q", c, err, c.Error)
			}
			continue
		}
		if err != nil {
			t.Fatalf("%+v: %v", c, err)
		}
		for i := range c.Window {
			if plan.Window[i] != c.Window[i] {
				t.Fatalf("window %v, Python %v", plan.Window, c.Window)
			}
		}
	}
}

func TestSubsetPreservesRealPixelsAndRecordsProvenance(t *testing.T) {
	srv := newRangeServer(t, roughDEM)
	fixed := time.Date(2026, 11, 14, 12, 0, 0, 0, time.UTC)
	for _, c := range loadWindows(t) {
		if c.Error != "" {
			_, err := Acquire(context.Background(), Options{Product: srv.product(), AllowLoopback: true}, c.Latitude, c.Longitude, c.RadiusKm, false)
			if err == nil || err.Error() != c.Error {
				t.Fatalf("expected %q, got %v", c.Error, err)
			}
			continue
		}
		srv.mu.Lock()
		srv.requests = nil
		srv.mu.Unlock()
		sub, err := Acquire(context.Background(), Options{Product: srv.product(), AllowLoopback: true, Now: func() time.Time { return fixed }}, c.Latitude, c.Longitude, c.RadiusKm, false)
		if err != nil {
			t.Fatalf("%+v: %v", c, err)
		}
		prov := sub.Config["subset_provenance"].(map[string]any)
		if prov["sha256"] != sub.SHA256 || prov["downloaded_utc"] != "2026-11-14T12:00:00Z" || prov["source_etag"] != `"fixture-v1"` ||
			sub.Config["source_url"] != srv.product().URL || sub.Config["product_id"] != "test-synthetic" {
			t.Fatalf("provenance incomplete: %v", prov)
		}
		if got := prov["native_landing_elevation_m"].(float64); got-c.Landing > 1e-9 || c.Landing-got > 1e-9 {
			t.Fatalf("landing %v, Python %v", got, c.Landing)
		}
		// The probe must be isolated from the raster URL and never read the source.
		probe := srv.requests[0]
		if probe.URL.RawQuery != "lunar_terrain_range_probe=1" || probe.Header.Get("Range") != "bytes=0-15" {
			t.Fatalf("probe was %s Range=%q", probe.URL, probe.Header.Get("Range"))
		}
		for _, r := range srv.requests[1:] {
			if r.URL.RawQuery != "" || !strings.HasPrefix(r.Header.Get("Range"), "bytes=") {
				t.Fatalf("unbounded request issued: %s %q", r.URL, r.Header.Get("Range"))
			}
		}
		// Pixel-for-pixel identity with the source window, same georeferencing.
		f, err := geotiff.Open(bytes.NewReader(sub.TIFF), int64(len(sub.TIFF)))
		if err != nil {
			t.Fatal(err)
		}
		if f.Width != c.Shape[0] || f.Height != c.Shape[1] {
			t.Fatalf("subset %dx%d, Python %v", f.Width, f.Height, c.Shape)
		}
		gt, _ := f.Geotransform()
		if gt[1] != c.Transform[0] || gt[0] != c.Transform[2] || gt[5] != c.Transform[4] || gt[3] != c.Transform[5] {
			t.Fatalf("subset transform %v, Python %v", gt, c.Transform)
		}
		src, _ := terrain.OpenDEM(&terrain.Settings{DEMPath: roughDEM, Options: synthOptions()})
		want, _ := src.File.ReadWindow(c.Window[0], c.Window[1], c.Window[2], c.Window[3])
		got, _ := f.ReadWindow(0, 0, f.Width, f.Height)
		src.Close()
		for i := range want {
			if want[i] != got[i] {
				t.Fatalf("pixel %d changed: %v -> %v", i, want[i], got[i])
			}
		}
		for r, row := range c.First {
			for col, v := range row {
				if got[r*f.Width+col] != v {
					t.Fatalf("first pixels differ from the Python subset")
				}
			}
		}
		if f.Tags["LUNAR_SIM_SOURCE"] != "SYNTHETIC" || f.Tags["SOURCE_URL"] == "" || !f.HasScale || f.Scale != 0.5 || !f.HasNoData || f.NoData != -32768 {
			t.Fatalf("subset lost source metadata: %v", f.Tags)
		}
		// The subset + config drive the terrain engine exactly like the source did.
		path := t.TempDir() + "/SYNTHETIC_SUBSET.tif"
		os.WriteFile(path, sub.TIFF, 0o600)
		res, err := terrain.ExtractTerrain(&terrain.Settings{DEMPath: path, Options: sub.Config}, c.Latitude, c.Longitude, c.RadiusKm, "low")
		if err != nil {
			t.Fatal(err)
		}
		full, _ := terrain.ExtractTerrain(&terrain.Settings{DEMPath: roughDEM, Options: synthOptions()}, c.Latitude, c.Longitude, c.RadiusKm, "low")
		if res.LandingElevation != full.LandingElevation || !res.Synthetic || res.Statistics != full.Statistics {
			t.Fatalf("subset terrain differs from the source: %+v vs %+v", res.Statistics, full.Statistics)
		}
		if info := res.Source.(*terrain.SourceInfo); info.Provenance["subset_provenance"] == nil || info.Provenance["source_url"] == nil {
			t.Fatal("provenance did not reach the terrain response")
		}
	}
}

func TestDryRunPlansWithoutReadingPixels(t *testing.T) {
	srv := newRangeServer(t, roughDEM)
	sub, err := Acquire(context.Background(), Options{Product: srv.product(), AllowLoopback: true}, -89.5, 45.0, 2.0, true)
	if err != nil {
		t.Fatal(err)
	}
	if sub.TIFF != nil || sub.Plan.Pixels != sub.Plan.Window[2]*sub.Plan.Window[3] || sub.Plan.EncodedBytes == 0 || sub.Plan.Blocks == 0 || sub.Plan.SourceWidth != 512 {
		t.Fatalf("plan incomplete: %+v", sub.Plan)
	}
	fetched := 0
	for _, r := range srv.requests[1:] {
		var a, b int
		if n, _ := fmtSscanf(r.Header.Get("Range"), &a, &b); n == 2 {
			fetched += b - a + 1
		}
	}
	info, _ := os.Stat(roughDEM)
	if fetched == 0 || int64(fetched) > info.Size() {
		t.Fatalf("dry run fetched %d bytes", fetched)
	}
}

func TestNoRangeSupportRefusesFullDownload(t *testing.T) {
	srv := newRangeServer(t, roughDEM)
	srv.ignore = true
	_, err := Acquire(context.Background(), Options{Product: srv.product(), AllowLoopback: true}, -89.5, 45.0, 2.0, false)
	if err == nil || !strings.Contains(err.Error(), "full-raster fallback is disabled") {
		t.Fatalf("expected refusal, got %v", err)
	}
	if len(srv.requests) != 1 {
		t.Fatalf("%d requests after a failed probe; the source must not be read", len(srv.requests))
	}
}

func TestOnlyAllowlistedHostsAreContacted(t *testing.T) {
	for raw, want := range map[string]bool{
		LDEM80S20M.URL: true, "http://pgda.gsfc.nasa.gov/data/x.tif": false, "https://pgda.gsfc.nasa.gov.evil.example/x.tif": false,
		"https://evil.example/LDEM_80S_20MPP_ADJ.TIF": false, "https://user:pw@pgda.gsfc.nasa.gov/x.tif": false,
		"http://127.0.0.1:8000/x.tif": false, "file:///etc/passwd": false, "http://169.254.169.254/latest/meta-data": false, "": false,
	} {
		if AllowedURL(raw, false) != want {
			t.Fatalf("AllowedURL(%q) != %v", raw, want)
		}
	}
	srv := newRangeServer(t, roughDEM)
	// Loopback is refused unless a test explicitly opts in.
	if _, err := Acquire(context.Background(), Options{Product: srv.product()}, -89.5, 45.0, 2.0, false); err == nil || !strings.Contains(err.Error(), "allowlist") {
		t.Fatalf("loopback source accepted without opt-in: %v", err)
	}
	// A redirect away from the allowlist must not be followed.
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://example.invalid/steal", http.StatusFound)
	}))
	defer redirect.Close()
	p := srv.product()
	p.URL = redirect.URL + "/x.tif"
	if _, err := Acquire(context.Background(), Options{Product: p, AllowLoopback: true}, -89.5, 45.0, 2.0, false); err == nil {
		t.Fatal("redirect outside the allowlist was followed")
	}
}

func TestReadBudgetIsEnforced(t *testing.T) {
	srv := newRangeServer(t, roughDEM)
	_, err := Acquire(context.Background(), Options{Product: srv.product(), AllowLoopback: true, MaxBytes: 300 << 10}, -89.5, 45.0, 2.0, false)
	if err == nil {
		t.Fatal("byte budget was not enforced")
	}
	if _, ok := err.(*terrain.Error); !ok {
		t.Fatalf("budget error must be user-facing, got %T %v", err, err)
	}
}

// A source object that is replaced while it is being read must never yield a
// subset stitched from two versions. Whatever the request at which the server
// starts answering from a different object (new ETag, or new size), the
// acquisition has to fail, and say why.
func TestSourceChangingMidDownloadIsRejected(t *testing.T) {
	data, err := os.ReadFile(roughDEM)
	if err != nil {
		t.Fatal(err)
	}
	type outcome struct {
		requests int
		err      error
	}
	run := func(mode string, flipAfter int) outcome {
		var mu sync.Mutex
		served := 0
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			served++
			flipped := served > flipAfter
			mu.Unlock()
			body, tag := data, `"v1"`
			if flipped && mode == "etag" {
				tag = `"v2"`
			}
			if flipped && mode == "size" {
				body = append(append([]byte{}, data...), 0, 0, 0, 0)
			}
			w.Header().Set("ETag", tag)
			http.ServeContent(w, r, "dem.tif", time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC), bytes.NewReader(body))
		}))
		defer srv.Close()
		product := Product{ID: "test-synthetic", URL: srv.URL + "/data/LDEM_TEST.TIF", ProductPage: "https://example.invalid/product", Assumptions: synthOptions()}
		_, err := Acquire(context.Background(), Options{Product: product, AllowLoopback: true}, -89.5, 45.0, 2.0, false)
		mu.Lock()
		defer mu.Unlock()
		return outcome{served, err}
	}
	clean := run("etag", 1<<30)
	if clean.err != nil || clean.requests < 3 {
		t.Fatalf("an unchanged source must download in at least three requests: %d requests, %v", clean.requests, clean.err)
	}
	for _, mode := range []string{"etag", "size"} {
		for flipAfter := 1; flipAfter < clean.requests; flipAfter++ {
			got := run(mode, flipAfter)
			if got.err == nil {
				t.Fatalf("%s changed after request %d of %d and the subset was still accepted", mode, flipAfter, clean.requests)
			}
			if _, ok := got.err.(*terrain.Error); !ok || !strings.Contains(got.err.Error(), "changed") {
				t.Fatalf("%s changed after request %d: want a user-facing \"changed\" error, got %T %v", mode, flipAfter, got.err, got.err)
			}
			if strings.Contains(got.err.Error(), "127.0.0.1") {
				t.Fatalf("error names the source address: %v", got.err)
			}
		}
		if got := run(mode, clean.requests); got.err != nil {
			t.Fatalf("%s changing only after the download finished must not fail it: %v", mode, got.err)
		}
	}
}

func TestInvalidRequestsFailBeforeAnyNetworkUse(t *testing.T) {
	srv := newRangeServer(t, roughDEM)
	for _, c := range [][3]any{{-91.0, 45.0, 2.0}, {-89.5, 400.0, 2.0}, {-89.5, 45.0, 50.0}, {"x", 45.0, 2.0}, {true, 45.0, 2.0}} {
		if _, err := Acquire(context.Background(), Options{Product: srv.product(), AllowLoopback: true}, c[0], c[1], c[2], false); err == nil {
			t.Fatalf("%v accepted", c)
		}
	}
	if len(srv.requests) != 0 {
		t.Fatal("invalid input reached the network")
	}
}

// TestLiveLOLA is opt-in: CHANDRA_LIVE_TESTS=1 go test ./backend/lola -run Live
func TestLiveLOLA(t *testing.T) {
	if os.Getenv("CHANDRA_LIVE_TESTS") != "1" {
		t.Skip("live NASA PGDA range-read test; set CHANDRA_LIVE_TESTS=1 to run")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	sub, err := Acquire(ctx, Options{Product: LDEM80S20M}, -89.5, 45.0, 1.0, false)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("live subset: window %v, %d bytes, sha256 %s", sub.Plan.Window, len(sub.TIFF), sub.SHA256)
}

func fmtSscanf(s string, a, b *int) (int, error) {
	var x, y int
	n := 0
	rest := strings.TrimPrefix(s, "bytes=")
	parts := strings.SplitN(rest, "-", 2)
	if len(parts) == 2 {
		for _, ch := range parts[0] {
			x = x*10 + int(ch-'0')
		}
		for _, ch := range parts[1] {
			y = y*10 + int(ch-'0')
		}
		*a, *b, n = x, y, 2
	}
	return n, nil
}

// Transport failures must not echo the request URL or host/resolver details.
func TestTransportErrorsAreNotLeaked(t *testing.T) {
	product := Product{ID: "test-synthetic", URL: "http://127.0.0.1:1/data/LDEM_TEST.TIF", ProductPage: "https://example.invalid/product", Assumptions: synthOptions()}
	_, err := Acquire(context.Background(), Options{Product: product, AllowLoopback: true}, -89.5, 45.0, 2.0, true)
	if err == nil {
		t.Fatal("expected an error for an unreachable source")
	}
	msg := err.Error()
	for _, leak := range []string{"127.0.0.1", "http://", "dial", "LDEM_TEST", "connect:"} {
		if strings.Contains(msg, leak) {
			t.Fatalf("error leaks %q: %s", leak, msg)
		}
	}
	if msg != "NASA DEM server is unreachable (network error). Nothing was downloaded." {
		t.Fatalf("unexpected message: %s", msg)
	}
}
