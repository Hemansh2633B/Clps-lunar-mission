// Command chandra-lola downloads a small native-resolution subset of a NASA
// LOLA south-pole cloud-optimised GeoTIFF by HTTP range reads (the native
// replacement for `python -m backend.download_lola_subset`). It never downloads
// the whole product and only contacts the allowlisted NASA host.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"chandra/backend/lola"
)

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "Subset download failed: "+format+"\n", args...)
	os.Exit(1)
}

func main() {
	lat := flag.Float64("latitude", -89.5, "Planetocentric latitude, degrees")
	lon := flag.Float64("longitude", 45, "East longitude, degrees")
	radius := flag.Float64("radius", 5, "Covered analysis radius in km")
	output := flag.String("output", "data/lola_example_south_pole.tif", "Subset GeoTIFF to create")
	configOut := flag.String("config-output", "data/lola_example_config.json", "DEM configuration JSON to create")
	productID := flag.String("product", lola.LDEM80S20M.ID, "Catalogue product id")
	dryRun := flag.Bool("dry-run", false, "Only check coverage and report the planned window")
	timeout := flag.Duration("timeout", 10*time.Minute, "Overall time limit")
	flag.Parse()

	product, ok := lola.Products[*productID]
	if !ok {
		fail("unknown product %q", *productID)
	}
	outAbs, _ := filepath.Abs(*output)
	cfgAbs, _ := filepath.Abs(*configOut)
	if !*dryRun {
		for _, p := range []string{outAbs, cfgAbs} {
			if _, err := os.Stat(p); err == nil {
				fail("Output already exists. Choose new --output and --config-output paths to preserve existing data.")
			}
		}
		if outAbs == cfgAbs {
			fail("Raster and configuration must use different output paths.")
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	sub, err := lola.Acquire(ctx, lola.Options{Product: product}, *lat, *lon, *radius, *dryRun)
	if err != nil {
		fail("%v", err)
	}
	if *dryRun {
		plan, _ := json.MarshalIndent(sub.Plan, "", "  ")
		fmt.Printf("Coverage check passed for %s:\n%s\n", product.ID, plan)
		return
	}
	root, _ := os.Getwd()
	if rel, err := filepath.Rel(root, outAbs); err == nil && !filepath.IsAbs(rel) && rel != ".." && len(rel) > 0 && rel[0] != '.' {
		sub.Config["dem_path"] = filepath.ToSlash(rel)
	} else {
		sub.Config["dem_path"] = outAbs
	}
	if err := os.MkdirAll(filepath.Dir(outAbs), 0o755); err != nil {
		fail("%v", err)
	}
	// O_EXCL: never overwrite data that appeared while downloading.
	fh, err := os.OpenFile(outAbs, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		fail("%v", err)
	}
	if _, err := fh.Write(sub.TIFF); err != nil {
		fh.Close()
		os.Remove(outAbs)
		fail("%v", err)
	}
	fh.Close()
	cfg, _ := json.MarshalIndent(sub.Config, "", "  ")
	if err := os.MkdirAll(filepath.Dir(cfgAbs), 0o755); err != nil {
		fail("%v", err)
	}
	if err := os.WriteFile(cfgAbs, append(cfg, '\n'), 0o644); err != nil {
		fail("%v", err)
	}
	prov := sub.Config["subset_provenance"].(map[string]any)
	fmt.Printf("Saved NASA LOLA subset (%.2f MB): %s\n", float64(len(sub.TIFF))/1e6, *output)
	fmt.Printf("Native landing elevation: %.3f m\n", prov["native_landing_elevation_m"])
	fmt.Printf("SHA-256: %s\n", sub.SHA256)
	fmt.Printf("Run: npm run dev:api -- --dem-config %s\n", *configOut)
	fmt.Println("Source heights and CRS are preserved. Scientific mission accuracy has not been independently validated.")
}
