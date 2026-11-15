// Package catalog serves the Lunar Data Hub source catalogue. The same JSON file
// is bundled into the frontend, so the hub works without any backend.
package catalog

import (
	_ "embed"
	"encoding/json"
)

//go:embed catalogue.json
var raw []byte

// Source is one catalogue card. Pointer fields are nil when the value is unknown.
type Source struct {
	ID           string          `json:"id"`
	Category     string          `json:"category"`
	Provider     string          `json:"provider"`
	ProductName  string          `json:"product_name"`
	ProductID    *string         `json:"product_id"`
	AccessURL    *string         `json:"access_url"`
	Availability string          `json:"availability"`
	DataKind     string          `json:"data_kind"`
	Integration  string          `json:"integration"`
	Layer        json.RawMessage `json:"layer,omitempty"`
}

// Document is the parsed catalogue.
type Document struct {
	SchemaVersion string   `json:"schema_version"`
	CatalogueDate string   `json:"catalogue_date"`
	Sources       []Source `json:"sources"`
}

// Raw returns the catalogue JSON exactly as shipped.
func Raw() []byte { return raw }

// Load parses the embedded catalogue.
func Load() (*Document, error) {
	var d Document
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, err
	}
	return &d, nil
}
