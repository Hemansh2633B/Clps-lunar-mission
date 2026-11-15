package handler

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

// The function must behave as a Vercel deployment (temporary data directory,
// platform client address) whether or not the VERCEL system variable is exposed
// to the runtime.
func TestHandlerDeclaresVercelWithoutSystemVariable(t *testing.T) {
	t.Setenv("VERCEL", "")
	t.Setenv("BLOB_READ_WRITE_TOKEN", "")
	t.Setenv("CHANDRA_STORE", "")
	t.Setenv("CHANDRA_RATE_LIMIT", "off")
	for _, path := range []string{"/api/config", "/api/index?__route=config"} {
		rec := httptest.NewRecorder()
		Handler(rec, httptest.NewRequest("GET", path, nil))
		if rec.Code != 200 {
			t.Fatalf("%s: status %d: %s", path, rec.Code, rec.Body)
		}
		var cfg struct {
			Deployment string `json:"deployment"`
			Engine     string `json:"engine"`
			Storage    struct {
				Kind       string `json:"kind"`
				Persistent bool   `json:"persistent"`
			} `json:"storage"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &cfg); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		if cfg.Deployment != "vercel" || cfg.Engine == "" {
			t.Fatalf("%s: deployment %q, engine %q", path, cfg.Deployment, cfg.Engine)
		}
		// Without a Blob store a function instance has only temporary disk: it must not claim otherwise.
		if cfg.Storage.Kind != "local" || cfg.Storage.Persistent {
			t.Fatalf("%s: storage %+v, want temporary local storage", path, cfg.Storage)
		}
	}
}
