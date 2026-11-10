package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthGETContract(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	w := httptest.NewRecorder()
	Handler(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d", w.Code)
	}
	if got := w.Body.String(); got != healthJSON {
		t.Fatalf("body %q", got)
	}
	if got := w.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type %q", got)
	}
	if got := w.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("nosniff %q", got)
	}
	if got := w.Header().Get("Referrer-Policy"); got != "no-referrer" {
		t.Fatalf("Referrer-Policy %q", got)
	}
}

func TestHealthRejectsNonGET(t *testing.T) {
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodHead} {
		t.Run(method, func(t *testing.T) {
			w := httptest.NewRecorder()
			Handler(w, httptest.NewRequest(method, "/api/health", nil))
			if w.Code != http.StatusMethodNotAllowed {
				t.Fatalf("status %d", w.Code)
			}
			if got := w.Body.String(); got != `{"error":"Method not allowed for this endpoint."}` {
				t.Fatalf("body %q", got)
			}
		})
	}
}
