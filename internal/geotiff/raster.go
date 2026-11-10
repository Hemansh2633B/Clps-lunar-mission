// Package geotiff is an isolated, bounded reader for CHANDRA's single-band
// little-endian float32 GeoTIFFs. No native GDAL and no whole-image decoding.
package geotiff

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"

	"github.com/Hemansh2633B/Clps-lunar-mission/internal/lunarcrs"
)

const MaxWindowPixels = 16_000_000
const MaxBlockPixels = 1_048_576
const MaxMetadataBytes = 4 << 20

type Source interface {
	ReadAt([]byte, int64) (int, error)
	Size() int64
	Name() string
}
type FileSource struct {
	R    *bytes.Reader
	Path string
	N    int64
}

func (s *FileSource) ReadAt(p []byte, o int64) (int, error) { return s.R.ReadAt(p, o) }
func (s *FileSource) Size() int64                           { return s.N }
func (s *FileSource) Name() string                          { return s.Path }

type GeoKey struct{ ID, Location, Count, Offset uint16 }
type Raster struct {
	source                                 Source
	order                                  binary.ByteOrder
	tags                                   map[uint16][]float64
	text                                   map[uint16]string
	Width, Height, BlockWidth, BlockHeight int
	Compression, Predictor                 int
	Tiled                                  bool
	offsets, counts                        []float64
	Scale, Offset                          float64
	NoData                                 float64
	HasNoData                              bool
	CRS                                    *lunarcrs.CRS
	WKT                                    string
	GeoKeys                                []GeoKey
	C, X0, Y0, PixelY                      float64 // affine, no rotation supported
	Synthetic                              bool
	BytesRead                              int64
	Reads                                  int
	cache                                  map[int][]float64
	cacheOrder                             []int
	CacheBlocks                            int
}

func Open(s Source) (*Raster, error) {
	r := &Raster{source: s, tags: map[uint16][]float64{}, text: map[uint16]string{}, Scale: 1, cache: map[int][]float64{}, CacheBlocks: 4}
	if s.Size() < 8 || s.Size() > 1<<40 {
		return nil, errors.New("invalid raster size")
	}
	head, err := r.read(0, 8)
	if err != nil {
		return nil, err
	}
	switch string(head[:2]) {
	case "II":
		r.order = binary.LittleEndian
	case "MM":
		r.order = binary.BigEndian
	default:
		return nil, errors.New("not TIFF")
	}
	if r.order.Uint16(head[2:]) != 42 {
		return nil, errors.New("BigTIFF is not supported by this spike")
	}
	ifd := int64(r.order.Uint32(head[4:]))
	if ifd < 8 || ifd >= s.Size() {
		return nil, errors.New("invalid IFD offset")
	}
	b, err := r.read(ifd, 2)
	if err != nil {
		return nil, err
	}
	n := int(r.order.Uint16(b))
	if n < 1 || n > 1024 {
		return nil, errors.New("invalid IFD count")
	}
	entries, err := r.read(ifd+2, n*12)
	if err != nil {
		return nil, err
	}
	sizes := map[uint16]int{1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8}
	for i := 0; i < n; i++ {
		e := entries[i*12:]
		tag := r.order.Uint16(e)
		typ := r.order.Uint16(e[2:])
		count := int(r.order.Uint32(e[4:]))
		sz, ok := sizes[typ]
		if !ok || count < 1 || count > MaxMetadataBytes/sz {
			return nil, fmt.Errorf("invalid TIFF tag %d", tag)
		}
		off := int64(r.order.Uint32(e[8:]))
		// TIFF inline values are left-justified, even a single DOUBLE (8 bytes)
		// or FLOAT (4 bytes). Only values larger than four bytes use an offset.
		if count*sz > 4 {
			if off < 0 || off+int64(count*sz) > s.Size() {
				return nil, errors.New("TIFF tag outside file")
			}
		} else {
			off = ifd + 2 + int64(i*12) + 8
		}
		data, err := r.read(off, count*sz)
		if err != nil {
			return nil, err
		}
		if typ == 2 || typ == 7 {
			r.text[tag] = strings.TrimRight(string(data), "\x00")
			continue
		}
		values := make([]float64, count)
		for j := range values {
			d := data[j*sz:]
			switch typ {
			case 1, 7:
				values[j] = float64(d[0])
			case 3:
				values[j] = float64(r.order.Uint16(d))
			case 4:
				values[j] = float64(r.order.Uint32(d))
			case 11:
				values[j] = float64(math.Float32frombits(r.order.Uint32(d)))
			case 12:
				values[j] = math.Float64frombits(r.order.Uint64(d))
			case 9:
				values[j] = float64(int32(r.order.Uint32(d)))
			default:
				return nil, fmt.Errorf("unsupported TIFF field type %d in tag %d", typ, tag)
			}
		}
		r.tags[tag] = values
	}
	one := func(tag uint16) float64 {
		v := r.tags[tag]
		if len(v) > 0 {
			return v[0]
		}
		return 0
	}
	if one(258) != 32 || one(339) != 3 || one(277) != 1 {
		return nil, errors.New("spike requires one IEEE float32 elevation band")
	}
	r.Width = int(one(256))
	r.Height = int(one(257))
	if r.Width < 2 || r.Height < 2 || int64(r.Width)*int64(r.Height) > 1<<36 {
		return nil, errors.New("invalid raster dimensions")
	}
	r.Compression = int(one(259))
	r.Predictor = int(one(317))
	if (r.Compression != 1 && r.Compression != 8 && r.Compression != 32946) || r.Predictor < 1 || r.Predictor > 3 {
		return nil, errors.New("unsupported TIFF compression/predictor")
	}
	r.BlockWidth, r.BlockHeight = r.Width, 1
	r.Tiled = len(r.tags[322]) > 0
	if r.Tiled {
		r.BlockWidth, r.BlockHeight = int(one(322)), int(one(323))
		r.offsets, r.counts = r.tags[324], r.tags[325]
	} else {
		if one(278) > 0 {
			r.BlockHeight = int(one(278))
		}
		r.offsets, r.counts = r.tags[273], r.tags[279]
	}
	nx := (r.Width + r.BlockWidth - 1) / r.BlockWidth
	ny := (r.Height + r.BlockHeight - 1) / r.BlockHeight
	if r.BlockWidth < 1 || r.BlockHeight < 1 || r.BlockWidth*r.BlockHeight > MaxBlockPixels || len(r.offsets) != nx*ny || len(r.counts) != len(r.offsets) {
		return nil, errors.New("invalid TIFF block layout")
	}
	for i, o := range r.offsets {
		if o < 0 || o+r.counts[i] > float64(s.Size()) || r.counts[i] <= 0 || r.counts[i] > 32<<20 {
			return nil, errors.New("invalid TIFF block range")
		}
	}
	if v := r.tags[33550]; len(v) == 3 {
		if v[0] <= 0 || v[1] <= 0 || v[2] != 0 {
			return nil, errors.New("invalid pixel scale")
		}
	} else {
		return nil, errors.New("missing ModelPixelScale")
	}
	tie := r.tags[33922]
	if len(tie) != 6 || tie[0] != 0 || tie[1] != 0 || tie[2] != 0 {
		return nil, errors.New("an origin ModelTiepoint is required")
	}
	r.C, r.X0, r.Y0, r.PixelY = r.tags[33550][0], tie[3], tie[4], r.tags[33550][1]
	// Affine x=X0+C*col; y=Y0-R*row.
	if len(r.tags[34264]) > 0 {
		return nil, errors.New("rotated/model-transform rasters are not supported")
	}
	r.Scale, r.Offset = 1, 0
	for _, item := range strings.Split(r.text[42112], "\n") {
		for _, name := range []string{"scale", "offset"} {
			if strings.Contains(strings.ToLower(item), "name=\""+name+"\"") {
				a := strings.Index(item, ">")
				b := strings.LastIndex(item, "<")
				if a >= 0 && b > a {
					v, e := strconv.ParseFloat(strings.TrimSpace(item[a+1:b]), 64)
					if e == nil {
						if name == "scale" {
							r.Scale = v
						} else {
							r.Offset = v
						}
					}
				}
			}
		}
	}
	if !finite(r.Scale) || r.Scale == 0 || !finite(r.Offset) {
		return nil, errors.New("invalid scale/offset")
	}
	if text, ok := r.text[42113]; ok {
		v, err := strconv.ParseFloat(strings.TrimSpace(text), 64)
		if err != nil {
			return nil, errors.New("invalid GDAL_NODATA")
		}
		r.NoData = v
		r.HasNoData = finite(v)
	}
	keys := r.tags[34735]
	if len(keys) < 4 || int(keys[3])*4+4 > len(keys) {
		return nil, errors.New("invalid GeoKeyDirectory")
	}
	for i := 4; i < int(keys[3])*4+4; i += 4 {
		k := GeoKey{uint16(keys[i]), uint16(keys[i+1]), uint16(keys[i+2]), uint16(keys[i+3])}
		r.GeoKeys = append(r.GeoKeys, k)

	}
	r.WKT = r.text[34737]
	for _, k := range r.GeoKeys {
		if (k.ID == 1026 || k.ID == 2049) && k.Location == 34737 && strings.Contains(r.WKT[k.Offset:], "[") {
			end := int(k.Offset) + int(k.Count)
			if end <= len(r.WKT) {
				r.WKT = strings.TrimRight(r.WKT[k.Offset:end], "\x00| ")
			}
		}
	}
	if strings.Contains(r.WKT, "[") {
		r.CRS, err = lunarcrs.ParseWKT(r.WKT)
	} else {
		keys := make([][4]uint16, len(r.GeoKeys))
		for i, k := range r.GeoKeys {
			keys[i] = [4]uint16{k.ID, k.Location, k.Count, k.Offset}
		}
		r.CRS, err = lunarcrs.FromGeoKeys(keys, r.tags[34736], r.text[34737])
	}
	if err != nil {
		return nil, err
	}
	r.Synthetic = strings.Contains(r.text[42112], "LUNAR_SIM_SOURCE=SYNTHETIC") || strings.Contains(r.text[42112], "SYNTHETIC")
	return r, nil
}
func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func (r *Raster) read(off int64, n int) ([]byte, error) {
	if off < 0 || n < 0 || n > MaxMetadataBytes || off+int64(n) > r.source.Size() {
		return nil, errors.New("out-of-bounds metadata read")
	}
	b := make([]byte, n)
	_, err := r.source.ReadAt(b, off)
	r.BytesRead += int64(n)
	r.Reads++
	return b, err
}
func (r *Raster) PixelHeight() float64 { return r.PixelY }
func (r *Raster) Pixel(col, row int) (float64, float64) {
	return r.X0 + r.C*float64(col), r.Y0 - r.tags[33550][1]*float64(row)
}
func (r *Raster) GeoToPixel(x, y float64) (float64, float64) {
	return (x - r.X0) / r.C, (r.Y0 - y) / r.tags[33550][1]
}
func (r *Raster) ReadWindow(col, row, width, height int) ([]float64, error) {
	if col < 0 || row < 0 || width < 1 || height < 1 || width > MaxWindowPixels || height > MaxWindowPixels/width || col+width > r.Width || row+height > r.Height {
		return nil, errors.New("invalid or unbounded raster window")
	}
	out := make([]float64, width*height)
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			v, err := r.pixel(col+x, row+y)
			if err != nil {
				return nil, err
			}
			out[y*width+x] = v
		}
	}
	return out, nil
}
func (r *Raster) pixel(col, row int) (float64, error) {
	nx := (r.Width + r.BlockWidth - 1) / r.BlockWidth
	block := (row/r.BlockHeight)*nx + col/r.BlockWidth
	data, ok := r.cache[block]
	if !ok {
		var err error
		data, err = r.decode(block)
		if err != nil {
			return 0, err
		}
		if len(r.cache) >= r.CacheBlocks {
			delete(r.cache, r.cacheOrder[0])
			r.cacheOrder = r.cacheOrder[1:]
		}
		r.cache[block] = data
		r.cacheOrder = append(r.cacheOrder, block)
	}
	return data[(row%r.BlockHeight)*r.BlockWidth+col%r.BlockWidth], nil
}
func (r *Raster) decode(block int) ([]float64, error) {
	n := int(r.counts[block])
	b := make([]byte, n)
	if _, err := r.source.ReadAt(b, int64(r.offsets[block])); err != nil {
		return nil, err
	}
	r.BytesRead += int64(n)
	r.Reads++
	if r.Compression == 8 || r.Compression == 32946 {
		z, err := zlib.NewReader(bytes.NewReader(b))
		if err != nil {
			return nil, err
		}
		defer z.Close()
		limited := &io.LimitedReader{R: z, N: int64(r.BlockWidth*r.BlockHeight*4 + 1)}
		b, err = io.ReadAll(limited)
		if err != nil {
			return nil, err
		}
		if len(b) != r.BlockWidth*r.BlockHeight*4 {
			return nil, errors.New("TIFF block decompressed size mismatch")
		}
	}
	if len(b) != r.BlockWidth*r.BlockHeight*4 {
		return nil, errors.New("TIFF block byte count mismatch")
	}
	if r.Predictor == 2 {
		for y := 0; y < r.BlockHeight; y++ {
			row := b[y*r.BlockWidth*4:]
			for x := 4; x < len(row); x++ {
				row[x] += row[x-4]
			}
		}
	}
	if r.Predictor == 3 {
		for y := 0; y < r.BlockHeight; y++ {
			row := b[y*r.BlockWidth*4:]
			for x := 1; x < len(row); x++ {
				row[x] += row[x-1]
			}
			for x := 0; x < r.BlockWidth; x++ {
				p := x * 4
				row[p], row[p+1], row[p+2], row[p+3] = row[p+3], row[p+2], row[p+1], row[p]
			}
		}
	}
	values := make([]float64, r.BlockWidth*r.BlockHeight)
	for i := range values {
		values[i] = float64(math.Float32frombits(r.order.Uint32(b[i*4:])))
	}
	return values, nil
}
func (r *Raster) RawValid(v float64) bool     { return finite(v) && (!r.HasNoData || v != r.NoData) }
func (r *Raster) Elevation(v float64) float64 { return v*r.Scale + r.Offset }
func Bilinear(values []float64, width int, u, v float64, valid func(float64) bool) (float64, bool) {
	if width < 2 || len(values)%width != 0 || u < 0 || v < 0 || !finite(u) || !finite(v) {
		return 0, false
	}
	x, y := int(math.Floor(u)), int(math.Floor(v))
	if x >= width || y >= len(values)/width {
		return 0, false
	}
	if x == width-1 {
		x--
		u = float64(x)
	}
	if y == len(values)/width-1 {
		y--
		v = float64(y)
	}
	a, b, c, d := values[y*width+x], values[y*width+x+1], values[(y+1)*width+x], values[(y+1)*width+x+1]
	if !valid(a) || !valid(b) || !valid(c) || !valid(d) {
		return 0, false
	}
	u -= float64(x)
	v -= float64(y)
	return a*(1-u)*(1-v) + b*u*(1-v) + c*(1-u)*v + d*u*v, true
}

func (r *Raster) DebugTags() map[uint16][]float64 { return r.tags }
