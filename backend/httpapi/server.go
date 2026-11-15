// Package httpapi is CHANDRA's native HTTP API (the replacement for the Flask
// app). One handler serves every route, so it runs unchanged as a local server
// (cmd/chandra-api) and as a single Vercel Go function (api/index.go).
//
// Compatibility: GET /api/health, /api/examples, /api/config and POST
// /api/terrain, /api/horizon keep the v1.11 contract (additive fields only).
// New: GET /api/sources, /api/datasets, /api/terrain/metadata and POST
// /api/terrain/acquire, /api/ephemeris/verify.
package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"chandra/backend/catalog"
	"chandra/backend/frames"
	"chandra/backend/horizons"
	"chandra/backend/lola"
	"chandra/backend/store"
	"chandra/backend/terrain"
)

// APIVersion identifies the HTTP contract (v1 = Flask-compatible baseline).
const APIVersion = "1.1"

// Options configures a handler. The zero value is a working synthetic-only API.
type Options struct {
	Settings        *terrain.Settings
	Store           store.Store
	Horizons        *horizons.Client
	HorizonsEnabled bool
	AcquireEnabled  bool
	// ResolveProduct maps a catalogue product id to acquisition options.
	ResolveProduct func(id string) (lola.Options, bool)
	RateLimit      bool
	Logger         *log.Logger
	StaticDir      string // optional: serve the built console (standalone server)
	ProjectRoot    string
	Deployment     string
	Now            func() time.Time
}

var examples = []map[string]any{
	{"label": "South-pole example", "latitude": -89.5, "longitude": 45, "radius_km": 5,
		"notes": "Default prototype example; supported by the optional NASA LOLA subset."},
	{"label": "Near-pole inspection", "latitude": -89.9, "longitude": 0, "radius_km": 2,
		"notes": "Shackleton vicinity; download a separate covered subset."},
	{"label": "Exact south pole", "latitude": -90, "longitude": 45, "radius_km": 1,
		"notes": "Longitude defines the chosen local meridian at the pole."},
	{"label": "North-pole reference", "latitude": 89.5, "longitude": 45, "radius_km": 5,
		"notes": "Requires a north-pole DEM; the included NASA downloader targets the south pole."},
}

type server struct {
	o       Options
	sem     chan struct{}
	mu      sync.Mutex
	windows map[string]*rateWindow
}

type rateWindow struct {
	start time.Time
	count int
}

type httpError struct {
	status  int
	message string
	code    string
}

func (e *httpError) Error() string { return e.message }

// New builds the API handler.
func New(o Options) http.Handler {
	if o.Settings == nil {
		o.Settings = &terrain.Settings{DatasetID: "configured"}
	}
	if o.Settings.DatasetID == "" {
		o.Settings.DatasetID = "configured"
	}
	if o.Store == nil {
		o.Store = store.NewMemory()
	}
	if o.Logger == nil {
		o.Logger = log.New(os.Stderr, "chandra-api ", log.LstdFlags)
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.Horizons == nil {
		o.Horizons = &horizons.Client{MinInterval: 600 * time.Millisecond}
	}
	if o.ResolveProduct == nil {
		o.ResolveProduct = func(id string) (lola.Options, bool) {
			p, ok := lola.Products[id]
			return lola.Options{Product: p}, ok
		}
	}
	if o.Deployment == "" {
		o.Deployment = "local"
	}
	return &server{o: o, sem: make(chan struct{}, 4), windows: map[string]*rateWindow{}}
}

type route struct {
	method  string
	handler func(*server, *http.Request) (any, error)
	limit   int           // requests per minute per client (0 = unlimited)
	heavy   bool          // bounded by the concurrency semaphore
	timeout time.Duration // execution limit
	cache   string        // Cache-Control
}

var routes = map[string]route{
	"/api/health":           {method: "GET", handler: (*server).health, cache: "no-store"},
	"/api/examples":         {method: "GET", handler: (*server).examples, cache: "public, max-age=300"},
	"/api/config":           {method: "GET", handler: (*server).config, cache: "no-store"},
	"/api/terrain":          {method: "POST", handler: (*server).terrain, limit: 90, heavy: true, timeout: 50 * time.Second, cache: "no-store"},
	"/api/horizon":          {method: "POST", handler: (*server).horizon, limit: 90, heavy: true, timeout: 50 * time.Second, cache: "no-store"},
	"/api/sources":          {method: "GET", handler: (*server).sources, cache: "public, max-age=300"},
	"/api/datasets":         {method: "GET", handler: (*server).datasets, cache: "no-store"},
	"/api/terrain/metadata": {method: "GET", handler: (*server).metadata, limit: 120, cache: "no-store"},
	"/api/terrain/acquire":  {method: "POST", handler: (*server).acquire, limit: 12, heavy: true, timeout: 55 * time.Second, cache: "no-store"},
	"/api/ephemeris/verify": {method: "POST", handler: (*server).verify, limit: 20, timeout: 50 * time.Second, cache: "no-store"},
}

func (s *server) writeJSON(w http.ResponseWriter, status int, body any) {
	h := w.Header()
	h.Set("Content-Type", "application/json")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
	if h.Get("Cache-Control") == "" {
		h.Set("Cache-Control", "no-store")
	}
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(body); err != nil {
		s.o.Logger.Printf("response encoding failed: %v", err)
	}
}

func (s *server) fail(w http.ResponseWriter, status int, message string) {
	s.writeJSON(w, status, map[string]string{"error": message})
}

// apiPath resolves the logical API path, including Vercel rewrites that pass
// the original path as ?__route=.
func apiPath(r *http.Request) string {
	p := r.URL.Path
	if route := r.URL.Query().Get("__route"); route != "" && (p == "/api/index" || p == "/api" || p == "/api/") {
		p = "/api/" + strings.TrimPrefix(route, "/")
	}
	if len(p) > 1 {
		p = strings.TrimRight(p, "/")
	}
	return p
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := apiPath(r)
	if path != "/api" && !strings.HasPrefix(path, "/api/") {
		s.static(w, r)
		return
	}
	defer func() {
		if rec := recover(); rec != nil {
			s.o.Logger.Printf("unhandled terrain API error on %s: %v", path, rec)
			s.fail(w, http.StatusInternalServerError, "Internal terrain error. Check the backend console for details.")
		}
	}()
	rt, ok := routes[path]
	if !ok {
		s.fail(w, http.StatusNotFound, "Unknown API endpoint.")
		return
	}
	switch {
	case r.Method == http.MethodOptions:
		w.Header().Set("Allow", rt.method+", OPTIONS")
		w.WriteHeader(http.StatusNoContent)
		return
	case r.Method == rt.method || (rt.method == "GET" && r.Method == http.MethodHead):
	default:
		w.Header().Set("Allow", rt.method+", OPTIONS")
		s.fail(w, http.StatusMethodNotAllowed, "Method not allowed for this endpoint.")
		return
	}
	if rt.limit > 0 && s.o.RateLimit {
		if wait := s.throttle(s.clientKey(r)+" "+path, rt.limit); wait > 0 {
			w.Header().Set("Retry-After", fmt.Sprint(int(wait.Seconds())+1))
			s.fail(w, http.StatusTooManyRequests, "Too many requests. Please wait a moment and retry.")
			return
		}
	}
	if rt.timeout > 0 {
		ctx, cancel := context.WithTimeout(r.Context(), rt.timeout)
		defer cancel()
		r = r.WithContext(ctx)
	}
	if rt.heavy {
		select {
		case s.sem <- struct{}{}:
			defer func() { <-s.sem }()
		case <-r.Context().Done():
			s.fail(w, http.StatusServiceUnavailable, "The terrain service is busy. Retry shortly.")
			return
		}
	}
	body, err := rt.handler(s, r)
	if err != nil {
		var te *terrain.Error
		var he *httpError
		var in *horizons.InputError
		var up *horizons.UpstreamError
		switch {
		case errors.As(err, &te):
			s.fail(w, http.StatusBadRequest, te.Message)
		case errors.As(err, &in):
			s.fail(w, http.StatusBadRequest, in.Message)
		case errors.As(err, &up):
			s.writeJSON(w, http.StatusBadGateway, map[string]string{"error": up.Message, "code": "horizons_upstream"})
		case errors.As(err, &he):
			if he.code != "" {
				s.writeJSON(w, he.status, map[string]string{"error": he.message, "code": he.code})
			} else {
				s.fail(w, he.status, he.message)
			}
		default:
			s.o.Logger.Printf("unhandled terrain API error on %s: %v", path, err)
			s.fail(w, http.StatusInternalServerError, "Internal terrain error. Check the backend console for details.")
		}
		return
	}
	w.Header().Set("Cache-Control", rt.cache)
	s.writeJSON(w, http.StatusOK, body)
}

// clientKey identifies the caller for rate limiting. X-Forwarded-For is only
// believed on Vercel, where the platform overwrites it with the client address;
// anywhere else the header is caller-controlled and would let one client pose
// as many, so the socket address is used instead.
func (s *server) clientKey(r *http.Request) string {
	if s.o.Deployment == "vercel" {
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			return strings.TrimSpace(strings.Split(fwd, ",")[0])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// maxRateWindows bounds the limiter's bookkeeping. Expired windows are pruned
// first; if live ones alone exceed the bound the table is cleared, which briefly
// forgets counts rather than letting memory grow with the number of callers.
const maxRateWindows = 4096

// throttle is a fixed one-minute window per client and route (per instance).
func (s *server) throttle(key string, limit int) time.Duration {
	now := s.o.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.windows) >= maxRateWindows {
		for k, w := range s.windows {
			if now.Sub(w.start) >= time.Minute {
				delete(s.windows, k)
			}
		}
		if len(s.windows) >= maxRateWindows {
			s.windows = map[string]*rateWindow{}
		}
	}
	w := s.windows[key]
	if w == nil || now.Sub(w.start) >= time.Minute {
		s.windows[key] = &rateWindow{start: now, count: 1}
		return 0
	}
	if w.count++; w.count > limit {
		return time.Minute - now.Sub(w.start)
	}
	return 0
}

// readObject decodes a bounded JSON object body, mirroring Flask's
// get_json(silent=True): anything that is not a JSON object is a 400.
func readObject(r *http.Request, hint string) (map[string]any, error) {
	if r.ContentLength > terrain.MaxRequestBytes {
		return nil, &httpError{status: http.StatusRequestEntityTooLarge, message: "Terrain request is too large."}
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, terrain.MaxRequestBytes+1))
	if err != nil {
		return nil, terrain.Errorf("%s", hint)
	}
	if len(raw) > terrain.MaxRequestBytes {
		return nil, &httpError{status: http.StatusRequestEntityTooLarge, message: "Terrain request is too large."}
	}
	media, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if media != "application/json" && !strings.HasSuffix(media, "+json") {
		return nil, terrain.Errorf("%s", hint)
	}
	var parsed any
	if json.Unmarshal(raw, &parsed) != nil {
		return nil, terrain.Errorf("%s", hint)
	}
	obj, ok := parsed.(map[string]any)
	if !ok {
		return nil, terrain.Errorf("%s", hint)
	}
	return obj, nil
}

// ---------------------------------------------------------------- compatible routes

func (s *server) health(*http.Request) (any, error) {
	return map[string]any{"status": "ok", "product": "CHANDRA Terrain Lab API", "engine": terrain.Engine, "api_version": APIVersion}, nil
}

func (s *server) examples(*http.Request) (any, error) {
	return map[string]any{"examples": examples}, nil
}

func (s *server) config(*http.Request) (any, error) {
	var source any
	var demError any
	if d, err := terrain.OpenDEM(s.o.Settings); err != nil {
		var te *terrain.Error
		if !errors.As(err, &te) {
			return nil, err
		}
		demError = te.Message
	} else {
		info := d.Info
		source = &info
		d.Close()
	}
	return map[string]any{
		"dem_ready": source != nil, "source": source, "dem_error": demError,
		"quality_grids": terrain.QualityGrids, "radius_limits_km": terrain.RadiusLimitsKm,
		"latitude_convention": terrain.LatitudeConvention, "longitude_convention": terrain.LongitudeConvention,
		"synthetic_warning": terrain.SyntheticWarning, "render_coordinates": terrain.RenderCoordinateConvention,
		"geometry_model": terrain.GeometryModel,
		// Additive (API 1.1)
		"engine": terrain.Engine, "api_version": APIVersion, "deployment": s.o.Deployment,
		"capabilities": map[string]any{"datasets": true, "sources": true, "metadata": true,
			"acquire": s.o.AcquireEnabled, "horizons": s.o.HorizonsEnabled},
		"storage": map[string]any{"kind": s.o.Store.Kind(), "persistent": s.o.Store.Persistent()},
	}, nil
}

const terrainHint = "Send a JSON object with latitude, longitude, radius_km, quality, and mode."

func (s *server) opener(body map[string]any) terrain.Opener {
	return func() (*terrain.DEM, error) {
		id, _ := body["dataset_id"].(string)
		if v, present := body["dataset_id"]; present && v != nil {
			if _, isString := v.(string); !isString {
				return nil, terrain.Errorf("dataset_id must be a string.")
			}
		}
		return s.openDataset(id)
	}
}

func (s *server) terrain(r *http.Request) (any, error) {
	body, err := readObject(r, terrainHint)
	if err != nil {
		return nil, err
	}
	return terrain.Build(s.opener(body), body)
}

func (s *server) horizon(r *http.Request) (any, error) {
	body, err := readObject(r, "Send a JSON object with latitude, longitude, radius_km, quality, mode, az_step_deg, eye_height_m.")
	if err != nil {
		return nil, err
	}
	return terrain.ExtractHorizon(s.opener(body), body)
}

// ---------------------------------------------------------------- datasets

var datasetID = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{2,90}$`)

func (s *server) openDataset(id string) (*terrain.DEM, error) {
	if id == "" || id == "configured" {
		return terrain.OpenDEM(s.o.Settings)
	}
	if !datasetID.MatchString(id) || strings.Contains(id, "..") {
		return nil, terrain.Errorf("Unknown dataset. List available datasets with GET /api/datasets.")
	}
	ctx := context.Background()
	rawConfig, err := s.o.Store.Get(ctx, "datasets/"+id+".json")
	if errors.Is(err, store.ErrNotFound) {
		return nil, terrain.Errorf("Unknown dataset %q. It may have expired from ephemeral storage; acquire it again or list datasets with GET /api/datasets.", id)
	}
	if err != nil {
		return nil, fmt.Errorf("dataset store: %w", err)
	}
	var options map[string]any
	if json.Unmarshal(rawConfig, &options) != nil {
		return nil, terrain.Errorf("Dataset %q has a corrupt configuration.", id)
	}
	tiff, err := s.o.Store.Get(ctx, "datasets/"+id+".tif")
	if err != nil {
		return nil, terrain.Errorf("Dataset %q has no raster in storage; acquire it again.", id)
	}
	return terrain.OpenReader(bytes.NewReader(tiff), int64(len(tiff)), id+".tif", options, id)
}

type datasetEntry struct {
	ID     string                 `json:"id"`
	Kind   string                 `json:"kind"`
	Ready  bool                   `json:"ready"`
	Source *terrain.SourceInfo    `json:"source"`
	Error  *string                `json:"error"`
	Frame  *frames.Classification `json:"frame,omitempty"`
}

func (s *server) describe(id, kind string) datasetEntry {
	e := datasetEntry{ID: id, Kind: kind}
	d, err := s.openDataset(id)
	if err != nil {
		msg := err.Error()
		e.Error = &msg
		return e
	}
	defer d.Close()
	info := d.Info
	c := frames.Classify(info.LunarReferenceFrame)
	e.Ready, e.Source, e.Frame = true, &info, &c
	return e
}

func (s *server) datasets(r *http.Request) (any, error) {
	list := []datasetEntry{s.describe("configured", "configured")}
	keys, err := s.o.Store.List(r.Context(), "datasets/")
	if err != nil {
		s.o.Logger.Printf("dataset listing failed: %v", err)
	}
	for _, k := range keys {
		if strings.HasSuffix(k, ".json") {
			list = append(list, s.describe(strings.TrimSuffix(strings.TrimPrefix(k, "datasets/"), ".json"), "acquired"))
		}
	}
	products := make([]map[string]string, 0, len(lola.Products))
	for _, p := range lola.Products {
		products = append(products, map[string]string{"id": p.ID, "url": p.URL, "product_page": p.ProductPage})
	}
	sort.Slice(products, func(i, j int) bool { return products[i]["id"] < products[j]["id"] })
	return map[string]any{"datasets": list,
		"storage":     map[string]any{"kind": s.o.Store.Kind(), "persistent": s.o.Store.Persistent()},
		"acquisition": map[string]any{"enabled": s.o.AcquireEnabled, "products": products, "max_subset_pixels": terrain.MaxSubsetPixels}}, nil
}

func (s *server) metadata(r *http.Request) (any, error) {
	id := r.URL.Query().Get("dataset_id")
	d, err := s.openDataset(id)
	if err != nil {
		return nil, err
	}
	defer d.Close()
	if id == "" {
		id = "configured"
	}
	f := d.File
	b := d.Bounds()
	corners := [][2]float64{{b[0], b[3]}, {b[2], b[3]}, {b[2], b[1]}, {b[0], b[1]}, {(b[0] + b[2]) / 2, (b[1] + b[3]) / 2}}
	footprint := make([]map[string]any, 0, len(corners))
	for i, c := range corners {
		lon, lat, ok := d.CRS.Inverse(c[0], c[1])
		entry := map[string]any{"corner": []string{"upper_left", "upper_right", "lower_right", "lower_left", "centre"}[i], "x": c[0], "y": c[1]}
		if ok {
			entry["latitude"], entry["longitude"] = lat, lon
		}
		footprint = append(footprint, entry)
	}
	var nodata any
	if f.HasNoData {
		if f.NoData != f.NoData {
			nodata = "nan"
		} else {
			nodata = f.NoData
		}
	}
	info := d.Info
	class := frames.Classify(info.LunarReferenceFrame)
	layout := "strips"
	if f.TileWidth > 0 {
		layout = fmt.Sprintf("tiles %dx%d", f.TileWidth, f.TileHeight)
	}
	notes := []string{}
	if info.Synthetic {
		notes = append(notes, "Raster is tagged as a synthetic software fixture: demonstration only, never a scientific result.")
	}
	if !class.Recognized {
		notes = append(notes, "Reference frame is not on the validated allowlist: viewable, but blocked from quantitative mission visibility.")
	}
	return map[string]any{
		"dataset_id": id, "source": &info,
		"raster": map[string]any{"width": f.Width, "height": f.Height, "bits_per_sample": f.BitsPerSample,
			"sample_format": [...]string{"", "unsigned integer", "signed integer", "IEEE float"}[f.SampleFormat], "compression": f.Compression,
			"predictor": f.Predictor, "layout": layout, "nodata": nodata, "overviews": f.Overviews, "gdal_tags": f.Tags},
		"georeferencing": map[string]any{"geotransform": d.GT, "bounds": map[string]float64{"left": b[0], "bottom": b[1], "right": b[2], "top": b[3]},
			"unit": d.CRS.UnitName(), "projection": d.CRS.Kind.String(), "geographic": d.CRS.IsGeographic(), "footprint": footprint},
		"frame": class,
		"eligibility": map[string]any{"frame_recognized": class.Recognized, "synthetic": info.Synthetic,
			"quantitative_candidate": class.Recognized && !info.Synthetic,
			"note":                   "Final eligibility also requires complete ray coverage and an epoch inside the validated frame interval; the mission engine enforces both.", "notes": notes},
		"validated_frame_interval_utc": []string{frames.ValidatedStartUTC, frames.ValidatedEndUTC},
	}, nil
}

// ---------------------------------------------------------------- catalogue

func (s *server) sources(*http.Request) (any, error) {
	var doc map[string]any
	if err := json.Unmarshal(catalog.Raw(), &doc); err != nil {
		return nil, err
	}
	doc["runtime"] = map[string]any{"deployment": s.o.Deployment, "engine": terrain.Engine,
		"horizons_enabled": s.o.HorizonsEnabled, "acquisition_enabled": s.o.AcquireEnabled,
		"storage": map[string]any{"kind": s.o.Store.Kind(), "persistent": s.o.Store.Persistent()}}
	return doc, nil
}

// ---------------------------------------------------------------- acquisition

func (s *server) acquire(r *http.Request) (any, error) {
	body, err := readObject(r, "Send a JSON object with product_id, latitude, longitude, radius_km and optional dry_run.")
	if err != nil {
		return nil, err
	}
	if !s.o.AcquireEnabled {
		return nil, &httpError{status: http.StatusServiceUnavailable, code: "acquisition_disabled",
			message: "Remote DEM acquisition is disabled on this deployment. Use the chandra-lola command locally, or load a DEM you downloaded yourself."}
	}
	// A URL is never accepted from the client: only allowlisted catalogue ids.
	for _, forbidden := range []string{"url", "source_url", "href"} {
		if _, present := body[forbidden]; present {
			return nil, terrain.Errorf("Arbitrary download URLs are not accepted. Choose a product_id from GET /api/datasets.")
		}
	}
	productID, _ := body["product_id"].(string)
	if productID == "" {
		productID = lola.LDEM80S20M.ID
	}
	opts, ok := s.o.ResolveProduct(productID)
	if !ok {
		return nil, terrain.Errorf("Unknown product_id. Choose one listed by GET /api/datasets.")
	}
	dryRun, _ := body["dry_run"].(bool)
	sub, err := lola.Acquire(r.Context(), opts, body["latitude"], body["longitude"], body["radius_km"], dryRun)
	if err != nil {
		if r.Context().Err() != nil {
			return nil, terrain.Errorf("DEM acquisition timed out; choose a smaller radius or retry.")
		}
		return nil, err
	}
	product := map[string]string{"id": opts.Product.ID, "url": opts.Product.URL, "product_page": opts.Product.ProductPage}
	if dryRun {
		return map[string]any{"dry_run": true, "plan": sub.Plan, "product": product}, nil
	}
	id := opts.Product.ID + "-" + sub.SHA256[:12]
	cfg, _ := json.MarshalIndent(sub.Config, "", "  ")
	if err := s.o.Store.Put(r.Context(), "datasets/"+id+".tif", sub.TIFF); err != nil {
		return nil, fmt.Errorf("dataset store: %w", err)
	}
	if err := s.o.Store.Put(r.Context(), "datasets/"+id+".json", cfg); err != nil {
		s.o.Store.Delete(r.Context(), "datasets/"+id+".tif") // never leave a raster without its provenance
		return nil, fmt.Errorf("dataset store: %w", err)
	}
	return map[string]any{"dry_run": false, "dataset": s.describe(id, "acquired"), "plan": sub.Plan, "product": product, "sha256": sub.SHA256,
		"bytes": len(sub.TIFF), "config": sub.Config, "storage": map[string]any{"kind": s.o.Store.Kind(), "persistent": s.o.Store.Persistent()}}, nil
}

// ---------------------------------------------------------------- Horizons

func (s *server) verify(r *http.Request) (any, error) {
	body, err := readObject(r, "Send a JSON object with site, targets, start_utc, step_minutes and samples.")
	if err != nil {
		return nil, err
	}
	if !s.o.HorizonsEnabled {
		return nil, &httpError{status: http.StatusServiceUnavailable, code: "horizons_disabled",
			message: "JPL Horizons verification is disabled on this deployment. The local simulation is unaffected."}
	}
	site, ok := body["site"].(map[string]any)
	if !ok {
		return nil, &horizons.InputError{Message: "site must be an object with frame, east_longitude_deg, latitude_deg and altitude_km."}
	}
	if frame, _ := site["frame"].(string); frames.Normalize(frame) != "MOONME" && frames.Normalize(frame) != "MEANME" {
		return nil, &horizons.InputError{Message: "site.frame must be \"MOON_ME\": Horizons lunar surface coordinates are MEAN_ME. Convert IAU 2015 coordinates first; frames are never mixed silently."}
	}
	num := func(m map[string]any, key string) (float64, error) {
		v, ok := m[key].(float64)
		if !ok {
			return 0, &horizons.InputError{Message: key + " must be a number."}
		}
		return v, nil
	}
	var q horizons.Query
	if q.LonE, err = num(site, "east_longitude_deg"); err != nil {
		return nil, err
	}
	if q.Lat, err = num(site, "latitude_deg"); err != nil {
		return nil, err
	}
	if q.AltKm, err = num(site, "altitude_km"); err != nil {
		return nil, err
	}
	startText, _ := body["start_utc"].(string)
	if q.Start, err = time.Parse(time.RFC3339, startText); err != nil {
		return nil, &horizons.InputError{Message: "start_utc must be an ISO-8601 UTC instant such as 2026-12-01T00:00:00Z."}
	}
	q.Start = q.Start.UTC()
	step, err := num(body, "step_minutes")
	if err != nil {
		return nil, err
	}
	samples, err := num(body, "samples")
	if err != nil {
		return nil, err
	}
	if step != float64(int(step)) || samples != float64(int(samples)) {
		return nil, &horizons.InputError{Message: "step_minutes and samples must be integers."}
	}
	q.StepMinutes, q.Samples = int(step), int(samples)
	targets := []string{"sun", "earth"}
	if list, ok := body["targets"].([]any); ok {
		targets = targets[:0]
		for _, t := range list {
			name, _ := t.(string)
			if _, known := horizons.Targets[name]; !known || len(targets) >= 2 {
				return nil, &horizons.InputError{Message: "targets may contain \"sun\" and \"earth\" only."}
			}
			targets = append(targets, name)
		}
	}
	if len(targets) == 0 {
		return nil, &horizons.InputError{Message: "at least one target is required."}
	}
	out := map[string]*horizons.Result{}
	for _, t := range targets {
		tq := q
		tq.Target = t
		res, err := s.o.Horizons.Fetch(r.Context(), tq)
		if err != nil {
			return nil, err
		}
		out[t] = res
	}
	return map[string]any{
		"service": map[string]any{"name": "NASA/JPL Horizons API", "documentation": horizons.DocsURL, "role": "independent verification source; not CHANDRA's ephemeris engine"},
		"site":    map[string]any{"frame": "MOON_ME (Horizons MEAN_ME)", "east_longitude_deg": q.LonE, "latitude_deg": q.Lat, "altitude_km": q.AltKm, "reference_sphere_km": horizons.MoonRadiusKm},
		"query":   map[string]any{"start_utc": q.Start.Format(time.RFC3339), "step_minutes": q.StepMinutes, "samples": q.Samples, "time_scale": "UT (UTC)"},
		"conventions": map[string]any{
			"angles":   "airless apparent azimuth (clockwise from north) and elevation: light-time, stellar aberration and gravitational deflection applied",
			"range":    "apparent range, km, observer site to target centre",
			"observer": "CENTER='coord@301', COORD_TYPE='GEODETIC' on the 1737.4 km sphere (geodetic = planetocentric latitude)",
			"terrain":  "none — Horizons geometry cannot verify the DEM obstruction model",
		},
		"targets": out,
		"limits":  map[string]any{"max_samples": horizons.MaxSamples, "cache_ttl_hours": 24},
	}, nil
}

// ---------------------------------------------------------------- static console

func (s *server) static(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		s.fail(w, http.StatusMethodNotAllowed, "Method not allowed for this endpoint.")
		return
	}
	clean := filepath.Clean("/" + r.URL.Path)
	if strings.HasPrefix(clean, "/screenshots/") && s.o.ProjectRoot != "" {
		http.ServeFile(w, r, filepath.Join(s.o.ProjectRoot, filepath.FromSlash(clean)))
		return
	}
	if s.o.StaticDir == "" {
		if clean == "/" {
			s.writeJSON(w, http.StatusOK, map[string]string{"product": "CHANDRA Terrain Lab API", "hint": "Run npm run build to serve the console here, or use the Vite dev server."})
			return
		}
		s.fail(w, http.StatusNotFound, "Not found.")
		return
	}
	target := filepath.Join(s.o.StaticDir, filepath.FromSlash(clean))
	if st, err := os.Stat(target); err == nil && !st.IsDir() {
		http.ServeFile(w, r, target)
		return
	}
	if filepath.Ext(clean) != "" { // a missing asset is a 404, never the HTML shell
		s.fail(w, http.StatusNotFound, "Not found.")
		return
	}
	index := filepath.Join(s.o.StaticDir, "index.html")
	if _, err := os.Stat(index); err != nil {
		s.writeJSON(w, http.StatusOK, map[string]string{"product": "CHANDRA Terrain Lab API", "hint": "Run npm run build to serve the console here, or use the Vite dev server."})
		return
	}
	http.ServeFile(w, r, index)
}

// FromEnv builds Options from the process environment (shared by the local
// server and the Vercel function). No secret is ever read into a response.
func FromEnv(getenv func(string) string, projectRoot string) (Options, error) {
	settings, err := terrain.LoadSettings(getenv("LUNAR_DEM_PATH"), getenv("LUNAR_DEM_CONFIG"), projectRoot)
	if err != nil {
		return Options{}, err
	}
	onVercel := getenv("VERCEL") != ""
	defaultDir := filepath.Join(projectRoot, "data", "acquired")
	deployment := "local"
	if onVercel {
		defaultDir, deployment = filepath.Join(os.TempDir(), "chandra-data"), "vercel"
	}
	st := store.FromEnv(getenv, defaultDir)
	if local, ok := st.(*store.Local); ok && onVercel {
		// Every writable path of a function instance is temporary, whatever directory was chosen.
		local.Ephemeral = true
	}
	o := Options{Settings: settings, Store: st, ProjectRoot: projectRoot, Deployment: deployment,
		HorizonsEnabled: getenv("CHANDRA_HORIZONS") != "off", AcquireEnabled: getenv("CHANDRA_ACQUIRE") != "off",
		RateLimit: getenv("CHANDRA_RATE_LIMIT") != "off"}
	client := &horizons.Client{MinInterval: 600 * time.Millisecond}
	if base := getenv("CHANDRA_HORIZONS_BASE_URL"); base != "" {
		if !horizons.AllowedBase(base) {
			return Options{}, fmt.Errorf("CHANDRA_HORIZONS_BASE_URL must be the official JPL endpoint or a loopback test server")
		}
		client.BaseURL = base
	}
	o.Horizons = client
	if base := getenv("CHANDRA_LOLA_BASE_URL"); base != "" {
		// Test hook: a loopback mirror of the PGDA directory layout. Never a user-facing option.
		if !lola.AllowedURL(base, true) {
			return Options{}, fmt.Errorf("CHANDRA_LOLA_BASE_URL must be an allowlisted or loopback URL")
		}
		o.ResolveProduct = func(id string) (lola.Options, bool) {
			p, ok := lola.Products[id]
			if ok {
				p.URL = strings.TrimRight(base, "/") + p.URL[strings.LastIndex(p.URL, "/"):]
			}
			return lola.Options{Product: p, AllowLoopback: true}, ok
		}
	}
	return o, nil
}
