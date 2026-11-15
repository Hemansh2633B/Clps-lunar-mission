// Package handler is the Vercel Go function for CHANDRA's API. Every /api/*
// request is rewritten to this single function (see vercel.json), which
// dispatches through the same router the local server uses.
package handler

import (
	"net/http"
	"os"
	"sync"

	"chandra/backend/httpapi"
)

var (
	once sync.Once
	api  http.Handler
	boot error
)

// vercelEnv is the process environment with VERCEL always set. This entry point
// only ever runs as the Vercel function, so it declares that itself: the VERCEL
// system variable reaches the runtime only while the project's "Automatically
// expose System Environment Variables" setting is on, and without it the API
// would pick a read-only data directory and distrust the platform's client address.
func vercelEnv(key string) string {
	if key == "VERCEL" {
		return "1"
	}
	return os.Getenv(key)
}

// Handler serves every CHANDRA API route.
func Handler(w http.ResponseWriter, r *http.Request) {
	once.Do(func() {
		root, _ := os.Getwd()
		var o httpapi.Options
		if o, boot = httpapi.FromEnv(vercelEnv, root); boot == nil {
			api = httpapi.New(o)
		}
	})
	if boot != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"Terrain API is misconfigured. Check the deployment environment variables."}` + "\n"))
		return
	}
	api.ServeHTTP(w, r)
}
