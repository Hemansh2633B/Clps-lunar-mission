// Package lola acquires bounded regional subsets of NASA LOLA polar DEMs by HTTP
// range reads of the official cloud-optimised GeoTIFF. It never downloads the
// whole product, never accepts a user-supplied URL, and copies source samples,
// CRS and NoData verbatim (no resampling). Native port of the former
// backend/download_lola_subset.py.
package lola

import (
	"bytes"
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

	"chandra/backend/geotiff"
	"chandra/backend/lunarcrs"
	"chandra/backend/terrain"
)

// Product is an allowlisted remote elevation product.
type Product struct {
	ID          string
	URL         string
	ProductPage string
	// NominalResolutionM is the pixel scale encoded in the published product
	// name; the actual raster geotransform is still inspected per acquisition.
	NominalResolutionM float64
	// CoverageNote is deliberately descriptive, not a fabricated polygon. The
	// GeoTIFF CRS/geotransform is the authority for the exact footprint.
	CoverageNote string
	Provider     string
	Configured   bool // true only for a deployment-operator manifest entry
	Assumptions  map[string]any
}

// LDEM80S20M is NASA PGDA's 20 m/pixel LOLA south-polar mosaic (80°S to the pole).
var LDEM80S20M = Product{
	ID:                 "lola-ldem-80s-20mpp-adj",
	URL:                "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF",
	ProductPage:        "https://pgda.gsfc.nasa.gov/products/90",
	NominalResolutionM: 20,
	CoverageNote:       "South-polar LOLA mosaic; exact footprint is determined from the source GeoTIFF georeferencing. This product does not provide global or far-side coverage.",
	Provider:           "NASA LOLA · PDS Geosciences Node / PGDA",
	Assumptions: map[string]any{
		"vertical_unit": "m", "value_kind": "elevation",
		"elevation_reference":          "LOLA surface height relative to the 1737.4 km reference sphere; verify against product documentation before mission use",
		"elevation_reference_radius_m": 1_737_400.0,
		"lunar_reference_frame":        "MOON_ME (JPL DE421)",
	},
}

func sibling(id, file string) Product {
	p := LDEM80S20M
	p.ID, p.URL = id, "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/"+file
	for _, part := range strings.Split(id, "-") {
		if strings.HasSuffix(part, "mpp") {
			if resolution, err := strconv.ParseFloat(strings.TrimSuffix(part, "mpp"), 64); err == nil && resolution > 0 {
				p.NominalResolutionM = resolution
			}
		}
	}
	p.CoverageNote = "Southern-polar LOLA mosaic; exact footprint is determined from the source GeoTIFF georeferencing. This product does not provide global or far-side coverage."
	return p
}

// Products lists every acquirable product by id. All are members of the same
// PGDA product family (https://pgda.gsfc.nasa.gov/products/90): south polar
// stereographic COGs in MOON_ME (DE421), heights in metres.
var Products = map[string]Product{
	LDEM80S20M.ID:             LDEM80S20M,
	"lola-ldem-80s-40mpp-adj": sibling("lola-ldem-80s-40mpp-adj", "LDEM_80S_40MPP_ADJ.TIF"),
	"lola-ldem-80s-80mpp-adj": sibling("lola-ldem-80s-80mpp-adj", "LDEM_80S_80MPP_ADJ.TIF"),
	"lola-ldem-83s-10mpp-adj": sibling("lola-ldem-83s-10mpp-adj", "LDEM_83S_10MPP_ADJ.TIF"),
	"lola-ldem-75s-30mpp-adj": sibling("lola-ldem-75s-30mpp-adj", "LDEM_75S_30MPP_ADJ.TIF"),
}

// AllowedHosts are the only hosts raster bytes may be fetched from.
var AllowedHosts = map[string]bool{
	"pgda.gsfc.nasa.gov": true,
	// PDS Geosciences Node is an official public planetary data archive. A
	// deployment operator may register a specific range-capable GeoTIFF/COG
	// product from this host; browser clients still cannot submit URLs.
	"pds-geosciences.wustl.edu": true,
}

// AllowedURL enforces the host allowlist (https only). Loopback http is accepted
// only when explicitly enabled for tests.
func AllowedURL(raw string, allowLoopback bool) bool {
	u, err := url.Parse(raw)
	if err != nil || u.User != nil {
		return false
	}
	if u.Scheme == "https" && AllowedHosts[u.Host] {
		return true
	}
	host := u.Hostname()
	return allowLoopback && u.Scheme == "http" && (host == "127.0.0.1" || host == "localhost" || host == "::1")
}

// Limits for one acquisition.
const (
	chunkSize        = 256 << 10
	maxChunks        = 96
	DefaultMaxBytes  = 400 << 20
	DefaultMaxRanges = 6000
)

// RangeReader is an io.ReaderAt over HTTP byte ranges with a small aligned
// block cache and hard budgets on bytes and requests.
type RangeReader struct {
	Ctx       context.Context
	Client    *http.Client
	URL       string
	Size      int64
	MaxBytes  int64
	MaxRanges int

	ETag, LastModified string
	Fetched            int64
	Requests           int

	mu     sync.Mutex
	chunks map[int64][]byte
	order  []int64
}

// transportReason reduces a transport error to a short, non-identifying phrase.
func transportReason(ctx context.Context, err error) string {
	var netErr net.Error
	if ctx.Err() != nil || errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &netErr) && netErr.Timeout()) {
		return "timed out"
	}
	if errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.EOF) {
		return "connection closed early"
	}
	return "network error"
}

func (r *RangeReader) fetch(off, n int64) ([]byte, error) {
	if off < 0 || n <= 0 || off+n > r.Size {
		return nil, fmt.Errorf("range %d+%d is outside the %d-byte source", off, n, r.Size)
	}
	if r.Requests+1 > r.MaxRanges || r.Fetched+n > r.MaxBytes {
		return nil, errors.New("remote read budget exceeded; choose a smaller radius")
	}
	req, err := http.NewRequestWithContext(r.Ctx, http.MethodGet, r.URL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", off, off+n-1))
	req.Header.Set("User-Agent", "CHANDRA-lunar-mission-planner (bounded LOLA subset)")
	resp, err := r.Client.Do(req)
	if err != nil {
		// The transport error repeats the full URL and may name resolver or proxy
		// addresses of the host; a short reason is all a client needs.
		return nil, errors.New("the NASA DEM server could not be reached (" + transportReason(r.Ctx, err) + ")")
	}
	defer resp.Body.Close()
	r.Requests++
	want := fmt.Sprintf("bytes %d-%d/", off, off+n-1)
	cr := resp.Header.Get("Content-Range")
	if resp.StatusCode != http.StatusPartialContent || !strings.HasPrefix(cr, want) {
		return nil, fmt.Errorf("server did not honour range %d-%d (HTTP %d)", off, off+n-1, resp.StatusCode)
	}
	// Every range must come from the same object the header was read from: a
	// subset stitched from two versions of a file would be silently wrong.
	if total := strings.TrimPrefix(cr, want); total != "*" && total != strconv.FormatInt(r.Size, 10) {
		return nil, errors.New("the source file changed size during the download; nothing was kept, retry")
	}
	if tag := resp.Header.Get("ETag"); r.ETag != "" && tag != "" && tag != r.ETag {
		return nil, errors.New("the source file changed during the download; nothing was kept, retry")
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(resp.Body, buf); err != nil {
		return nil, errors.New("short range read (" + transportReason(r.Ctx, err) + ")")
	}
	r.Fetched += n
	return buf, nil
}

// ReadAt implements io.ReaderAt.
func (r *RangeReader) ReadAt(p []byte, off int64) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := int64(len(p))
	if n == 0 {
		return 0, nil
	}
	if off < 0 || off+n > r.Size {
		return 0, io.ErrUnexpectedEOF
	}
	if n > 4*chunkSize { // large block: one exact request, not cached
		buf, err := r.fetch(off, n)
		if err != nil {
			return 0, err
		}
		return copy(p, buf), nil
	}
	if r.chunks == nil {
		r.chunks = map[int64][]byte{}
	}
	for done := int64(0); done < n; {
		idx := (off + done) / chunkSize
		chunk, ok := r.chunks[idx]
		if !ok {
			size := min(int64(chunkSize), r.Size-idx*chunkSize)
			var err error
			if chunk, err = r.fetch(idx*chunkSize, size); err != nil {
				return int(done), err
			}
			if len(r.order) >= maxChunks {
				delete(r.chunks, r.order[0])
				r.order = r.order[1:]
			}
			r.chunks[idx] = chunk
			r.order = append(r.order, idx)
		}
		done += int64(copy(p[done:], chunk[off+done-idx*chunkSize:]))
	}
	return int(n), nil
}

// Options configures one acquisition.
type Options struct {
	Product       Product
	HTTP          *http.Client
	AllowLoopback bool // tests only: permit an http://127.0.0.1 source
	Now           func() time.Time
	MaxBytes      int64
	MaxRanges     int
}

func (o *Options) client() *http.Client {
	if o.HTTP != nil {
		return o.HTTP
	}
	allow := o.AllowLoopback
	return &http.Client{Timeout: 60 * time.Second, CheckRedirect: func(req *http.Request, _ []*http.Request) error {
		if !AllowedURL(req.URL.String(), allow) {
			return errors.New("redirect to a host outside the allowlist")
		}
		return nil
	}}
}

// OpenRemote probes range support and opens the remote raster header. A server
// that ignores range requests is refused before any large read: there is no
// full-raster fallback.
func OpenRemote(ctx context.Context, o Options) (*terrain.DEM, *RangeReader, error) {
	if !AllowedURL(o.Product.URL, o.AllowLoopback) {
		return nil, nil, terrain.Errorf("DEM source is not on the trusted-host allowlist.")
	}
	client := o.client()
	// The probe uses a distinct URL so an intermediary cannot reuse its 16-byte
	// Content-Length for later raster range reads.
	sep := "?"
	if strings.Contains(o.Product.URL, "?") {
		sep = "&"
	}
	probe, err := http.NewRequestWithContext(ctx, http.MethodGet, o.Product.URL+sep+"lunar_terrain_range_probe=1", nil)
	if err != nil {
		return nil, nil, terrain.Errorf("Cannot build the range probe: %v", err)
	}
	probe.Header.Set("Range", "bytes=0-15")
	resp, err := client.Do(probe)
	if err != nil {
		return nil, nil, terrain.Errorf("NASA DEM server is unreachable (%s). Nothing was downloaded.", transportReason(ctx, err))
	}
	defer resp.Body.Close()
	cr := resp.Header.Get("Content-Range")
	if resp.StatusCode != http.StatusPartialContent || cr == "" {
		return nil, nil, terrain.Errorf("NASA server did not honor HTTP range reads. Download a regional DEM separately; full-raster fallback is disabled.")
	}
	io.CopyN(io.Discard, resp.Body, 16)
	total, err := strconv.ParseInt(cr[strings.LastIndex(cr, "/")+1:], 10, 64)
	if err != nil || total < 16 {
		return nil, nil, terrain.Errorf("NASA server returned an unusable Content-Range (%q); the source size is required for bounded reads.", cr)
	}
	rr := &RangeReader{Ctx: ctx, Client: client, URL: o.Product.URL, Size: total, MaxBytes: o.MaxBytes, MaxRanges: o.MaxRanges,
		ETag: resp.Header.Get("ETag"), LastModified: resp.Header.Get("Last-Modified")}
	if rr.MaxBytes == 0 {
		rr.MaxBytes = DefaultMaxBytes
	}
	if rr.MaxRanges == 0 {
		rr.MaxRanges = DefaultMaxRanges
	}
	f, err := geotiff.Open(rr, total)
	if err != nil {
		return nil, nil, terrain.Errorf("Cannot read the remote DEM header: %v", err)
	}
	name := o.Product.URL[strings.LastIndex(o.Product.URL, "/")+1:]
	assumptions := make(map[string]any, len(o.Product.Assumptions)+6)
	for k, v := range o.Product.Assumptions {
		assumptions[k] = v
	}
	assumptions["product_id"] = o.Product.ID
	assumptions["source_url"] = o.Product.URL
	assumptions["product_page"] = o.Product.ProductPage
	if o.Product.Configured {
		assumptions["configured_product"] = true
		assumptions["provider"] = o.Product.Provider
		assumptions["coverage_note"] = o.Product.CoverageNote
		assumptions["nominal_resolution_m"] = o.Product.NominalResolutionM
	}
	d, err := terrain.Inspect(f, assumptions, name)
	if err != nil {
		return nil, nil, err
	}
	return d, rr, nil
}

// Plan is the bounded source window for a request, computed before any pixel
// data is fetched (coverage check).
type Plan struct {
	Latitude       float64 `json:"latitude"`
	Longitude      float64 `json:"longitude"`
	RadiusKm       float64 `json:"analysis_radius_km"`
	Window         [4]int  `json:"source_pixel_window"` // left, top, width, height
	Pixels         int     `json:"pixels"`
	EncodedBytes   uint64  `json:"estimated_download_bytes"`
	Blocks         int     `json:"source_blocks"`
	SourceWidth    int     `json:"source_width"`
	SourceHeight   int     `json:"source_height"`
	ResolutionM    float64 `json:"native_resolution"`
	ResolutionUnit string  `json:"native_resolution_unit"`
}

func productCoverageError(d *terrain.DEM) error {
	configured, _ := d.Info.Provenance["configured_product"].(bool)
	if configured {
		provider, _ := d.Info.Provenance["provider"].(string)
		if strings.TrimSpace(provider) == "" {
			provider = "configured provider"
		}
		if note, ok := d.Info.Provenance["coverage_note"].(string); ok && strings.TrimSpace(note) != "" {
			return terrain.Errorf("Requested square is outside or cannot be mapped into the configured product footprint (%s): %s", provider, note)
		}
		return terrain.Errorf("Requested square is outside or cannot be mapped into the configured product footprint (%s). No fallback dataset was selected.", provider)
	}
	// Keep the historical message for the original test fixture/golden contract.
	return terrain.Errorf("Requested square extends outside this NASA south-pole product. Use a covered location or a smaller radius.")
}

// PlanSubset computes the native-resolution pixel window covering the analysis
// square plus a bilinear halo, exactly as the Python downloader did.
func PlanSubset(d *terrain.DEM, lat, lon, radiusKm float64) (*Plan, error) {
	res := d.Info.SourceResolution
	local := lunarcrs.Sphere(lunarcrs.AzimuthalEquidistant, d.Info.LunarRadiusM, lat, lon, 0)
	// Expand the sampled analysis square by two source pixels. Projected DEMs
	// report linear units; geographic grids report degrees, which must be
	// converted locally to metres before they can be added to radiusKm.
	resXMetres, resYMetres := math.Abs(res[0])*d.CRS.LinearUnitM, math.Abs(res[1])*d.CRS.LinearUnitM
	if d.CRS.IsGeographic() {
		latRad := lat * math.Pi / 180
		resXMetres = math.Abs(res[0]) * d.CRS.AngularUnitRad * d.Info.LunarRadiusM * math.Abs(math.Cos(latRad))
		resYMetres = math.Abs(res[1]) * d.CRS.AngularUnitRad * d.Info.LunarRadiusM
	}
	if !(resXMetres > 0) || !(resYMetres > 0) {
		return nil, terrain.Errorf("Source raster pixel spacing is zero or cannot be converted to lunar metres.")
	}
	extent := radiusKm*1000 + 2*math.Max(resXMetres, resYMetres)
	minX, minY, maxX, maxY := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	for i := 0; i < 65; i++ {
		for j := 0; j < 65; j++ {
			east := -extent + float64(j)*(2*extent/64)
			north := -extent + float64(i)*(2*extent/64)
			lo, la, ok := local.Inverse(east, north)
			if !ok {
				return nil, productCoverageError(d)
			}
			x, y, ok := d.CRS.Forward(lo, la)
			if !ok || math.IsNaN(x) || math.IsNaN(y) || math.IsInf(x, 0) || math.IsInf(y, 0) {
				return nil, productCoverageError(d)
			}
			minX, maxX = math.Min(minX, x), math.Max(maxX, x)
			minY, maxY = math.Min(minY, y), math.Max(maxY, y)
		}
	}
	g := d.GT
	if g[2] != 0 || g[4] != 0 {
		return nil, terrain.Errorf("Rotated source rasters cannot be subset.")
	}
	c0, c1 := (minX-res[0]-g[0])/g[1], (maxX+res[0]-g[0])/g[1]
	r0, r1 := (maxY+res[1]-g[3])/g[5], (minY-res[1]-g[3])/g[5]
	colOff, colEnd := math.Min(c0, c1), math.Max(c0, c1)
	rowOff, rowEnd := math.Min(r0, r1), math.Max(r0, r1)
	left, top := int(math.Floor(colOff)), int(math.Floor(rowOff))
	width, height := int(math.Ceil(colEnd))-left, int(math.Ceil(rowEnd))-top
	if left < 0 || top < 0 || left+width > d.File.Width || top+height > d.File.Height {
		return nil, productCoverageError(d)
	}
	if width*height > terrain.MaxSubsetPixels {
		return nil, terrain.Errorf("Requested subset exceeds the download memory limit. Choose a smaller radius.")
	}
	bytesTotal, blocks := d.File.WindowEncodedBytes(left, top, width, height)
	return &Plan{Latitude: lat, Longitude: lon, RadiusKm: radiusKm, Window: [4]int{left, top, width, height}, Pixels: width * height,
		EncodedBytes: bytesTotal, Blocks: blocks, SourceWidth: d.File.Width, SourceHeight: d.File.Height,
		ResolutionM: res[0], ResolutionUnit: d.Info.SourceResolutionUnit}, nil
}

// Subset is an acquired regional raster with its provenance configuration.
type Subset struct {
	TIFF   []byte
	Config map[string]any // DEM options + subset_provenance (ready for --dem-config)
	Plan   *Plan
	SHA256 string
}

// Extract reads the planned window from an opened source and serialises a
// native-resolution subset: original samples, CRS keys, NoData and band scaling
// are retained. The native landing elevation must survive the round trip.
func Extract(d *terrain.DEM, plan *Plan, product Product, now time.Time, transfer map[string]any) (*Subset, error) {
	left, top, width, height := plan.Window[0], plan.Window[1], plan.Window[2], plan.Window[3]
	values, err := d.File.ReadWindow(left, top, width, height)
	if err != nil {
		return nil, terrain.Errorf("Cannot read the source window: %v", err)
	}
	landing, err := d.LandingElevation(plan.Latitude, plan.Longitude)
	if err != nil {
		return nil, err
	}
	f := d.File
	tags := map[string]string{}
	for k, v := range f.Tags {
		tags[k] = v
	}
	frame, _ := product.Assumptions["lunar_reference_frame"].(string)
	tags["SOURCE_URL"], tags["SOURCE_PRODUCT_PAGE"], tags["LUNAR_REFERENCE_FRAME"] = product.URL, product.ProductPage, frame
	tags["SOURCE_PRODUCT_ID"], tags["SOURCE_PROVIDER"], tags["SOURCE_COVERAGE_NOTE"] = product.ID, product.Provider, product.CoverageNote
	tags["PROCESSING"] = "Native-resolution source subset; original values, CRS, and NoData retained"
	w := geotiff.WriteOptions{Width: width, Height: height, BitsPerSample: f.BitsPerSample, SampleFormat: f.SampleFormat, Data: values,
		Geotransform: [6]float64{d.GT[0] + float64(left)*d.GT[1], d.GT[1], 0, d.GT[3] + float64(top)*d.GT[5], 0, d.GT[5]},
		GeoKeys:      f.GeoKeys, HasNoData: f.HasNoData, NoData: f.NoData, Tags: tags, TileSize: 256, Deflate: true}
	if f.HasScale {
		w.Scale = &f.Scale
	}
	if f.HasOffset {
		w.Offset = &f.Offset
	}
	var buf bytes.Buffer
	if err := geotiff.Write(&buf, w); err != nil {
		return nil, terrain.Errorf("Cannot write the subset: %v", err)
	}
	sum := sha256.Sum256(buf.Bytes())
	config := map[string]any{}
	for k, v := range product.Assumptions {
		config[k] = v
	}
	config["source_url"], config["product_page"], config["product_id"] = product.URL, product.ProductPage, product.ID
	config["provider"], config["coverage_note"], config["nominal_resolution_m"] = product.Provider, product.CoverageNote, product.NominalResolutionM
	prov := map[string]any{
		"latitude": plan.Latitude, "longitude": plan.Longitude, "analysis_radius_km": plan.RadiusKm,
		"source_pixel_window": []int{left, top, width, height}, "downloaded_utc": now.UTC().Format(time.RFC3339Nano),
		"sha256": hex.EncodeToString(sum[:]), "native_landing_elevation_m": landing,
		"scientific_validation": "Not independently validated; review source product documentation.",
		"acquired_by":           terrain.Engine,
	}
	for k, v := range transfer {
		prov[k] = v
	}
	config["subset_provenance"] = prov
	// Check that no crop/serialization step changed the native landing height.
	check, err := geotiff.Open(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		return nil, terrain.Errorf("Subset verification failed: %v", err)
	}
	cropped, err := terrain.Inspect(check, config, "subset.tif")
	if err != nil {
		return nil, err
	}
	croppedLanding, err := cropped.LandingElevation(plan.Latitude, plan.Longitude)
	if err != nil || math.Abs(croppedLanding-landing) > 1e-6 {
		return nil, terrain.Errorf("Downloaded subset did not preserve the landing elevation.")
	}
	return &Subset{TIFF: buf.Bytes(), Config: config, Plan: plan, SHA256: hex.EncodeToString(sum[:])}, nil
}

// Acquire runs the whole workflow: validate → probe → inspect → coverage plan →
// bounded range reads → verified subset. With dryRun it stops after the plan.
func Acquire(ctx context.Context, o Options, latitude, longitude, radiusKm any, dryRun bool) (*Subset, error) {
	lat, lon, radius, _, err := terrain.ValidateLocation(latitude, longitude, radiusKm, "medium")
	if err != nil {
		return nil, err
	}
	d, rr, err := OpenRemote(ctx, o)
	if err != nil {
		return nil, err
	}
	plan, err := PlanSubset(d, lat, lon, radius)
	if err != nil {
		return nil, err
	}
	if dryRun {
		return &Subset{Plan: plan}, nil
	}
	now := time.Now
	if o.Now != nil {
		now = o.Now
	}
	sub, err := Extract(d, plan, o.Product, now(), nil)
	if err != nil {
		if ctx.Err() != nil {
			return nil, terrain.Errorf("DEM acquisition timed out; choose a smaller radius or retry.")
		}
		return nil, err
	}
	prov := sub.Config["subset_provenance"].(map[string]any)
	prov["source_size_bytes"], prov["bytes_fetched"], prov["range_requests"] = rr.Size, rr.Fetched, rr.Requests
	if rr.ETag != "" {
		prov["source_etag"] = rr.ETag
	}
	if rr.LastModified != "" {
		prov["source_last_modified"] = rr.LastModified
	}
	return sub, nil
}
