package geotiff

import (
	"bytes"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func sampleRaster(w, h int) []float64 {
	data := make([]float64, w*h)
	for i := range data {
		data[i] = float64((i*37)%2000) - 1000
	}
	return data
}

func writeAndOpen(t *testing.T, o WriteOptions) (*File, []byte) {
	t.Helper()
	var buf bytes.Buffer
	if err := Write(&buf, o); err != nil {
		t.Fatal(err)
	}
	f, err := Open(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}
	return f, buf.Bytes()
}

var projectedKeys = map[int]GeoKey{1024: {ID: 1024, Short: 1, Kind: 's'}, 1025: {ID: 1025, Short: 1, Kind: 's'}}

// Every layout the writer can produce reads back sample for sample, with its
// georeferencing, NoData, band scaling and dataset tags intact.
func TestWriteOpenRoundTrip(t *testing.T) {
	scale, offset := 0.5, 1737400.0
	cases := []struct {
		name string
		o    WriteOptions
	}{
		{"float32 strips", WriteOptions{BitsPerSample: 32, SampleFormat: SampleFloat}},
		{"float64 strips deflate", WriteOptions{BitsPerSample: 64, SampleFormat: SampleFloat, Deflate: true}},
		{"int16 tiles deflate, scaled", WriteOptions{BitsPerSample: 16, SampleFormat: SampleInt, TileSize: 16, Deflate: true, Scale: &scale, Offset: &offset}},
		{"int32 tiles", WriteOptions{BitsPerSample: 32, SampleFormat: SampleInt, TileSize: 32}},
	}
	const w, h = 53, 41 // deliberately not multiples of the block sizes
	for _, c := range cases {
		o := c.o
		o.Width, o.Height, o.Data = w, h, sampleRaster(w, h)
		o.Geotransform = [6]float64{-1000, 20, 0, 3000, 0, -20}
		o.GeoKeys, o.HasNoData, o.NoData = projectedKeys, true, -32768
		o.Tags = map[string]string{"LUNAR_SIM_SOURCE": "SYNTHETIC", "NOTE": "a & b <c>"}
		o.Data[5] = o.NoData
		f, _ := writeAndOpen(t, o)
		if f.Width != w || f.Height != h || f.BitsPerSample != o.BitsPerSample || f.SampleFormat != o.SampleFormat || f.SamplesPerPixel != 1 {
			t.Fatalf("%s: header %dx%d %d-bit format %d", c.name, f.Width, f.Height, f.BitsPerSample, f.SampleFormat)
		}
		if (f.TileWidth > 0) != (o.TileSize > 0) || (o.Deflate && f.Compression != 8) || (!o.Deflate && f.Compression != 1) {
			t.Fatalf("%s: layout tile=%d compression=%d", c.name, f.TileWidth, f.Compression)
		}
		gt, ok := f.Geotransform()
		if !ok || gt != o.Geotransform {
			t.Fatalf("%s: geotransform %v", c.name, gt)
		}
		if !f.HasNoData || f.NoData != -32768 || !f.IsNoData(-32768) || f.IsNoData(0) {
			t.Fatalf("%s: NoData %v %v", c.name, f.HasNoData, f.NoData)
		}
		if f.Tags["LUNAR_SIM_SOURCE"] != "SYNTHETIC" || f.Tags["NOTE"] != "a & b <c>" {
			t.Fatalf("%s: tags %v", c.name, f.Tags)
		}
		if o.Scale != nil && (!f.HasScale || f.Scale != 0.5 || !f.HasOffset || f.Offset != 1737400) {
			t.Fatalf("%s: band scaling %v %v", c.name, f.Scale, f.Offset)
		}
		all, err := f.ReadWindow(0, 0, w, h)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		for i, v := range all {
			if v != o.Data[i] {
				t.Fatalf("%s: sample %d is %v, wrote %v", c.name, i, v, o.Data[i])
			}
		}
		// A window that straddles block boundaries equals the same region of the full read.
		const x0, y0, ww, wh = 11, 9, 30, 27
		win, err := f.ReadWindow(x0, y0, ww, wh)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		for r := 0; r < wh; r++ {
			for col := 0; col < ww; col++ {
				if win[r*ww+col] != o.Data[(y0+r)*w+x0+col] {
					t.Fatalf("%s: window sample (%d,%d) differs", c.name, col, r)
				}
			}
		}
		if v, ok, err := f.Pixel(w-1, h-1); err != nil || !ok || v != o.Data[w*h-1] {
			t.Fatalf("%s: last pixel %v %v %v", c.name, v, ok, err)
		}
		if _, err := f.ReadWindow(w-2, 0, 3, 1); err == nil {
			t.Fatalf("%s: a window outside the raster was accepted", c.name)
		}
	}
}

func TestNaNNoData(t *testing.T) {
	o := WriteOptions{Width: 4, Height: 4, BitsPerSample: 32, SampleFormat: SampleFloat, Data: sampleRaster(4, 4), Geotransform: [6]float64{0, 1, 0, 0, 0, -1},
		GeoKeys: projectedKeys, HasNoData: true, NoData: math.NaN()}
	o.Data[3] = math.NaN()
	f, _ := writeAndOpen(t, o)
	if !f.HasNoData || !math.IsNaN(f.NoData) || !f.IsNoData(math.NaN()) || f.IsNoData(1) {
		t.Fatalf("NaN NoData not preserved: %v %v", f.HasNoData, f.NoData)
	}
	if v, _, _ := f.Pixel(3, 0); !math.IsNaN(v) {
		t.Fatalf("NaN sample read back as %v", v)
	}
}

// PackBits example from Apple Technical Note TN1023.
func TestPackBitsKnownVector(t *testing.T) {
	packed := []byte{0xFE, 0xAA, 0x02, 0x80, 0x00, 0x2A, 0xFD, 0xAA, 0x03, 0x80, 0x00, 0x2A, 0x22, 0xF7, 0xAA}
	want := []byte{0xAA, 0xAA, 0xAA, 0x80, 0x00, 0x2A, 0xAA, 0xAA, 0xAA, 0xAA, 0x80, 0x00, 0x2A, 0x22, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA}
	got, err := packBitsDecode(packed, len(want))
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("PackBits: % X, %v", got, err)
	}
	if _, err := packBitsDecode(packed[:5], len(want)); err == nil {
		t.Fatal("truncated PackBits data was accepted")
	}
}

// Classic LZW test string from the TIFF 6.0 specification discussion: the
// bytes 7,7,7,8,8,7,7,6,6 encode to the 9-bit codes 256,7,258,8,8,258,6,6,257.
func TestLZWKnownVector(t *testing.T) {
	codes := []int{256, 7, 258, 8, 8, 258, 6, 6, 257}
	var packed []byte
	acc, bits := 0, 0
	for _, c := range codes {
		acc, bits = acc<<9|c, bits+9
		for bits >= 8 {
			packed = append(packed, byte(acc>>(bits-8)))
			bits -= 8
		}
	}
	if bits > 0 {
		packed = append(packed, byte(acc<<(8-bits)))
	}
	want := []byte{7, 7, 7, 8, 8, 7, 7, 6, 6}
	got, err := lzwDecode(packed, len(want))
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("LZW: %v, %v", got, err)
	}
}

// The reader also serves bounded remote reads, so damaged or truncated input
// must produce an error, never a panic or an out-of-range read.
func TestDamagedInputNeverPanics(t *testing.T) {
	o := WriteOptions{Width: 40, Height: 40, BitsPerSample: 16, SampleFormat: SampleInt, Data: sampleRaster(40, 40), Geotransform: [6]float64{0, 1, 0, 0, 0, -1},
		GeoKeys: projectedKeys, TileSize: 16, Deflate: true, HasNoData: true, NoData: -32768}
	_, valid := writeAndOpen(t, o)
	try := func(label string, data []byte) {
		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("%s: panic: %v", label, r)
			}
		}()
		f, err := Open(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			return
		}
		if f.Width > 0 && f.Height > 0 && f.Width <= 4096 && f.Height <= 4096 {
			f.ReadWindow(0, 0, f.Width, f.Height) // error or data; never a panic
		}
	}
	for n := 0; n < len(valid); n += 7 {
		try("truncated", valid[:n])
	}
	// Flip each byte of the header, the IFD and the first block in turn.
	for i := 0; i < len(valid); i += 3 {
		damaged := append([]byte(nil), valid...)
		damaged[i] ^= 0xFF
		try("corrupted", damaged)
	}
	try("empty", nil)
	try("not a TIFF", []byte("GIF89a not a tiff at all, just text padding to pass any minimum size"))
}

// Rasters written by GDAL (the golden fixtures) open with the expected shapes.
func TestOpensGDALWrittenFixtures(t *testing.T) {
	paths, _ := filepath.Glob("../../tests/golden/dem/*.tif")
	if len(paths) < 15 {
		t.Fatalf("golden rasters are missing: found %d", len(paths))
	}
	opened := 0
	for _, p := range paths {
		raw, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		f, err := Open(bytes.NewReader(raw), int64(len(raw)))
		if err != nil {
			continue // deliberately invalid fixtures are covered, with exact messages, by the terrain tests
		}
		if f.SamplesPerPixel != 1 {
			// Multi-band imagery opens (so the terrain layer can name what is wrong) but sample access is refused.
			if _, _, err := f.Pixel(0, 0); err == nil {
				t.Fatalf("%s: sample access to a %d-band raster was allowed", filepath.Base(p), f.SamplesPerPixel)
			}
			continue
		}
		opened++
		if f.Width <= 0 || f.Height <= 0 || len(f.Offsets) == 0 || len(f.Offsets) != len(f.ByteCounts) {
			t.Fatalf("%s: implausible header %dx%d, %d blocks", filepath.Base(p), f.Width, f.Height, len(f.Offsets))
		}
		if _, _, err := f.Pixel(f.Width/2, f.Height/2); err != nil {
			t.Fatalf("%s: centre pixel: %v", filepath.Base(p), err)
		}
	}
	if opened < 12 {
		t.Fatalf("only %d of %d golden rasters opened", opened, len(paths))
	}
}
