package geotiff

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
)

func TestHTTPSourceRangeReadsAndEOF(t *testing.T) {
	data := make([]byte, 128<<10)
	for i := range data {
		data[i] = byte(i*31 + 7)
	}
	const etag = `"fixture-v1"`
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != http.MethodGet {
			t.Errorf("method %s", r.Method)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if r.Header.Get("Accept-Encoding") != "identity" {
			t.Errorf("missing identity encoding")
		}
		var start, end int
		if _, err := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &start, &end); err != nil {
			t.Errorf("bad range: %q", r.Header.Get("Range"))
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if start < 0 || end < start || end >= len(data) {
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(data)))
		w.Header().Set("Content-Length", strconv.Itoa(end-start+1))
		w.Header().Set("ETag", etag)
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(data[start : end+1])
	}))
	defer server.Close()
	s := testHTTPSource(server.URL, int64(len(data)), etag)
	defer s.Close()
	buf := make([]byte, 4096)
	n, err := s.ReadAt(buf, 37)
	if err != nil || n != len(buf) {
		t.Fatalf("ReadAt=(%d,%v)", n, err)
	}
	if !bytes.Equal(buf, data[37:37+len(buf)]) {
		t.Fatal("range payload differs")
	}
	// ReadAt must follow io.ReaderAt semantics for a request clipped at EOF.
	tail := make([]byte, 8)
	n, err = s.ReadAt(tail, int64(len(data)-3))
	if n != 3 || err != io.EOF || !bytes.Equal(tail[:n], data[len(data)-3:]) {
		t.Fatalf("short ReadAt=(%d,%v)", n, err)
	}
	if _, err = s.ReadAt(make([]byte, 1), int64(len(data))); err == nil {
		t.Fatal("accepted offset at EOF")
	}
	if got := s.Requests(); got != 2 {
		t.Fatalf("request count %d", got)
	}
	if got := s.BytesRead(); got != 4099 {
		t.Fatalf("transferred bytes %d", got)
	}
	if requests != 2 {
		t.Fatalf("server saw %d requests", requests)
	}
}

func TestHTTPSourceRejectsProtocolAndBudgetViolations(t *testing.T) {
	for _, url := range []string{"http://example.com/dem.tif", "https://user:pass@example.com/dem.tif", "https://127.0.0.1/dem.tif"} {
		if _, err := NewHTTPSource(t.Context(), url); err == nil {
			t.Errorf("accepted unsafe URL %q", url)
		}
	}
	const body = "0123456789"
	for _, tc := range []struct {
		name               string
		status             int
		contentRange, etag string
	}{
		{"full-response", http.StatusOK, "bytes 0-0/10", `"v1"`},
		{"missing-range", http.StatusPartialContent, "", `"v1"`},
		{"malformed-range", http.StatusPartialContent, "bytes 0-0/10junk", `"v1"`},
		{"missing-etag", http.StatusPartialContent, "bytes 0-0/10", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Range", tc.contentRange)
				w.Header().Set("ETag", tc.etag)
				w.Header().Set("Content-Length", "1")
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, body[:1])
			}))
			defer srv.Close()
			s := testHTTPSource(srv.URL, 10, `"v1"`)
			defer s.Close()
			if _, err := s.ReadAt(make([]byte, 1), 0); err == nil {
				t.Fatal("accepted invalid range response")
			}
		})
	}
}

func TestHTTPSourceEnforcesTransferBudget(t *testing.T) {
	s := testHTTPSource("http://example.invalid/dem.tif", MaxRemoteBytes, `"v1"`)
	s.bytesRead = MaxRemoteTransfer
	if _, err := s.fetch(t.Context(), 0, 0); err == nil {
		t.Fatal("transfer budget was not enforced")
	}
}
