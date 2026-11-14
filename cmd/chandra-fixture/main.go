// Command chandra-fixture fetches a small public LOLA-derived south-pole grid
// and wraps it as a lunar GeoTIFF (native replacement for
// scripts/fetch-lola-verification-fixture.py).
//
// This is a SOFTWARE VERIFICATION FIXTURE, not a flight product:
//   - source: NASA PGDA LDEM_80S_20MPP_ADJ.TIF (MOON_ME / DE421)
//   - third-party 512x512 bilinear downsample published by
//     hparadiz/artemis-iii-landing-candidates
//   - that derivative fills invalid source pixels before downsampling, so NoData
//     coverage is NOT preserved. Do not use it for scientific illumination studies.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"chandra/backend/geotiff"
	"chandra/backend/lunarcrs"
)

const (
	repo     = "hparadiz/artemis-iii-landing-candidates"
	binPath  = "data/base_tiles/ldem_80s_20mpp_adj.tif_512.bin"
	metaPath = "data/base_dem_80s.json"
	size     = 512
	extent   = 304000.0 // metres, polar stereographic bounds of the 80S product
	radius   = 1737400.0
)

func fetch(path string, limit int64) ([]byte, error) {
	req, _ := http.NewRequest(http.MethodGet, "https://api.github.com/repos/"+repo+"/contents/"+path, nil)
	req.Header.Set("Accept", "application/vnd.github.raw")
	req.Header.Set("User-Agent", "CHANDRA-verification-fixture")
	if token := os.Getenv("GITHUB_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := (&http.Client{Timeout: 2 * time.Minute}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub returned HTTP %d for %s", resp.StatusCode, path)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil || int64(len(data)) > limit {
		return nil, fmt.Errorf("unexpected response size for %s", path)
	}
	return data, nil
}

func main() {
	out := filepath.Join("data", "verification")
	if len(os.Args) > 1 {
		out = os.Args[1]
	}
	die := func(err error) {
		fmt.Fprintln(os.Stderr, "fixture fetch failed:", err)
		os.Exit(1)
	}
	raw, err := fetch(binPath, size*size*4)
	if err != nil {
		die(err)
	}
	metaRaw, err := fetch(metaPath, 1<<20)
	if err != nil {
		die(err)
	}
	if len(raw) != size*size*4 {
		die(fmt.Errorf("unexpected fixture size: %d bytes", len(raw)))
	}
	var meta any
	if err := json.Unmarshal(metaRaw, &meta); err != nil {
		die(err)
	}
	data := make([]float64, size*size)
	lo, hi := math.Inf(1), math.Inf(-1)
	for i := range data {
		v := float64(math.Float32frombits(binary.LittleEndian.Uint32(raw[i*4:])))
		if math.IsNaN(v) || math.IsInf(v, 0) {
			die(fmt.Errorf("fixture contains non-finite samples"))
		}
		data[i], lo, hi = v, math.Min(lo, v), math.Max(hi, v)
	}
	// NASA LOLA 80S adjusted mosaic: south polar stereographic, true scale at the
	// pole, central meridian 0, spherical Moon radius 1737400 m; north-up raster.
	crs := lunarcrs.Sphere(lunarcrs.PolarStereographic, radius, -90, 0, -90)
	if lon, lat, ok := crs.Inverse(0, 0); !ok || math.Abs(lat+90) > 1e-6 {
		die(fmt.Errorf("projection centre is not the south pole: %v, %v", lat, lon))
	}
	pixel := 2 * extent / size
	var tif bytes.Buffer
	if err := geotiff.Write(&tif, geotiff.WriteOptions{Width: size, Height: size, BitsPerSample: 32, SampleFormat: geotiff.SampleFloat, Data: data,
		Geotransform: [6]float64{-extent, pixel, 0, extent, 0, -pixel}, GeoKeys: crs.GeoKeys(), Deflate: true,
		Tags: map[string]string{
			"SOURCE":     "NASA PGDA LDEM_80S_20MPP_ADJ.TIF via hparadiz/artemis-iii-landing-candidates",
			"DERIVATIVE": "512x512 bilinear downsample; invalid source pixels were filled by the derivative author",
			"FRAME":      "MOON_ME (DE421) per source product documentation; verify before operational use"}}); err != nil {
		die(err)
	}
	if err := os.MkdirAll(out, 0o755); err != nil {
		die(err)
	}
	tifPath := filepath.Join(out, "LDEM_80S_20MPP_ADJ_512_verification.tif")
	write := func(path string, v any) {
		b, _ := json.MarshalIndent(v, "", "  ")
		if err := os.WriteFile(path, append(b, '\n'), 0o644); err != nil {
			die(err)
		}
	}
	if err := os.WriteFile(tifPath, tif.Bytes(), 0o644); err != nil {
		die(err)
	}
	configPath := filepath.Join(out, "lola_verification_config.json")
	write(configPath, map[string]any{
		"dem_path": filepath.ToSlash(tifPath), "vertical_unit": "m", "value_kind": "elevation",
		"elevation_reference":          "NASA LOLA adjusted radial topography, reference sphere 1737400 m (verification fixture)",
		"elevation_reference_radius_m": radius,
		"lunar_reference_frame":        "MOON_ME (DE421) — third-party 512px verification downsample; gap-filled; NOT flight data",
		"scale":                        1.0, "offset": 0.0,
	})
	sumBin, sumTif := sha256.Sum256(raw), sha256.Sum256(tif.Bytes())
	write(filepath.Join(out, "PROVENANCE.json"), map[string]any{
		"purpose": "software verification fixture only", "source_product": "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF",
		"derivative_repository": "https://github.com/" + repo, "derivative_bin": binPath, "derivative_meta": metaPath,
		"sha256_bin": hex.EncodeToString(sumBin[:]), "sha256_tif": hex.EncodeToString(sumTif[:]), "written_by": "cmd/chandra-fixture (native GeoTIFF writer)",
		"grid":           map[string]any{"width": size, "height": size, "pixel_size_m": pixel, "extent_m": []float64{-extent, extent, -extent, extent}},
		"height_range_m": []float64{lo, hi}, "source_meta": meta,
		"caveats": []string{
			"Third-party bilinear downsample, not native NASA resolution.",
			"Invalid source pixels were filled by the derivative author; NoData coverage is not preserved.",
			"Body frame is asserted from source documentation, not independently reconciled with IAU 2015 ephemeris.",
			"Use only to verify software loading/cropping/rendering paths."},
	})
	fmt.Printf("Wrote %s\nConfig: %s\nHeight range: %.1f … %.1f m\n", tifPath, configPath, lo, hi)
}
