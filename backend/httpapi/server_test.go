package httpapi

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"chandra/backend/horizons"
	"chandra/backend/lola"
	"chandra/backend/store"
	"chandra/backend/terrain"
)

const golden = "../../tests/golden"

func fixtureOptions() map[string]any {
	return map[string]any{"vertical_unit": "m", "value_kind": "elevation", "elevation_reference": "Synthetic fixture, no scientific datum",
		"lunar_reference_frame": "Synthetic test frame", "elevation_reference_radius_m": 1737400.0}
}

func planeSettings() *terrain.Settings {
	return &terrain.Settings{DEMPath: filepath.Join(golden, "dem", "extract_plane_aeqd.tif"), Options: fixtureOptions()}
}

func quiet() *log.Logger { return log.New(io.Discard, "", 0) }

func call(h http.Handler, method, path string, body any, contentType string) (*httptest.ResponseRecorder, map[string]any) {
	var reader io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		reader = strings.NewReader(b)
	default:
		raw, _ := json.Marshal(b)
		reader = bytes.NewReader(raw)
		if contentType == "" {
			contentType = "application/json"
		}
	}
	req := httptest.NewRequest(method, path, reader)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var parsed map[string]any
	json.Unmarshal(rec.Body.Bytes(), &parsed)
	return rec, parsed
}

// subset asserts every golden key/value is present in the native response.
// crs_name/crs_wkt are implementation-defined strings (PROJ WKT2 vs native WKT1).
func subset(t *testing.T, path string, want, got any) {
	t.Helper()
	switch w := want.(type) {
	case map[string]any:
		g, ok := got.(map[string]any)
		if !ok {
			t.Fatalf("%s: expected an object, got %T", path, got)
		}
		for k, wv := range w {
			if k == "crs_wkt" || k == "crs_name" {
				if s, _ := g[k].(string); s == "" {
					t.Fatalf("%s.%s must be a non-empty string", path, k)
				}
				continue
			}
			if k == "elevations_m_strided_31" {
				full, _ := g["elevations_m"].([]any)
				for i, wv := range wv.([]any) {
					subset(t, fmt.Sprintf("%s.elevations_m[%d]", path, i*31), wv, full[i*31])
				}
				continue
			}
			if k == "count" && strings.HasSuffix(path, ".grid") {
				if full, _ := g["elevations_m"].([]any); float64(len(full)) != wv.(float64) {
					t.Fatalf("%s: %d grid cells, Python %v", path, len(full), wv)
				}
				continue
			}
			gv, present := g[k]
			if !present {
				t.Fatalf("%s.%s missing from the native response", path, k)
			}
			subset(t, path+"."+k, wv, gv)
		}
	case []any:
		g, ok := got.([]any)
		if !ok || len(g) != len(w) {
			t.Fatalf("%s: array length differs (%d vs %T)", path, len(w), got)
		}
		for i := range w {
			subset(t, fmt.Sprintf("%s[%d]", path, i), w[i], g[i])
		}
	case float64:
		g, ok := got.(float64)
		// Synthetic grids: 0.0015 m (3-dp rounding). Real grids recorded from Flask used GDAL's
		// approximate transformer, whose documented error bound is 0.125 source pixel; on the
		// plane fixture (100 m pixels, gradient hypot(0.01, 0.02) m/m) that is 0.28 m. Exact
		// kernel equivalence is proven separately in backend/terrain (TestExtractionParityWithPython).
		tol := 1e-9 * math.Max(1, math.Abs(w))
		if strings.Contains(path, "elevations_m") || strings.Contains(path, "statistics") {
			tol = 0.0015
			if strings.Contains(path, `"mode":"real"`) {
				tol = 0.125 * 100 * math.Hypot(0.01, 0.02)
			}
		} else if strings.Contains(path, "elevations_deg") {
			tol = 1.0000001e-4
		}
		if !ok || math.Abs(g-w) > tol {
			t.Fatalf("%s = %v, Python %v", path, got, w)
		}
	default:
		if fmt.Sprint(want) != fmt.Sprint(got) {
			t.Fatalf("%s = %v, Python %v", path, got, want)
		}
	}
}

// TestFlaskContractReplay replays every request recorded against the Flask app
// and requires the same status, JSON and headers from the native server.
func TestFlaskContractReplay(t *testing.T) {
	fh, err := os.Open(filepath.Join(golden, "python", "api_calls.json.gz"))
	if err != nil {
		t.Fatal(err)
	}
	defer fh.Close()
	zr, _ := gzip.NewReader(fh)
	var calls []struct {
		App         string            `json:"app"`
		Method      string            `json:"method"`
		Path        string            `json:"path"`
		Body        json.RawMessage   `json:"body"`
		ContentType *string           `json:"content_type"`
		Status      int               `json:"status"`
		JSON        any               `json:"json"`
		Headers     map[string]string `json:"headers"`
	}
	if err := json.NewDecoder(zr).Decode(&calls); err != nil {
		t.Fatal(err)
	}
	if len(calls) < 100 {
		t.Fatalf("expected the full recorded contract, got %d calls", len(calls))
	}
	apps := map[string]http.Handler{
		"no_dem":       New(Options{Logger: quiet()}),
		"plane":        New(Options{Settings: planeSettings(), Logger: quiet()}),
		"missing_file": New(Options{Settings: &terrain.Settings{DEMPath: "/nonexistent/bad.tif", Options: fixtureOptions()}, Logger: quiet()}),
	}
	for i, c := range calls {
		var body any
		contentType := ""
		if c.ContentType != nil {
			contentType = *c.ContentType
		}
		var repeat struct {
			Repeat string `json:"__repeat__"`
			Count  int    `json:"count"`
		}
		switch {
		case len(c.Body) == 0 || string(c.Body) == "null":
		case json.Unmarshal(c.Body, &repeat) == nil && repeat.Count > 0:
			body = strings.Repeat(repeat.Repeat, repeat.Count)
		case contentType != "":
			var s string
			json.Unmarshal(c.Body, &s)
			body = s
		default:
			body = c.Body
		}
		rec, got := call(apps[c.App], c.Method, c.Path, body, contentType)
		label := fmt.Sprintf("call %d [%s] %s %s %s", i, c.App, c.Method, c.Path, string(c.Body))
		if rec.Code != c.Status {
			t.Fatalf("%s: status %d, Flask %d (%s)", label, rec.Code, c.Status, rec.Body.String())
		}
		if rec.Header().Get("X-Content-Type-Options") != c.Headers["X-Content-Type-Options"] || rec.Header().Get("Referrer-Policy") != c.Headers["Referrer-Policy"] ||
			!strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") {
			t.Fatalf("%s: headers %v", label, rec.Header())
		}
		subset(t, label, c.JSON, any(got))
	}
}

func TestRealModeNeverFallsBackToSynthetic(t *testing.T) {
	h := New(Options{Logger: quiet()})
	payload := map[string]any{"latitude": -89.5, "longitude": 45, "radius_km": 5, "quality": "low", "mode": "real"}
	rec, got := call(h, "POST", "/api/terrain", payload, "")
	if rec.Code != 400 || !strings.Contains(got["error"].(string), "No DEM configured") || got["grid"] != nil {
		t.Fatalf("real mode without a DEM must fail explicitly: %d %v", rec.Code, got)
	}
	payload["mode"] = "synthetic"
	rec, got = call(h, "POST", "/api/terrain", payload, "")
	src := got["source"].(map[string]any)
	if rec.Code != 200 || got["synthetic"] != true || !strings.Contains(src["warning"].(string), "NOT REAL LUNAR DATA") || got["processing"] != nil {
		t.Fatalf("synthetic response wrong: %v", got["source"])
	}
	// The measured path stays labelled as measured-with-synthetic-fixture provenance, with processing disclosure.
	rec, got = call(New(Options{Settings: planeSettings(), Logger: quiet()}), "POST", "/api/terrain", map[string]any{"latitude": -89.5, "longitude": 45, "radius_km": 5, "quality": "low"}, "")
	proc := got["processing"].(map[string]any)
	if rec.Code != 200 || got["mode"] != "real" || proc["engine"] != terrain.Engine || proc["kernel"] != "bilinear-4-sample" {
		t.Fatalf("processing disclosure missing: %v", got["processing"])
	}
}

func TestInternalErrorsAreControlledJSON(t *testing.T) {
	h := New(Options{Logger: quiet(), Store: &brokenStore{}})
	rec, got := call(h, "POST", "/api/terrain", map[string]any{"latitude": -89.5, "longitude": 45, "radius_km": 5, "dataset_id": "some-dataset"}, "")
	if rec.Code != 500 || got["error"] != "Internal terrain error. Check the backend console for details." {
		t.Fatalf("unexpected failure must be a generic JSON 500, got %d %v", rec.Code, got)
	}
	if strings.Contains(rec.Body.String(), "secret-backend-detail") {
		t.Fatal("internal error text leaked to the client")
	}
}

type brokenStore struct{ store.Memory }

func (*brokenStore) Get(context.Context, string) ([]byte, error) {
	return nil, fmt.Errorf("secret-backend-detail")
}
func (*brokenStore) List(context.Context, string) ([]string, error) { return nil, nil }
func (*brokenStore) Kind() string                                   { return "broken" }

func TestRoutingMethodsAndVercelRewrite(t *testing.T) {
	h := New(Options{Logger: quiet()})
	// Vercel rewrites /api/(.*) to the single function and passes the route.
	rec, got := call(h, "GET", "/api/index?__route=health", nil, "")
	if rec.Code != 200 || got["status"] != "ok" || got["engine"] != terrain.Engine {
		t.Fatalf("rewritten route failed: %d %v", rec.Code, got)
	}
	rec, got = call(h, "GET", "/api/index?__route=does/not/exist", nil, "")
	if rec.Code != 404 || got["error"] != "Unknown API endpoint." || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("unknown API paths must be JSON 404, never HTML: %d %s", rec.Code, rec.Body.String())
	}
	rec, _ = call(h, "POST", "/api/index?__route=terrain", map[string]any{"latitude": -89.5, "longitude": 45, "radius_km": 1, "mode": "synthetic", "quality": "low"}, "")
	if rec.Code != 200 {
		t.Fatalf("rewritten POST failed: %d", rec.Code)
	}
	for _, c := range []struct {
		method, path string
		status       int
	}{{"GET", "/api/terrain", 405}, {"PUT", "/api/health", 405}, {"POST", "/api/sources", 405}, {"GET", "/api", 404}, {"GET", "/api/", 404},
		{"GET", "/api/../etc/passwd", 404}, {"GET", "/api/health/", 200}, {"HEAD", "/api/health", 200}, {"OPTIONS", "/api/terrain", 204}} {
		if rec, _ := call(h, c.method, c.path, nil, ""); rec.Code != c.status {
			t.Fatalf("%s %s -> %d, want %d", c.method, c.path, rec.Code, c.status)
		}
	}
	// A JSON body with the wrong media type is not parsed (CSRF hardening, Flask parity).
	rec, _ = call(h, "POST", "/api/terrain", `{"mode":"synthetic","latitude":-89.5,"longitude":45,"radius_km":1}`, "text/plain")
	if rec.Code != 400 {
		t.Fatalf("text/plain body accepted: %d", rec.Code)
	}
	if rec, _ := call(h, "GET", "/api/health", nil, ""); rec.Header().Get("Content-Security-Policy") == "" || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("security headers missing: %v", rec.Header())
	}
}

func TestRateLimitIsPerClientAndRoute(t *testing.T) {
	now := time.Date(2026, 11, 14, 0, 0, 0, 0, time.UTC)
	h := New(Options{Logger: quiet(), RateLimit: true, Now: func() time.Time { return now }})
	body := map[string]any{"latitude": -89.5, "longitude": 45, "radius_km": 1, "mode": "synthetic", "quality": "low", "az_step_deg": 15}
	limited := 0
	for i := 0; i < 95; i++ {
		rec, _ := call(h, "POST", "/api/horizon", body, "")
		if rec.Code == 429 {
			limited++
			if rec.Header().Get("Retry-After") == "" {
				t.Fatal("429 without Retry-After")
			}
		}
	}
	if limited != 5 {
		t.Fatalf("expected 5 throttled requests, got %d", limited)
	}
	if rec, _ := call(h, "GET", "/api/health", nil, ""); rec.Code != 200 {
		t.Fatal("cheap routes must not be throttled")
	}
	now = now.Add(61 * time.Second)
	if rec, _ := call(h, "POST", "/api/horizon", body, ""); rec.Code != 200 {
		t.Fatalf("window did not reset: %d", rec.Code)
	}
}

// A caller must not be able to dodge its limit, or grow the limiter without
// bound, by inventing X-Forwarded-For values. The header is trusted only on
// Vercel, where the platform sets it.
func TestRateLimitIgnoresSpoofedForwardedFor(t *testing.T) {
	now := time.Date(2026, 11, 14, 0, 0, 0, 0, time.UTC)
	body := `{"latitude":-89.5,"longitude":45,"radius_km":1,"mode":"synthetic","quality":"low","az_step_deg":15}`
	post := func(h http.Handler, forwarded string) int {
		req := httptest.NewRequest("POST", "/api/horizon", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Forwarded-For", forwarded)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	count := func(deployment string) (limited int, tracked int) {
		h := New(Options{Logger: quiet(), RateLimit: true, Deployment: deployment, Now: func() time.Time { return now }})
		for i := 0; i < 95; i++ {
			if post(h, fmt.Sprintf("203.0.113.%d", i)) == 429 {
				limited++
			}
		}
		return limited, len(h.(*server).windows)
	}
	if limited, tracked := count("local"); limited != 5 || tracked != 1 {
		t.Fatalf("standalone server: a rotating X-Forwarded-For must count as one client (throttled %d, tracked %d)", limited, tracked)
	}
	if limited, tracked := count("vercel"); limited != 0 || tracked != 95 {
		t.Fatalf("on Vercel the platform-set header identifies distinct clients (throttled %d, tracked %d)", limited, tracked)
	}
}

func TestRateLimitTableIsBounded(t *testing.T) {
	now := time.Date(2026, 11, 14, 0, 0, 0, 0, time.UTC)
	s := New(Options{Logger: quiet(), RateLimit: true, Now: func() time.Time { return now }}).(*server)
	for i := 0; i < 3*maxRateWindows; i++ {
		s.throttle(fmt.Sprintf("client-%d /api/horizon", i), 90)
		if len(s.windows) > maxRateWindows {
			t.Fatalf("limiter table grew to %d entries after %d distinct clients", len(s.windows), i+1)
		}
	}
	// Expired windows are pruned in preference to clearing live ones: fill the table to one
	// short of the bound with windows that will have expired, keep one live client, then
	// push it over the bound.
	s.windows = map[string]*rateWindow{}
	for i := 0; i < maxRateWindows-2; i++ {
		s.throttle(fmt.Sprintf("old-%d", i), 90)
	}
	now = now.Add(30 * time.Second)
	s.throttle("recent", 90)
	s.throttle("recent", 90)
	now = now.Add(31 * time.Second)
	s.throttle("filler", 90)   // table is now exactly at the bound
	s.throttle("newcomer", 90) // triggers the prune
	if got := s.windows["recent"]; got == nil || got.count != 2 || len(s.windows) != 3 {
		t.Fatalf("pruning should drop expired windows and keep live counts: %d entries, recent=%+v", len(s.windows), got)
	}
}

// What the API says about storage decides what the interface tells the user
// about an acquired dataset's lifetime, so it must be true on each platform.
func TestStorageDurabilityIsReportedTruthfully(t *testing.T) {
	root := t.TempDir()
	cases := []struct {
		name       string
		env        map[string]string
		kind       string
		persistent bool
	}{
		{"local server", map[string]string{}, "local", true},
		{"Vercel without a Blob store", map[string]string{"VERCEL": "1"}, "local", false},
		{"Vercel with an explicit data directory", map[string]string{"VERCEL": "1", "CHANDRA_DATA_DIR": filepath.Join(root, "chosen")}, "local", false},
		{"Vercel with a Blob store", map[string]string{"VERCEL": "1", "BLOB_READ_WRITE_TOKEN": "vercel_blob_rw_test_token"}, "vercel-blob", true},
		{"memory store", map[string]string{"CHANDRA_STORE": "memory"}, "memory", false},
	}
	for _, c := range cases {
		opts, err := FromEnv(func(k string) string { return c.env[k] }, root)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		opts.Logger = quiet()
		rec, got := call(New(opts), "GET", "/api/config", nil, "")
		storage, _ := got["storage"].(map[string]any)
		if rec.Code != 200 || storage["kind"] != c.kind || storage["persistent"] != c.persistent {
			t.Fatalf("%s: storage %v, want kind %q persistent %v", c.name, storage, c.kind, c.persistent)
		}
		if strings.Contains(rec.Body.String(), "vercel_blob_rw_test_token") {
			t.Fatalf("%s: the Blob token leaked into /api/config", c.name)
		}
	}
}

func TestSourcesAndDatasetsAndMetadata(t *testing.T) {
	h := New(Options{Settings: planeSettings(), Logger: quiet(), AcquireEnabled: true, HorizonsEnabled: true})
	rec, got := call(h, "GET", "/api/sources", nil, "")
	if rec.Code != 200 || len(got["sources"].([]any)) < 15 || len(got["csa"].([]any)) < 8 || got["runtime"].(map[string]any)["engine"] != terrain.Engine {
		t.Fatalf("catalogue incomplete: %d", rec.Code)
	}
	for _, raw := range got["sources"].([]any) {
		s := raw.(map[string]any)
		for _, field := range []string{"provider", "product_name", "product_id", "version", "spatial_resolution", "coverage", "coordinate_system", "reference_frame",
			"vertical_datum", "publication_date", "retrieval_date", "attribution", "usage_terms", "documentation_url", "availability"} {
			if _, present := s[field]; !present {
				t.Fatalf("source %v lacks the %s field (unknown must be explicit null)", s["id"], field)
			}
		}
		if s["data_kind"] == "imagery" && s["integration"] == "acquire" {
			t.Fatalf("imagery source %v is marked as an elevation product", s["id"])
		}
	}
	for _, raw := range got["csa"].([]any) {
		if raw.(map[string]any)["classification"] != "mission-reference" {
			t.Fatal("CSA entries must be classified as mission reference")
		}
	}
	rec, got = call(h, "GET", "/api/datasets", nil, "")
	list := got["datasets"].([]any)
	first := list[0].(map[string]any)
	if rec.Code != 200 || first["id"] != "configured" || first["ready"] != true || first["frame"].(map[string]any)["recognized"] != false {
		t.Fatalf("datasets wrong: %v", first)
	}
	products := got["acquisition"].(map[string]any)["products"].([]any)
	if len(products) != len(lola.Products) {
		t.Fatal("acquisition products not listed")
	}
	var builtInProduct map[string]any
	for _, raw := range products {
		p := raw.(map[string]any)
		if p["id"] == lola.LDEM80S20M.ID {
			builtInProduct = p
		}
	}
	if builtInProduct == nil || builtInProduct["nominal_resolution_m"] != "20" || !strings.Contains(builtInProduct["coverage_note"].(string), "does not provide global or far-side coverage") {
		t.Fatalf("product resolution/coverage metadata missing or misleading: %v", builtInProduct)
	}
	configured := lola.Product{
		ID: "test-global", URL: "https://pds-geosciences.wustl.edu/lunar/test.tif",
		ProductPage: "https://pds-geosciences.wustl.edu/lunar/test/", Provider: "NASA PDS test manifest",
		CoverageNote: "Operator-verified test footprint", NominalResolutionM: 118, Configured: true,
		Assumptions: map[string]any{"vertical_unit": "m", "value_kind": "elevation", "elevation_reference": "fixture", "elevation_reference_radius_m": 1737400.0, "lunar_reference_frame": "MOON_ME (JPL DE421)"},
	}
	hConfigured := New(Options{Settings: planeSettings(), Logger: quiet(), ProductCatalogue: map[string]lola.Product{configured.ID: configured}})
	_, configuredResponse := call(hConfigured, "GET", "/api/datasets", nil, "")
	configuredProducts := configuredResponse["acquisition"].(map[string]any)["products"].([]any)
	if len(configuredProducts) != 1 || configuredProducts[0].(map[string]any)["id"] != configured.ID || configuredProducts[0].(map[string]any)["nominal_resolution_m"] != "118" {
		t.Fatalf("operator-configured product was not exposed from its validated catalogue: %v", configuredProducts)
	}
	rec, got = call(h, "GET", "/api/terrain/metadata", nil, "")
	elig := got["eligibility"].(map[string]any)
	if rec.Code != 200 || got["dataset_id"] != "configured" || elig["synthetic"] != true || elig["quantitative_candidate"] != false ||
		got["raster"].(map[string]any)["width"].(float64) != 401 || len(got["georeferencing"].(map[string]any)["footprint"].([]any)) != 5 {
		t.Fatalf("metadata wrong: %v", got)
	}
	centre := got["georeferencing"].(map[string]any)["footprint"].([]any)[4].(map[string]any)
	if math.Abs(centre["latitude"].(float64)+89.5) > 1e-6 || math.Abs(centre["longitude"].(float64)-45) > 1e-4 {
		t.Fatalf("footprint centre %v", centre)
	}
	for _, bad := range []string{"../../etc/passwd", "a", "UPPER", "x/../../y", strings.Repeat("a", 200)} {
		if rec, _ := call(h, "GET", "/api/terrain/metadata?dataset_id="+bad, nil, ""); rec.Code != 400 {
			t.Fatalf("dataset id %q -> %d", bad, rec.Code)
		}
	}
	rec, got = call(New(Options{Logger: quiet()}), "GET", "/api/terrain/metadata", nil, "")
	if rec.Code != 400 || !strings.Contains(got["error"].(string), "No DEM configured") {
		t.Fatalf("metadata without a DEM: %d %v", rec.Code, got)
	}
}

func rangeMirror(t *testing.T) *httptest.Server {
	data, err := os.ReadFile(filepath.Join(golden, "dem", "extract_rough_spstere_20m.tif"))
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.ServeContent(w, r, "dem.tif", time.Unix(1700000000, 0), bytes.NewReader(data))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestAcquireWorkflowEndToEnd(t *testing.T) {
	mirror := rangeMirror(t)
	resolve := func(id string) (lola.Options, bool) {
		p, ok := lola.Products[id]
		p.URL = mirror.URL + "/data/LOLA_20mpp/SYNTHETIC.TIF"
		p.Assumptions = fixtureOptions()
		return lola.Options{Product: p, AllowLoopback: true}, ok
	}
	dir := t.TempDir()
	h := New(Options{Logger: quiet(), AcquireEnabled: true, ResolveProduct: resolve, Store: &store.Local{Root: dir}})
	site := map[string]any{"latitude": -89.5, "longitude": 45, "radius_km": 2}
	// 1) coverage check without pixel transfer
	dry := map[string]any{"dry_run": true}
	for k, v := range site {
		dry[k] = v
	}
	rec, got := call(h, "POST", "/api/terrain/acquire", dry, "")
	if rec.Code != 200 || got["dry_run"] != true || got["plan"].(map[string]any)["pixels"].(float64) != 292*292 || got["dataset"] != nil {
		t.Fatalf("dry run: %d %v", rec.Code, got)
	}
	// 2) acquisition
	rec, got = call(h, "POST", "/api/terrain/acquire", site, "")
	if rec.Code != 200 {
		t.Fatalf("acquire: %d %s", rec.Code, rec.Body.String())
	}
	ds := got["dataset"].(map[string]any)
	id := ds["id"].(string)
	if !strings.HasPrefix(id, lola.LDEM80S20M.ID+"-") || ds["ready"] != true || got["storage"].(map[string]any)["kind"] != "local" || len(got["sha256"].(string)) != 64 {
		t.Fatalf("acquired dataset: %v", ds)
	}
	prov := ds["source"].(map[string]any)["provenance"].(map[string]any)
	if prov["subset_provenance"].(map[string]any)["sha256"] != got["sha256"] || prov["source_url"] == nil {
		t.Fatalf("provenance missing: %v", prov)
	}
	// 3) the dataset is listed, inspectable and drives terrain + horizon with provenance attached
	_, listed := call(h, "GET", "/api/datasets", nil, "")
	if n := len(listed["datasets"].([]any)); n != 2 {
		t.Fatalf("%d datasets listed", n)
	}
	rec, meta := call(h, "GET", "/api/terrain/metadata?dataset_id="+id, nil, "")
	if rec.Code != 200 || meta["raster"].(map[string]any)["width"].(float64) != 292 {
		t.Fatalf("metadata for acquired dataset: %d", rec.Code)
	}
	req := map[string]any{"dataset_id": id, "quality": "low", "az_step_deg": 5}
	for k, v := range site {
		req[k] = v
	}
	direct, _ := terrain.ExtractHorizon(terrain.SettingsOpener(&terrain.Settings{DEMPath: filepath.Join(golden, "dem", "extract_rough_spstere_20m.tif"), Options: fixtureOptions()}),
		terrain.Request{"latitude": -89.5, "longitude": 45.0, "radius_km": 2.0, "quality": "low", "az_step_deg": 5.0})
	rec, hz := call(h, "POST", "/api/horizon", req, "")
	if rec.Code != 200 || hz["synthetic"] != true || hz["mean_coverage_percent"].(float64) != direct.MeanCoveragePercent ||
		hz["source"].(map[string]any)["dataset_id"] != id || hz["source"].(map[string]any)["provenance"] == nil || hz["processing"] == nil {
		t.Fatalf("horizon from acquired dataset: %d %v", rec.Code, hz["source"])
	}
	// identical to the horizon computed straight from the source raster
	for i, v := range hz["elevations_deg"].([]any) {
		if v.(float64) != direct.ElevationsDeg[i] {
			t.Fatalf("bin %d differs between subset and source", i)
		}
	}
	// 4) files really are in the store directory, and nowhere else
	if files, _ := filepath.Glob(filepath.Join(dir, "datasets", "*")); len(files) != 2 {
		t.Fatalf("store contains %v", files)
	}
	// 5) failures: arbitrary URLs, unknown products, outside coverage, disabled deployments
	for body, fragment := range map[string]string{
		`{"latitude":-89.5,"longitude":45,"radius_km":2,"url":"https://evil.example/x.tif"}`: "Arbitrary download URLs",
		`{"latitude":-89.5,"longitude":45,"radius_km":2,"product_id":"nope"}`:                "Unknown product_id",
		`{"latitude":-89.5,"longitude":45,"radius_km":6}`:                                    "extends outside",
		`{"latitude":-95,"longitude":45,"radius_km":2}`:                                      "Latitude must be",
	} {
		rec, got := call(h, "POST", "/api/terrain/acquire", body, "application/json")
		if rec.Code != 400 || !strings.Contains(got["error"].(string), fragment) {
			t.Fatalf("%s -> %d %v", body, rec.Code, got)
		}
	}
	rec, got = call(New(Options{Logger: quiet()}), "POST", "/api/terrain/acquire", site, "")
	if rec.Code != 503 || got["code"] != "acquisition_disabled" {
		t.Fatalf("disabled acquisition: %d %v", rec.Code, got)
	}
	rec, got = call(h, "POST", "/api/terrain", map[string]any{"latitude": -89.5, "longitude": 45, "radius_km": 2, "dataset_id": "lola-ldem-80s-20mpp-adj-000000000000"}, "")
	if rec.Code != 400 || !strings.Contains(got["error"].(string), "Unknown dataset") {
		t.Fatalf("unknown dataset: %d %v", rec.Code, got)
	}
}

func horizonsMirror(t *testing.T, fail *bool) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if *fail {
			http.Error(w, "down for maintenance", http.StatusServiceUnavailable)
			return
		}
		name := "sun"
		if r.URL.Query().Get("COMMAND") == "'399'" {
			name = "earth"
		}
		raw, err := os.ReadFile("../horizons/testdata/" + name + "_shackleton-me_2026-12_720m.partial.txt")
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		w.Write(raw)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestEphemerisVerifyWithRecordedHorizons(t *testing.T) {
	down := false
	mirror := horizonsMirror(t, &down)
	h := New(Options{Logger: quiet(), HorizonsEnabled: true, Horizons: &horizons.Client{BaseURL: mirror.URL}})
	req := map[string]any{"site": map[string]any{"frame": "MOON_ME", "east_longitude_deg": 359.450513, "latitude_deg": -89.900807, "altitude_km": -1.2},
		"targets": []string{"sun", "earth"}, "start_utc": "2026-12-01T00:00:00Z", "step_minutes": 720, "samples": 42}
	rec, got := call(h, "POST", "/api/ephemeris/verify", req, "")
	if rec.Code != 200 {
		t.Fatalf("verify: %d %s", rec.Code, rec.Body.String())
	}
	targets := got["targets"].(map[string]any)
	sun, earth := targets["sun"].(map[string]any), targets["earth"].(map[string]any)
	if sun["body_id"] != "10" || earth["body_id"] != "399" || sun["center_frame"] != "MEAN_ME (high precision)" || sun["ephemeris_source"] != "DE441" ||
		len(sun["rows"].([]any)) != 42 || sun["cache"] != "miss" || !strings.Contains(sun["request_url"].(string), "coord%40301") {
		t.Fatalf("reference data wrong: %v", sun["target_name"])
	}
	row := earth["rows"].([]any)[34].(map[string]any)
	if row["utc"] != "2026-12-18T00:00:00.000Z" || row["elevation_deg"].(float64) != 4.321489297 || row["range_km"].(float64) != 3.8535200309e5 {
		t.Fatalf("recorded Earth row changed: %v", row)
	}
	if _, again := call(h, "POST", "/api/ephemeris/verify", req, ""); again["targets"].(map[string]any)["sun"].(map[string]any)["cache"] != "hit" {
		t.Fatal("repeat verification must be served from cache")
	}
	// The local service keeps working and reports the outage honestly.
	down = true
	req["samples"] = 5
	rec, got = call(h, "POST", "/api/ephemeris/verify", req, "")
	if rec.Code != 502 || got["code"] != "horizons_upstream" || !strings.Contains(got["error"].(string), "503") {
		t.Fatalf("outage: %d %v", rec.Code, got)
	}
	if rec, _ := call(h, "POST", "/api/terrain", map[string]any{"latitude": -89.5, "longitude": 45, "radius_km": 1, "mode": "synthetic", "quality": "low"}, ""); rec.Code != 200 {
		t.Fatal("terrain must be unaffected by a Horizons outage")
	}
	down = false
	bad := []map[string]any{
		{"site": map[string]any{"frame": "IAU_MOON", "east_longitude_deg": 0.0, "latitude_deg": -89.9, "altitude_km": -1.2}, "start_utc": "2026-12-01T00:00:00Z", "step_minutes": 60, "samples": 3},
		{"site": map[string]any{"frame": "MOON_ME", "east_longitude_deg": 0.0, "latitude_deg": -95.0, "altitude_km": 0.0}, "start_utc": "2026-12-01T00:00:00Z", "step_minutes": 60, "samples": 3},
		{"site": map[string]any{"frame": "MOON_ME", "east_longitude_deg": 0.0, "latitude_deg": -89.9, "altitude_km": 0.0}, "start_utc": "yesterday", "step_minutes": 60, "samples": 3},
		{"site": map[string]any{"frame": "MOON_ME", "east_longitude_deg": 0.0, "latitude_deg": -89.9, "altitude_km": 0.0}, "start_utc": "2026-12-01T00:00:00Z", "step_minutes": 60, "samples": 100000},
		{"site": map[string]any{"frame": "MOON_ME", "east_longitude_deg": 0.0, "latitude_deg": -89.9, "altitude_km": 0.0}, "start_utc": "2026-12-01T00:00:00Z", "step_minutes": 60, "samples": 3, "targets": []string{"mars"}},
		{"site": "nope", "start_utc": "2026-12-01T00:00:00Z", "step_minutes": 60, "samples": 3},
	}
	for i, b := range bad {
		if rec, _ := call(h, "POST", "/api/ephemeris/verify", b, ""); rec.Code != 400 {
			t.Fatalf("bad verify request %d -> %d", i, rec.Code)
		}
	}
	rec, got = call(New(Options{Logger: quiet()}), "POST", "/api/ephemeris/verify", req, "")
	if rec.Code != 503 || got["code"] != "horizons_disabled" {
		t.Fatalf("disabled Horizons: %d %v", rec.Code, got)
	}
}

func TestStaticConsoleNeverMasksAPIOrLeaksFiles(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("<!doctype html><title>CHANDRA</title>"), 0o644)
	os.MkdirAll(filepath.Join(dir, "assets"), 0o755)
	os.WriteFile(filepath.Join(dir, "assets", "app.js"), []byte("console.log(1)"), 0o644)
	secret := filepath.Join(filepath.Dir(dir), "secret.txt")
	os.WriteFile(secret, []byte("top secret"), 0o600)
	defer os.Remove(secret)
	h := New(Options{Logger: quiet(), StaticDir: dir})
	for path, want := range map[string]int{"/": 200, "/assets/app.js": 200, "/some/client/route": 200, "/assets/missing.js": 404,
		"/../secret.txt": 404, "/..%2fsecret.txt": 404, "/api/nope": 404} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "http://x"+path, nil)
		h.ServeHTTP(rec, req)
		if rec.Code != want || strings.Contains(rec.Body.String(), "top secret") {
			t.Fatalf("GET %s -> %d (want %d): %s", path, rec.Code, want, rec.Body.String())
		}
		if strings.HasPrefix(path, "/api/") && strings.Contains(rec.Body.String(), "<!doctype") {
			t.Fatal("an API path returned the HTML shell")
		}
	}
}

func TestFromEnvRejectsUnsafeOverrides(t *testing.T) {
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	if _, err := FromEnv(env(map[string]string{"CHANDRA_HORIZONS_BASE_URL": "https://evil.example/api"}), t.TempDir()); err == nil {
		t.Fatal("non-allowlisted Horizons override accepted")
	}
	if _, err := FromEnv(env(map[string]string{"CHANDRA_LOLA_BASE_URL": "https://evil.example/"}), t.TempDir()); err == nil {
		t.Fatal("non-allowlisted LOLA override accepted")
	}
	o, err := FromEnv(env(map[string]string{"VERCEL": "1", "CHANDRA_HORIZONS": "off"}), t.TempDir())
	if err != nil || o.Deployment != "vercel" || o.HorizonsEnabled || !o.AcquireEnabled || o.Store.Kind() != "local" {
		t.Fatalf("vercel defaults wrong: %+v %v", o, err)
	}
	o, _ = FromEnv(env(map[string]string{"BLOB_READ_WRITE_TOKEN": "vercel_blob_rw_test"}), t.TempDir())
	if o.Store.Kind() != "vercel-blob" || !o.Store.Persistent() {
		t.Fatalf("blob token did not select the blob store: %s", o.Store.Kind())
	}
}
