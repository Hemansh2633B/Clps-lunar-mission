package lola

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"regexp"
	"strings"
)

const (
	maxConfiguredProductManifestBytes = 256 << 10
	maxConfiguredProducts             = 50
)

// configuredProduct is deliberately strict. Only deployment operators can
// supply this JSON (CHANDRA_LOLA_PRODUCTS_JSON); browser/API users select a
// product_id from the returned catalogue and can never submit a source URL.
type configuredProduct struct {
	ID                 string         `json:"id"`
	URL                string         `json:"url"`
	ProductPage        string         `json:"product_page"`
	Provider           string         `json:"provider"`
	CoverageNote       string         `json:"coverage_note"`
	NominalResolutionM float64        `json:"nominal_resolution_m"`
	RangeAccess        bool           `json:"range_access"`
	Assumptions        map[string]any `json:"assumptions"`
}

// ParseConfiguredProducts validates a small, deployment-supplied product
// manifest for additional NASA/PDS regional GeoTIFFs. It does not download or
// trust a URL from a request. Every product is still inspected per acquisition
// for GeoTIFF CRS, frame, vertical datum, coverage and actual resolution.
//
// `range_access:true` is an explicit operator assertion that the URL points to
// a range-readable COG/GeoTIFF; the acquisition code independently requires
// HTTP 206 + a valid Content-Range on every request. It cannot make an ordinary
// tiled/non-COG TIFF bounded merely by adding it to this catalogue.
func ParseConfiguredProducts(raw string) ([]Product, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	if len(raw) > maxConfiguredProductManifestBytes {
		return nil, fmt.Errorf("configured LOLA product manifest exceeds %d bytes", maxConfiguredProductManifestBytes)
	}
	if !strings.HasPrefix(strings.TrimSpace(raw), "[") {
		return nil, errors.New("configured LOLA product manifest must be a JSON array")
	}
	var entries []configuredProduct
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&entries); err != nil {
		return nil, fmt.Errorf("invalid configured LOLA product manifest: %w", err)
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return nil, errors.New("configured LOLA product manifest must contain exactly one JSON array")
	}
	if len(entries) > maxConfiguredProducts {
		return nil, fmt.Errorf("configured LOLA product manifest has %d entries; maximum is %d", len(entries), maxConfiguredProducts)
	}
	out := make([]Product, 0, len(entries))
	seen := make(map[string]bool, len(entries))
	for i, e := range entries {
		prefix := fmt.Sprintf("configured product %d", i+1)
		if !productIDPattern.MatchString(e.ID) || seen[e.ID] || Products[e.ID].ID != "" {
			return nil, fmt.Errorf("%s has an invalid or duplicate id", prefix)
		}
		seen[e.ID] = true
		if !AllowedURL(e.URL, false) {
			return nil, fmt.Errorf("%s URL must use HTTPS on an allowlisted NASA/PDS host", prefix)
		}
		if !AllowedURL(e.ProductPage, false) {
			return nil, fmt.Errorf("%s product_page must use HTTPS on an allowlisted NASA/PDS host", prefix)
		}
		if !e.RangeAccess {
			return nil, fmt.Errorf("%s must explicitly assert range_access=true for bounded subset reads", prefix)
		}
		if !(e.NominalResolutionM > 0 && e.NominalResolutionM <= 10_000 && !math.IsNaN(e.NominalResolutionM) && !math.IsInf(e.NominalResolutionM, 0)) {
			return nil, fmt.Errorf("%s nominal_resolution_m must be in (0, 10000]", prefix)
		}
		if strings.TrimSpace(e.Provider) == "" || len(e.Provider) > 160 || strings.TrimSpace(e.CoverageNote) == "" || len(e.CoverageNote) > 500 {
			return nil, fmt.Errorf("%s requires a bounded provider attribution and coverage_note", prefix)
		}
		if err := validateConfiguredAssumptions(e.Assumptions); err != nil {
			return nil, fmt.Errorf("%s assumptions: %w", prefix, err)
		}
		out = append(out, Product{
			ID: e.ID, URL: e.URL, ProductPage: e.ProductPage,
			Provider: e.Provider, CoverageNote: e.CoverageNote,
			NominalResolutionM: e.NominalResolutionM,
			Configured:         true,
			Assumptions:        e.Assumptions,
		})
	}
	return out, nil
}

func validateConfiguredAssumptions(a map[string]any) error {
	if a == nil {
		return errors.New("must explicitly state vertical_unit, value_kind, elevation_reference, elevation_reference_radius_m and lunar_reference_frame")
	}
	for _, key := range []string{"vertical_unit", "value_kind", "elevation_reference", "lunar_reference_frame"} {
		v, ok := a[key].(string)
		if !ok || strings.TrimSpace(v) == "" {
			return fmt.Errorf("%s must be a non-empty string", key)
		}
	}
	if a["vertical_unit"] != "m" || a["value_kind"] != "elevation" {
		return errors.New("only explicitly labelled metre elevation products are supported")
	}
	if r, ok := a["elevation_reference_radius_m"].(float64); !ok || !(r > 1_000_000 && r < 2_000_000) {
		return errors.New("elevation_reference_radius_m must explicitly identify a lunar reference sphere in metres")
	}
	return nil
}

// Product identifiers are opaque to the client but constrained to a
// predictable path/key alphabet to protect object-store keys.
var productIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{2,99}$`)
