// Command chandra-horizon computes a terrain grid and horizon mask from a JSON
// request on stdin (the same body as POST /api/horizon) and prints
// {"terrain": ..., "horizon": ...}. It backs the TypeScript/native parity check
// and is handy for offline batch runs.
//
//	echo '{"latitude":-89.5,"longitude":45,"radius_km":5,"mode":"synthetic"}' | go run ./cmd/chandra-horizon
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"

	"chandra/backend/terrain"
)

func main() {
	dem := flag.String("dem", os.Getenv("LUNAR_DEM_PATH"), "Local GeoTIFF for real-mode requests")
	demConfig := flag.String("dem-config", os.Getenv("LUNAR_DEM_CONFIG"), "DEM configuration JSON")
	flag.Parse()
	fail := func(err error) {
		fmt.Fprintln(os.Stderr, "chandra-horizon:", err)
		os.Exit(1)
	}
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, terrain.MaxRequestBytes))
	if err != nil {
		fail(err)
	}
	var body terrain.Request
	if err := json.Unmarshal(raw, &body); err != nil {
		fail(fmt.Errorf("stdin must be a JSON object: %w", err))
	}
	root, _ := os.Getwd()
	settings, err := terrain.LoadSettings(*dem, *demConfig, root)
	if err != nil {
		fail(err)
	}
	t, err := terrain.Build(terrain.SettingsOpener(settings), body)
	if err != nil {
		fail(err)
	}
	az, eye := any(2.0), any(2.0)
	if v, ok := body["az_step_deg"]; ok {
		az = v
	}
	if v, ok := body["eye_height_m"]; ok {
		eye = v
	}
	h, err := terrain.HorizonFromGrid(t, az, eye)
	if err != nil {
		fail(err)
	}
	if err := json.NewEncoder(os.Stdout).Encode(map[string]any{"terrain": t, "horizon": h}); err != nil {
		fail(err)
	}
}
