// Package store provides the small object-storage abstraction CHANDRA uses for
// acquired regional DEM subsets and cached upstream responses.
//
// Adapters: Local (a directory, for development and self-hosting), Memory
// (ephemeral; tests and stateless deployments) and VercelBlob (optional
// persistent object storage, enabled only when BLOB_READ_WRITE_TOKEN is set).
// The application is fully functional without any persistent store.
package store

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// ErrNotFound is returned when a key does not exist.
var ErrNotFound = errors.New("object not found")

// MaxObjectBytes bounds a single stored object.
const MaxObjectBytes = 160 << 20

// Store is a flat key/value object store. Keys are slash-separated segments of
// [a-z0-9._-]; anything else is rejected (no traversal, no absolute paths).
type Store interface {
	Put(ctx context.Context, key string, data []byte) error
	Get(ctx context.Context, key string) ([]byte, error)
	List(ctx context.Context, prefix string) ([]string, error)
	Delete(ctx context.Context, key string) error
	Kind() string
	Persistent() bool
}

var keyPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)*$`)

// ValidKey reports whether a key is safe to use with every adapter.
func ValidKey(key string) bool {
	return len(key) <= 200 && keyPattern.MatchString(key) && !strings.Contains(key, "..")
}

func checkKey(key string) error {
	if !ValidKey(key) {
		return fmt.Errorf("invalid storage key %q", key)
	}
	return nil
}

// ---------------------------------------------------------------- memory

// Memory is an in-process store.
type Memory struct {
	mu   sync.RWMutex
	data map[string][]byte
}

// NewMemory returns an empty in-process store.
func NewMemory() *Memory { return &Memory{data: map[string][]byte{}} }

func (m *Memory) Kind() string     { return "memory" }
func (m *Memory) Persistent() bool { return false }

func (m *Memory) Put(_ context.Context, key string, data []byte) error {
	if err := checkKey(key); err != nil {
		return err
	}
	if len(data) > MaxObjectBytes {
		return errors.New("object exceeds the storage size limit")
	}
	m.mu.Lock()
	m.data[key] = append([]byte(nil), data...)
	m.mu.Unlock()
	return nil
}

func (m *Memory) Get(_ context.Context, key string) ([]byte, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if v, ok := m.data[key]; ok {
		return v, nil
	}
	return nil, ErrNotFound
}

func (m *Memory) List(_ context.Context, prefix string) ([]string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var keys []string
	for k := range m.data {
		if strings.HasPrefix(k, prefix) {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	return keys, nil
}

func (m *Memory) Delete(_ context.Context, key string) error {
	m.mu.Lock()
	delete(m.data, key)
	m.mu.Unlock()
	return nil
}

// ---------------------------------------------------------------- local

// Local stores objects as files under one root directory. Ephemeral marks a
// root that does not outlive the process's host — a serverless instance's
// temporary directory — so that clients are never told such data persists.
type Local struct {
	Root      string
	Ephemeral bool
}

func (l *Local) Kind() string     { return "local" }
func (l *Local) Persistent() bool { return !l.Ephemeral }

func (l *Local) path(key string) (string, error) {
	if err := checkKey(key); err != nil {
		return "", err
	}
	root, err := filepath.Abs(l.Root)
	if err != nil {
		return "", err
	}
	p := filepath.Join(root, filepath.FromSlash(key))
	if rel, err := filepath.Rel(root, p); err != nil || strings.HasPrefix(rel, "..") {
		return "", fmt.Errorf("invalid storage key %q", key)
	}
	return p, nil
}

func (l *Local) Put(_ context.Context, key string, data []byte) error {
	p, err := l.path(key)
	if err != nil {
		return err
	}
	if len(data) > MaxObjectBytes {
		return errors.New("object exceeds the storage size limit")
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	// Write to a private temporary file, then rename: readers never see a partial object.
	tmp, err := os.CreateTemp(filepath.Dir(p), ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), p)
}

func (l *Local) Get(_ context.Context, key string) ([]byte, error) {
	p, err := l.path(key)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(p)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	return data, err
}

func (l *Local) List(_ context.Context, prefix string) ([]string, error) {
	root, err := filepath.Abs(l.Root)
	if err != nil {
		return nil, err
	}
	var keys []string
	err = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return err
		}
		if d.IsDir() || strings.HasPrefix(d.Name(), ".tmp-") {
			return nil
		}
		rel, _ := filepath.Rel(root, p)
		if key := filepath.ToSlash(rel); strings.HasPrefix(key, prefix) && ValidKey(key) {
			keys = append(keys, key)
		}
		return nil
	})
	sort.Strings(keys)
	return keys, err
}

func (l *Local) Delete(_ context.Context, key string) error {
	p, err := l.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// ---------------------------------------------------------------- Vercel Blob

// VercelBlob talks to the Vercel Blob HTTP API (the protocol used by the
// official @vercel/blob SDK). It is only constructed when a read-write token is
// configured; the token is never logged or returned to clients.
type VercelBlob struct {
	Token   string
	BaseURL string // API base, default https://vercel.com/api/blob
	Prefix  string // namespace inside the store, default "chandra/"
	Access  string // "public" (default) or "private"; must match the Blob store type
	Client  *http.Client
}

// Protocol version implemented (matches @vercel/blob 2.9.0).
const blobAPIVersion = "13"

func (b *VercelBlob) Kind() string     { return "vercel-blob" }
func (b *VercelBlob) Persistent() bool { return true }

func (b *VercelBlob) base() string {
	if b.BaseURL != "" {
		return strings.TrimRight(b.BaseURL, "/")
	}
	return "https://vercel.com/api/blob"
}

func (b *VercelBlob) access() string {
	if b.Access == "private" {
		return "private"
	}
	return "public"
}

// trustedDownload limits where the read-write token may be sent.
func (b *VercelBlob) trustedDownload(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	if b.BaseURL != "" { // tests / explicit override: same origin only
		base, err := url.Parse(b.BaseURL)
		return err == nil && u.Host == base.Host
	}
	return u.Scheme == "https" && strings.HasSuffix(u.Hostname(), ".blob.vercel-storage.com")
}

func (b *VercelBlob) client() *http.Client {
	if b.Client != nil {
		return b.Client
	}
	return &http.Client{Timeout: 30 * time.Second}
}

func (b *VercelBlob) do(ctx context.Context, method, target string, body io.Reader, headers map[string]string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+b.Token)
	req.Header.Set("x-api-version", blobAPIVersion)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return b.client().Do(req)
}

func (b *VercelBlob) Put(ctx context.Context, key string, data []byte) error {
	if err := checkKey(key); err != nil {
		return err
	}
	if len(data) > MaxObjectBytes {
		return errors.New("object exceeds the storage size limit")
	}
	target := b.base() + "/?pathname=" + url.QueryEscape(b.Prefix+key)
	resp, err := b.do(ctx, http.MethodPut, target, bytes.NewReader(data), map[string]string{
		"x-vercel-blob-access": b.access(), "x-add-random-suffix": "0", "x-allow-overwrite": "1",
		"x-content-type": "application/octet-stream", "x-cache-control-max-age": "31536000"})
	if err != nil {
		return fmt.Errorf("blob put failed: %w", err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("blob put failed: HTTP %d", resp.StatusCode)
	}
	return nil
}

type blobEntry struct {
	URL      string `json:"url"`
	Pathname string `json:"pathname"`
}

func (b *VercelBlob) list(ctx context.Context, prefix string) ([]blobEntry, error) {
	var all []blobEntry
	cursor := ""
	for page := 0; page < 20; page++ {
		target := b.base() + "/?limit=1000&prefix=" + url.QueryEscape(b.Prefix+prefix)
		if cursor != "" {
			target += "&cursor=" + url.QueryEscape(cursor)
		}
		resp, err := b.do(ctx, http.MethodGet, target, nil, nil)
		if err != nil {
			return nil, fmt.Errorf("blob list failed: %w", err)
		}
		var out struct {
			Blobs   []blobEntry `json:"blobs"`
			Cursor  string      `json:"cursor"`
			HasMore bool        `json:"hasMore"`
		}
		err = json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&out)
		resp.Body.Close()
		if resp.StatusCode/100 != 2 {
			return nil, fmt.Errorf("blob list failed: HTTP %d", resp.StatusCode)
		}
		if err != nil {
			return nil, fmt.Errorf("blob list failed: %w", err)
		}
		all = append(all, out.Blobs...)
		if !out.HasMore || out.Cursor == "" {
			break
		}
		cursor = out.Cursor
	}
	return all, nil
}

func (b *VercelBlob) List(ctx context.Context, prefix string) ([]string, error) {
	entries, err := b.list(ctx, prefix)
	if err != nil {
		return nil, err
	}
	var keys []string
	for _, e := range entries {
		if key := strings.TrimPrefix(e.Pathname, b.Prefix); ValidKey(key) {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	return keys, nil
}

func (b *VercelBlob) Get(ctx context.Context, key string) ([]byte, error) {
	if err := checkKey(key); err != nil {
		return nil, err
	}
	entries, err := b.list(ctx, key)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if e.Pathname != b.Prefix+key {
			continue
		}
		if !b.trustedDownload(e.URL) {
			return nil, errors.New("blob store returned an unexpected download URL")
		}
		resp, err := b.do(ctx, http.MethodGet, e.URL, nil, nil)
		if err != nil {
			return nil, fmt.Errorf("blob get failed: %w", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode/100 != 2 {
			return nil, fmt.Errorf("blob get failed: HTTP %d", resp.StatusCode)
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, MaxObjectBytes+1))
		if err != nil || len(data) > MaxObjectBytes {
			return nil, errors.New("blob get failed: object too large or truncated")
		}
		return data, nil
	}
	return nil, ErrNotFound
}

func (b *VercelBlob) Delete(ctx context.Context, key string) error {
	entries, err := b.list(ctx, key)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.Pathname == b.Prefix+key {
			payload, _ := json.Marshal(map[string][]string{"urls": {e.URL}})
			resp, err := b.do(ctx, http.MethodPost, b.base()+"/delete", bytes.NewReader(payload), map[string]string{"content-type": "application/json"})
			if err != nil {
				return err
			}
			resp.Body.Close()
		}
	}
	return nil
}

// FromEnv selects the store for this process: Vercel Blob when a token is
// present, otherwise a local directory, otherwise memory.
func FromEnv(getenv func(string) string, defaultDir string) Store {
	if token := getenv("BLOB_READ_WRITE_TOKEN"); token != "" && getenv("CHANDRA_STORE") != "local" {
		return &VercelBlob{Token: token, Prefix: "chandra/", Access: getenv("CHANDRA_BLOB_ACCESS"), BaseURL: getenv("VERCEL_BLOB_API_URL")}
	}
	dir := getenv("CHANDRA_DATA_DIR")
	if dir == "" {
		dir = defaultDir
	}
	if dir == "" || getenv("CHANDRA_STORE") == "memory" {
		return NewMemory()
	}
	return &Local{Root: dir}
}
