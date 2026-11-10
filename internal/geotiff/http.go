package geotiff

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const MaxRemoteBytes int64 = 512 << 20
const MaxRemoteTransfer int64 = 64 << 20
const MaxRangeBytes = 32 << 20
const MaxRemoteRequests = 4096

// HTTPSource is a server-configured, range-only COG source. It never accepts a
// URL from an API request. Redirects are rejected, including HTTPS redirects.
type HTTPSource struct {
	mu        sync.Mutex
	url       string
	client    *http.Client
	size      int64
	etag      string
	bytesRead int64
	requests  int
}

func NewHTTPSource(ctx context.Context, rawURL string) (*HTTPSource, error) {
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
		return nil, errors.New("DEM URL must be an HTTPS URL without credentials or fragment")
	}
	if ip := net.ParseIP(u.Hostname()); ip != nil && !publicIP(ip) {
		return nil, errors.New("DEM URL cannot address a private or local network")
	}
	dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		Proxy: nil, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
		TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 10 * time.Second,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil {
				return nil, err
			}
			if len(ips) == 0 {
				return nil, errors.New("DEM host resolved to no addresses")
			}
			for _, ip := range ips {
				if !publicIP(ip.IP) {
					return nil, errors.New("DEM host resolved to a private or local network")
				}
			}
			// Dial the validated address, not a second, potentially changed DNS lookup.
			return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
		},
	}
	s := &HTTPSource{url: rawURL, client: &http.Client{Transport: transport, Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	if _, err := s.fetch(ctx, 0, 0); err != nil {
		return nil, err
	}
	// The one-byte probe discovers size and pins the ETag without assuming
	// that the remote object is at least 16 KiB.
	return s, nil
}
func publicIP(ip net.IP) bool {
	return !(ip.IsUnspecified() || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsInterfaceLocalMulticast())
}
func (s *HTTPSource) Close()           { s.client.CloseIdleConnections() }
func (s *HTTPSource) Name() string     { return s.url }
func (s *HTTPSource) Size() int64      { s.mu.Lock(); defer s.mu.Unlock(); return s.size }
func (s *HTTPSource) BytesRead() int64 { s.mu.Lock(); defer s.mu.Unlock(); return s.bytesRead }
func (s *HTTPSource) Requests() int    { s.mu.Lock(); defer s.mu.Unlock(); return s.requests }
func (s *HTTPSource) ReadAt(p []byte, off int64) (int, error) {
	size := s.Size()
	if off < 0 || off >= size || len(p) == 0 {
		return 0, errors.New("invalid remote range")
	}
	end := off + int64(len(p)) - 1
	if end >= size {
		end = size - 1
	}
	if end-off+1 > MaxRangeBytes {
		return 0, errors.New("remote range exceeds resource limit")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	b, err := s.fetch(ctx, off, end)
	if err != nil {
		return 0, err
	}
	copy(p, b)
	if len(b) < len(p) {
		return len(b), io.EOF
	}
	return len(b), nil
}
func (s *HTTPSource) fetch(ctx context.Context, start, end int64) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.requests >= MaxRemoteRequests || s.bytesRead+end-start+1 > MaxRemoteTransfer {
		return nil, errors.New("remote DEM transfer budget exceeded")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, end))
	req.Header.Set("Accept-Encoding", "identity")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	s.requests++
	if resp.StatusCode != http.StatusPartialContent {
		return nil, fmt.Errorf("DEM server must return 206 for ranges (got %d)", resp.StatusCode)
	}
	cr := strings.TrimSpace(resp.Header.Get("Content-Range"))
	if !strings.HasPrefix(cr, "bytes ") {
		return nil, errors.New("missing Content-Range")
	}
	rangeTotal := strings.Split(strings.TrimPrefix(cr, "bytes "), "/")
	if len(rangeTotal) != 2 {
		return nil, errors.New("invalid Content-Range")
	}
	bounds := strings.Split(rangeTotal[0], "-")
	if len(bounds) != 2 {
		return nil, errors.New("invalid Content-Range")
	}
	gotStart, e1 := strconv.ParseInt(bounds[0], 10, 64)
	gotEnd, e2 := strconv.ParseInt(bounds[1], 10, 64)
	total, e3 := strconv.ParseInt(rangeTotal[1], 10, 64)
	if e1 != nil || e2 != nil || e3 != nil || gotStart != start || gotEnd != end || total <= 0 || total > MaxRemoteBytes {
		return nil, errors.New("invalid or oversized Content-Range")
	}
	etag := resp.Header.Get("ETag")
	if etag == "" {
		return nil, errors.New("range source requires an ETag")
	}
	if s.etag == "" {
		s.etag = etag
		s.size = total
	} else if s.etag != etag || s.size != total {
		return nil, errors.New("remote DEM changed during read")
	}
	if resp.ContentLength != end-start+1 {
		return nil, errors.New("range Content-Length mismatch")
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, MaxRangeBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) != end-start+1 {
		return nil, errors.New("truncated range response")
	}
	s.bytesRead += int64(len(b))
	return b, nil
}

// Used only by package tests to exercise the range protocol over loopback HTTP.
func testHTTPSource(rawURL string, size int64, etag string) *HTTPSource {
	return &HTTPSource{url: rawURL, size: size, etag: etag, client: &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}
