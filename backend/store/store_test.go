package store

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func exercise(t *testing.T, s Store) {
	ctx := context.Background()
	if _, err := s.Get(ctx, "datasets/missing.tif"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing object: %v", err)
	}
	for _, key := range []string{"datasets/a-1.tif", "datasets/a-1.json", "horizons/x.txt"} {
		if err := s.Put(ctx, key, []byte("payload:"+key)); err != nil {
			t.Fatalf("put %s: %v", key, err)
		}
	}
	got, err := s.Get(ctx, "datasets/a-1.json")
	if err != nil || string(got) != "payload:datasets/a-1.json" {
		t.Fatalf("get: %q %v", got, err)
	}
	keys, err := s.List(ctx, "datasets/")
	if err != nil || len(keys) != 2 || keys[0] != "datasets/a-1.json" {
		t.Fatalf("list: %v %v", keys, err)
	}
	if err := s.Delete(ctx, "datasets/a-1.tif"); err != nil {
		t.Fatal(err)
	}
	if keys, _ := s.List(ctx, "datasets/"); len(keys) != 1 {
		t.Fatalf("delete did not remove the object: %v", keys)
	}
	for _, bad := range []string{"../escape", "/abs/path", "datasets/../../etc/passwd", "a//b", "UPPER/case", "", "a/b c", `a\b`, "datasets/..", strings.Repeat("a", 300)} {
		if err := s.Put(ctx, bad, []byte("x")); err == nil {
			t.Fatalf("unsafe key %q accepted", bad)
		}
	}
}

func TestMemoryStore(t *testing.T) { exercise(t, NewMemory()) }

func TestLocalStoreIsConfinedToItsRoot(t *testing.T) {
	root := filepath.Join(t.TempDir(), "store")
	exercise(t, &Local{Root: root})
	entries, _ := os.ReadDir(filepath.Dir(root))
	if len(entries) != 1 {
		t.Fatalf("store wrote outside its root: %v", entries)
	}
	if tmp, _ := filepath.Glob(filepath.Join(root, "*", ".tmp-*")); len(tmp) != 0 {
		t.Fatalf("temporary files were left behind: %v", tmp)
	}
}

// fakeBlob implements the subset of the Vercel Blob HTTP protocol the adapter uses.
func TestVercelBlobProtocol(t *testing.T) {
	var mu sync.Mutex
	objects := map[string][]byte{}
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer test-token" || r.Header.Get("x-api-version") != blobAPIVersion {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodPut:
			if r.Header.Get("x-vercel-blob-access") != "public" || r.Header.Get("x-add-random-suffix") != "0" {
				http.Error(w, "bad headers", 400)
				return
			}
			body, _ := io.ReadAll(r.Body)
			objects[r.URL.Query().Get("pathname")] = body
			json.NewEncoder(w).Encode(map[string]string{"pathname": r.URL.Query().Get("pathname")})
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/download/"):
			w.Write(objects[strings.TrimPrefix(r.URL.Path, "/download/")])
		case r.Method == http.MethodGet:
			var blobs []map[string]string
			for name := range objects {
				if strings.HasPrefix(name, r.URL.Query().Get("prefix")) {
					blobs = append(blobs, map[string]string{"pathname": name, "url": srv.URL + "/download/" + name})
				}
			}
			json.NewEncoder(w).Encode(map[string]any{"blobs": blobs, "hasMore": false})
		case r.Method == http.MethodPost && r.URL.Path == "/delete":
			var req struct{ URLs []string }
			json.NewDecoder(r.Body).Decode(&req)
			for _, u := range req.URLs {
				delete(objects, strings.TrimPrefix(u, srv.URL+"/download/"))
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	blob := &VercelBlob{Token: "test-token", BaseURL: srv.URL, Prefix: "chandra/"}
	exercise(t, blob)
	if _, ok := objects["chandra/horizons/x.txt"]; !ok {
		t.Fatalf("objects are not namespaced: %v", objects)
	}
	// The token is only ever sent to the configured origin.
	if blob.trustedDownload("https://evil.example/steal") || !(&VercelBlob{}).trustedDownload("https://abc123.public.blob.vercel-storage.com/chandra/x") ||
		(&VercelBlob{}).trustedDownload("https://blob.vercel-storage.com.evil.example/x") {
		t.Fatal("download-origin check is wrong")
	}
	if _, err := (&VercelBlob{Token: "wrong", BaseURL: srv.URL}).List(context.Background(), ""); err == nil {
		t.Fatal("authorisation failure was swallowed")
	}
}

func TestFromEnvSelection(t *testing.T) {
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	if s := FromEnv(env(nil), ""); s.Kind() != "memory" || s.Persistent() {
		t.Fatalf("default without a directory must be memory, got %s", s.Kind())
	}
	if s := FromEnv(env(map[string]string{"CHANDRA_DATA_DIR": "/tmp/x"}), ""); s.Kind() != "local" {
		t.Fatalf("got %s", s.Kind())
	}
	if s := FromEnv(env(map[string]string{"BLOB_READ_WRITE_TOKEN": "t", "CHANDRA_STORE": "local"}), "/tmp/x"); s.Kind() != "local" {
		t.Fatalf("explicit local override ignored: %s", s.Kind())
	}
}
