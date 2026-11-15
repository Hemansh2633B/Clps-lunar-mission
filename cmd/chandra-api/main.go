// Command chandra-api is CHANDRA's local terrain API server (the native
// replacement for `python -m backend.server`). It also serves the built console
// from dist/ when present.
//
//	go run ./cmd/chandra-api --dem-config data/lola_example_config.json
package main

import (
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"chandra/backend/httpapi"
)

func main() {
	env := func(keys ...string) string {
		for _, k := range keys {
			if v := os.Getenv(k); v != "" {
				return v
			}
		}
		return ""
	}
	port := env("CHANDRA_API_PORT", "PORT")
	if port == "" {
		port = "8000"
	}
	dem := flag.String("dem", os.Getenv("LUNAR_DEM_PATH"), "Local GeoTIFF, relative to the project root or absolute")
	demConfig := flag.String("dem-config", os.Getenv("LUNAR_DEM_CONFIG"), "JSON file with verified vertical datum/units/frame")
	host := flag.String("host", "0.0.0.0", "Interface to bind")
	flag.StringVar(&port, "port", port, "TCP port")
	static := flag.String("static", "", "Directory with the built console (default: ./dist when it exists)")
	flag.Parse()

	root, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}
	getenv := func(k string) string {
		switch k {
		case "LUNAR_DEM_PATH":
			return *dem
		case "LUNAR_DEM_CONFIG":
			return *demConfig
		}
		return os.Getenv(k)
	}
	opts, err := httpapi.FromEnv(getenv, root)
	if err != nil {
		fmt.Fprintln(os.Stderr, "chandra-api:", err)
		os.Exit(2)
	}
	if *static != "" {
		opts.StaticDir = *static
	} else if _, err := os.Stat(filepath.Join(root, "dist", "index.html")); err == nil {
		opts.StaticDir = filepath.Join(root, "dist")
	}
	srv := &http.Server{
		Addr: net.JoinHostPort(*host, port), Handler: httpapi.New(opts),
		ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 90 * time.Second, IdleTimeout: 120 * time.Second,
		MaxHeaderBytes: 1 << 16,
	}
	demNote := "no DEM configured (synthetic demo + acquisition only)"
	if opts.Settings.DEMPath != "" {
		demNote = "DEM " + opts.Settings.DEMPath
	}
	log.Printf("CHANDRA Terrain Lab API (native Go) listening on http://%s — %s; storage: %s", srv.Addr, demNote, opts.Store.Kind())
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
