// Command spike-server serves the isolated Vercel Go handler locally.
// It is not the production backend and does not replace Python.
package main

import (
	"log"
	"net/http"
	"os"

	handler "github.com/Hemansh2633B/Clps-lunar-mission/api"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", handler.Handler)
	log.Fatal(http.ListenAndServe("0.0.0.0:"+port, mux))
}
