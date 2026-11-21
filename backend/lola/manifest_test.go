package lola

import (
	"encoding/json"
	"strings"
	"testing"
)

func manifestEntry() map[string]any {
	return map[string]any{
		"id":                   "pds-global-dem-118m",
		"url":                  "https://pds-geosciences.wustl.edu/lunar/global-dem/example.tif",
		"product_page":         "https://pds-geosciences.wustl.edu/lunar/global-dem/",
		"provider":             "NASA PDS Geosciences Node · test entry",
		"coverage_note":        "Explicitly operator-verified global coverage; exact footprint validated from raster metadata.",
		"nominal_resolution_m": 118,
		"range_access":         true,
		"assumptions": map[string]any{
			"vertical_unit": "m", "value_kind": "elevation",
			"elevation_reference":          "Test manifest datum; verify against the cited product label.",
			"elevation_reference_radius_m": 1_737_400.0,
			"lunar_reference_frame":        "MOON_ME (JPL DE421)",
		},
	}
}

func encodedManifest(t *testing.T, entries ...map[string]any) string {
	t.Helper()
	b, err := json.Marshal(entries)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestParseConfiguredProductsRequiresExplicitAllowlistedProduct(t *testing.T) {
	products, err := ParseConfiguredProducts(encodedManifest(t, manifestEntry()))
	if err != nil {
		t.Fatal(err)
	}
	if len(products) != 1 || products[0].NominalResolutionM != 118 || products[0].Provider == "" {
		t.Fatalf("configured product metadata was not preserved: %#v", products)
	}
	if !AllowedURL(products[0].URL, false) {
		t.Fatal("PDS Geosciences product host should be allowlisted")
	}
}

func TestParseConfiguredProductsRejectsUntrustedOrIncompleteProducts(t *testing.T) {
	cases := []struct {
		name string
		edit func(map[string]any)
	}{
		{"arbitrary host", func(m map[string]any) { m["url"] = "https://example.com/data.tif" }},
		{"not range capable", func(m map[string]any) { m["range_access"] = false }},
		{"missing provenance", func(m map[string]any) { delete(m, "assumptions") }},
		{"unknown vertical units", func(m map[string]any) { m["assumptions"].(map[string]any)["vertical_unit"] = "feet" }},
		{"invalid nominal scale", func(m map[string]any) { m["nominal_resolution_m"] = 0 }},
		{"traversal-like id", func(m map[string]any) { m["id"] = "../escape" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := manifestEntry()
			tc.edit(m)
			if _, err := ParseConfiguredProducts(encodedManifest(t, m)); err == nil {
				t.Fatal("invalid product manifest was accepted")
			}
		})
	}
}

func TestParseConfiguredProductsRejectsDuplicateAndTrailingJSON(t *testing.T) {
	m := manifestEntry()
	if _, err := ParseConfiguredProducts(encodedManifest(t, m, m)); err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("duplicate catalogue id should be rejected, got %v", err)
	}
	valid := encodedManifest(t, m)
	if _, err := ParseConfiguredProducts(valid + ` {"extra":true}`); err == nil {
		t.Fatal("trailing JSON was accepted")
	}
	if _, err := ParseConfiguredProducts(`null`); err == nil {
		t.Fatal("null was accepted instead of a manifest array")
	}
}
