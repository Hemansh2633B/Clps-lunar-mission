// Package geotiff is a dependency-free reader/writer for the single-band
// GeoTIFF/BigTIFF rasters CHANDRA uses as lunar elevation sources.
//
// It replaces the GDAL/rasterio layer of the former Python backend. Scope is
// deliberately explicit: baseline TIFF and BigTIFF, both byte orders, strips or
// tiles, compression none/LZW/Deflate/PackBits, predictors 1/2/3, 8/16/32/64-bit
// unsigned, signed and IEEE float samples, GDAL NoData + metadata tags and the
// GeoTIFF georeferencing tags. Anything else is rejected with an explicit error
// instead of being guessed. All remote/untrusted input is bounds-checked.
package geotiff

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
	"sync"
)

// Safety limits for untrusted rasters.
const (
	maxTagValues      = 1 << 24   // entries in one tag (covers 30400² tiled at 256)
	maxBlockBytes     = 256 << 20 // decoded bytes of one strip/tile
	maxEncodedBlock   = 512 << 20 // encoded bytes of one strip/tile
	maxDimension      = 1 << 30   // pixels per axis
	maxIFDs           = 64
	defaultBlockCache = 96
)

// TIFF tag identifiers used by this package.
const (
	tagNewSubfileType  = 254
	tagImageWidth      = 256
	tagImageLength     = 257
	tagBitsPerSample   = 258
	tagCompression     = 259
	tagStripOffsets    = 273
	tagSamplesPerPixel = 277
	tagRowsPerStrip    = 278
	tagStripByteCounts = 279
	tagPlanarConfig    = 284
	tagPredictor       = 317
	tagTileWidth       = 322
	tagTileLength      = 323
	tagTileOffsets     = 324
	tagTileByteCounts  = 325
	tagSampleFormat    = 339
	tagModelPixelScale = 33550
	tagModelTiepoint   = 33922
	tagModelTransform  = 34264
	tagGeoKeyDirectory = 34735
	tagGeoDoubleParams = 34736
	tagGeoASCIIParams  = 34737
	tagGDALMetadata    = 42112
	tagGDALNoData      = 42113
)

// Sample formats.
const (
	SampleUint  = 1
	SampleInt   = 2
	SampleFloat = 3
)

// ErrFormat marks a structurally invalid or unsupported raster.
var ErrFormat = errors.New("geotiff")

func formatErr(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrFormat, fmt.Sprintf(format, args...))
}

// File is an opened single-image TIFF (the first, full-resolution IFD).
type File struct {
	r    io.ReaderAt
	size int64 // -1 when unknown
	bo   binary.ByteOrder
	big  bool

	Width, Height   int
	SamplesPerPixel int
	BitsPerSample   int
	SampleFormat    int
	Compression     int
	Predictor       int
	PlanarConfig    int
	TileWidth       int // 0 for strips
	TileHeight      int
	RowsPerStrip    int
	Offsets         []uint64
	ByteCounts      []uint64

	// GDAL extensions.
	HasNoData bool
	NoData    float64           // may be NaN
	Tags      map[string]string // dataset-level GDAL metadata items
	Scale     float64
	Offset    float64
	HasScale  bool
	HasOffset bool
	MaskIFD   bool // a full-resolution transparency-mask IFD follows
	Overviews int

	// Georeferencing.
	PixelScale []float64
	Tiepoints  []float64
	Transform  []float64
	GeoKeys    map[int]GeoKey
	HasGeoKeys bool

	mu    sync.Mutex
	cache map[int][]float64
	order []int
	// Stats for bounded remote reads.
	BlocksDecoded int
}

// GeoKey is one decoded GeoTIFF key.
type GeoKey struct {
	ID     int
	Short  int
	Double []float64
	ASCII  string
	Kind   byte // 's' short, 'd' double, 'a' ascii
}

type ifdEntry struct {
	tag, typ uint16
	count    uint64
	value    []byte // inline value bytes (4 or 8)
}

var typeSize = map[uint16]uint64{1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8, 17: 8, 18: 8}

// Open parses the first IFD. size may be -1 when unknown (remote streams).
func Open(r io.ReaderAt, size int64) (*File, error) {
	f := &File{r: r, size: size, Scale: 1, Tags: map[string]string{}, cache: map[int][]float64{}, GeoKeys: map[int]GeoKey{}}
	head := make([]byte, 16)
	if err := f.readAt(head[:8], 0); err != nil {
		return nil, formatErr("cannot read TIFF header: %v", err)
	}
	switch string(head[:2]) {
	case "II":
		f.bo = binary.LittleEndian
	case "MM":
		f.bo = binary.BigEndian
	default:
		return nil, formatErr("not a TIFF file (bad byte-order mark)")
	}
	var ifdOffset uint64
	switch f.bo.Uint16(head[2:4]) {
	case 42:
		ifdOffset = uint64(f.bo.Uint32(head[4:8]))
	case 43:
		f.big = true
		if err := f.readAt(head[8:16], 8); err != nil {
			return nil, formatErr("cannot read BigTIFF header: %v", err)
		}
		if f.bo.Uint16(head[4:6]) != 8 || f.bo.Uint16(head[6:8]) != 0 {
			return nil, formatErr("unsupported BigTIFF offset size")
		}
		ifdOffset = f.bo.Uint64(head[8:16])
	default:
		return nil, formatErr("not a TIFF file (bad magic number)")
	}
	entries, next, err := f.readIFD(ifdOffset)
	if err != nil {
		return nil, err
	}
	if err := f.parseMain(entries); err != nil {
		return nil, err
	}
	// Walk the remaining IFD chain only to classify overviews / mask images.
	for n := 1; next != 0 && n < maxIFDs; n++ {
		sub, nn, err := f.readIFD(next)
		if err != nil {
			break // auxiliary images are optional; the main image is intact
		}
		var kind, w, h uint64
		for _, e := range sub {
			switch e.tag {
			case tagNewSubfileType:
				kind, _ = f.scalar(e)
			case tagImageWidth:
				w, _ = f.scalar(e)
			case tagImageLength:
				h, _ = f.scalar(e)
			}
		}
		if kind&4 != 0 && int(w) == f.Width && int(h) == f.Height {
			f.MaskIFD = true
		} else if kind&1 != 0 {
			f.Overviews++
		}
		next = nn
	}
	return f, nil
}

func (f *File) readAt(buf []byte, off int64) error {
	if off < 0 || (f.size >= 0 && off+int64(len(buf)) > f.size) {
		return formatErr("read of %d bytes at offset %d is outside the file", len(buf), off)
	}
	n, err := f.r.ReadAt(buf, off)
	if n == len(buf) {
		return nil
	}
	if err == nil {
		err = io.ErrUnexpectedEOF
	}
	return err
}

func (f *File) readIFD(offset uint64) ([]ifdEntry, uint64, error) {
	if offset == 0 || offset > math.MaxInt64/2 {
		return nil, 0, formatErr("invalid IFD offset")
	}
	countSize, entrySize, valueSize := 2, 12, 4
	if f.big {
		countSize, entrySize, valueSize = 8, 20, 8
	}
	head := make([]byte, countSize)
	if err := f.readAt(head, int64(offset)); err != nil {
		return nil, 0, formatErr("cannot read IFD: %v", err)
	}
	var n uint64
	if f.big {
		n = f.bo.Uint64(head)
	} else {
		n = uint64(f.bo.Uint16(head))
	}
	if n == 0 || n > 4096 {
		return nil, 0, formatErr("implausible IFD entry count %d", n)
	}
	raw := make([]byte, int(n)*entrySize+valueSize)
	if err := f.readAt(raw, int64(offset)+int64(countSize)); err != nil {
		return nil, 0, formatErr("cannot read IFD entries: %v", err)
	}
	entries := make([]ifdEntry, 0, n)
	for i := 0; i < int(n); i++ {
		b := raw[i*entrySize : (i+1)*entrySize]
		e := ifdEntry{tag: f.bo.Uint16(b[0:2]), typ: f.bo.Uint16(b[2:4])}
		if f.big {
			e.count = f.bo.Uint64(b[4:12])
			e.value = b[12:20]
		} else {
			e.count = uint64(f.bo.Uint32(b[4:8]))
			e.value = b[8:12]
		}
		entries = append(entries, e)
	}
	tail := raw[int(n)*entrySize:]
	var next uint64
	if f.big {
		next = f.bo.Uint64(tail)
	} else {
		next = uint64(f.bo.Uint32(tail))
	}
	return entries, next, nil
}

// payload returns the raw value bytes of an entry (inline or out-of-line).
func (f *File) payload(e ifdEntry) ([]byte, error) {
	size, ok := typeSize[e.typ]
	if !ok {
		return nil, formatErr("unsupported TIFF field type %d for tag %d", e.typ, e.tag)
	}
	if e.count > maxTagValues {
		return nil, formatErr("tag %d has an implausible value count %d", e.tag, e.count)
	}
	total := size * e.count
	if total <= uint64(len(e.value)) {
		return e.value[:total], nil
	}
	var off uint64
	if f.big {
		off = f.bo.Uint64(e.value)
	} else {
		off = uint64(f.bo.Uint32(e.value))
	}
	buf := make([]byte, total)
	if err := f.readAt(buf, int64(off)); err != nil {
		return nil, formatErr("cannot read tag %d: %v", e.tag, err)
	}
	return buf, nil
}

func (f *File) uints(e ifdEntry) ([]uint64, error) {
	raw, err := f.payload(e)
	if err != nil {
		return nil, err
	}
	out := make([]uint64, e.count)
	for i := range out {
		switch e.typ {
		case 1, 6, 7:
			out[i] = uint64(raw[i])
		case 3, 8:
			out[i] = uint64(f.bo.Uint16(raw[i*2:]))
		case 4, 9, 13:
			out[i] = uint64(f.bo.Uint32(raw[i*4:]))
		case 16, 17, 18:
			out[i] = f.bo.Uint64(raw[i*8:])
		default:
			return nil, formatErr("tag %d is not an integer field", e.tag)
		}
	}
	return out, nil
}

func (f *File) scalar(e ifdEntry) (uint64, error) {
	v, err := f.uints(e)
	if err != nil || len(v) == 0 {
		return 0, formatErr("tag %d has no integer value", e.tag)
	}
	return v[0], nil
}

func (f *File) doubles(e ifdEntry) ([]float64, error) {
	raw, err := f.payload(e)
	if err != nil {
		return nil, err
	}
	out := make([]float64, e.count)
	for i := range out {
		switch e.typ {
		case 12:
			out[i] = math.Float64frombits(f.bo.Uint64(raw[i*8:]))
		case 11:
			out[i] = float64(math.Float32frombits(f.bo.Uint32(raw[i*4:])))
		default:
			return nil, formatErr("tag %d is not a floating-point field", e.tag)
		}
	}
	return out, nil
}

func (f *File) ascii(e ifdEntry) (string, error) {
	raw, err := f.payload(e)
	if err != nil {
		return "", err
	}
	return strings.TrimRight(string(raw), "\x00"), nil
}

func (f *File) parseMain(entries []ifdEntry) error {
	f.SamplesPerPixel, f.BitsPerSample, f.SampleFormat = 1, 1, SampleUint
	f.Compression, f.Predictor, f.PlanarConfig = 1, 1, 1
	var stripOff, stripCnt, tileOff, tileCnt []uint64
	var keyDir []uint64
	var keyDoubles []float64
	var keyASCII string
	rowsPerStrip := uint64(math.MaxUint32)
	for _, e := range entries {
		var err error
		var v uint64
		switch e.tag {
		case tagImageWidth:
			v, err = f.scalar(e)
			f.Width = int(v)
		case tagImageLength:
			v, err = f.scalar(e)
			f.Height = int(v)
		case tagBitsPerSample:
			var all []uint64
			if all, err = f.uints(e); err == nil {
				for _, b := range all {
					if b != all[0] {
						return formatErr("bands with different bit depths are not supported")
					}
				}
				f.BitsPerSample = int(all[0])
			}
		case tagSampleFormat:
			v, err = f.scalar(e)
			f.SampleFormat = int(v)
		case tagCompression:
			v, err = f.scalar(e)
			f.Compression = int(v)
		case tagSamplesPerPixel:
			v, err = f.scalar(e)
			f.SamplesPerPixel = int(v)
		case tagRowsPerStrip:
			rowsPerStrip, err = f.scalar(e)
		case tagPlanarConfig:
			v, err = f.scalar(e)
			f.PlanarConfig = int(v)
		case tagPredictor:
			v, err = f.scalar(e)
			f.Predictor = int(v)
		case tagTileWidth:
			v, err = f.scalar(e)
			f.TileWidth = int(v)
		case tagTileLength:
			v, err = f.scalar(e)
			f.TileHeight = int(v)
		case tagStripOffsets:
			stripOff, err = f.uints(e)
		case tagStripByteCounts:
			stripCnt, err = f.uints(e)
		case tagTileOffsets:
			tileOff, err = f.uints(e)
		case tagTileByteCounts:
			tileCnt, err = f.uints(e)
		case tagModelPixelScale:
			f.PixelScale, err = f.doubles(e)
		case tagModelTiepoint:
			f.Tiepoints, err = f.doubles(e)
		case tagModelTransform:
			f.Transform, err = f.doubles(e)
		case tagGeoKeyDirectory:
			keyDir, err = f.uints(e)
		case tagGeoDoubleParams:
			keyDoubles, err = f.doubles(e)
		case tagGeoASCIIParams:
			keyASCII, err = f.ascii(e)
		case tagGDALNoData:
			var s string
			if s, err = f.ascii(e); err == nil {
				if val, perr := strconv.ParseFloat(strings.TrimSpace(s), 64); perr == nil {
					f.HasNoData, f.NoData = true, val
				}
			}
		case tagGDALMetadata:
			var s string
			if s, err = f.ascii(e); err == nil {
				f.parseGDALMetadata(s)
			}
		}
		if err != nil {
			return err
		}
	}
	if f.Width <= 0 || f.Height <= 0 || f.Width > maxDimension || f.Height > maxDimension {
		return formatErr("invalid raster dimensions %dx%d", f.Width, f.Height)
	}
	if f.SamplesPerPixel < 1 || f.SamplesPerPixel > 64 {
		return formatErr("invalid band count %d", f.SamplesPerPixel)
	}
	switch f.BitsPerSample {
	case 8, 16, 32, 64:
	default:
		return formatErr("unsupported bit depth %d", f.BitsPerSample)
	}
	if f.SampleFormat < SampleUint || f.SampleFormat > SampleFloat || (f.SampleFormat == SampleFloat && f.BitsPerSample < 32) {
		return formatErr("unsupported sample format %d with %d bits", f.SampleFormat, f.BitsPerSample)
	}
	if f.TileWidth > 0 || f.TileHeight > 0 {
		if f.TileWidth <= 0 || f.TileHeight <= 0 {
			return formatErr("incomplete tile layout")
		}
		f.Offsets, f.ByteCounts = tileOff, tileCnt
	} else {
		if rowsPerStrip == 0 {
			return formatErr("invalid RowsPerStrip")
		}
		if rowsPerStrip > uint64(f.Height) {
			rowsPerStrip = uint64(f.Height)
		}
		f.RowsPerStrip = int(rowsPerStrip)
		f.Offsets, f.ByteCounts = stripOff, stripCnt
	}
	across, down := f.blockGrid()
	want := across * down
	if f.PlanarConfig == 2 {
		want *= f.SamplesPerPixel
	}
	if len(f.Offsets) != want || len(f.ByteCounts) != want {
		return formatErr("block table has %d offsets / %d sizes, expected %d", len(f.Offsets), len(f.ByteCounts), want)
	}
	bw, bh := f.blockSize()
	if uint64(bw)*uint64(bh)*uint64(f.BitsPerSample/8)*uint64(f.SamplesPerPixel) > maxBlockBytes {
		return formatErr("strip/tile size %dx%d exceeds the decoder limit", bw, bh)
	}
	if len(keyDir) >= 4 {
		f.HasGeoKeys = true
		n := int(keyDir[3])
		for i := 0; i < n && 4+i*4+3 < len(keyDir); i++ {
			id, loc, count, off := int(keyDir[4+i*4]), keyDir[5+i*4], int(keyDir[6+i*4]), int(keyDir[7+i*4])
			k := GeoKey{ID: id}
			switch loc {
			case 0:
				k.Kind, k.Short = 's', off
			case tagGeoDoubleParams:
				if off < 0 || count < 0 || off+count > len(keyDoubles) {
					return formatErr("GeoKey %d references missing double parameters", id)
				}
				k.Kind, k.Double = 'd', keyDoubles[off:off+count]
			case tagGeoASCIIParams:
				if off < 0 || count < 0 || off+count > len(keyASCII) {
					// Tolerate writers that omit the trailing NUL in the count.
					if off >= 0 && off <= len(keyASCII) {
						count = len(keyASCII) - off
					} else {
						return formatErr("GeoKey %d references missing ASCII parameters", id)
					}
				}
				k.Kind, k.ASCII = 'a', strings.TrimRight(keyASCII[off:off+count], "|\x00")
			default:
				continue
			}
			f.GeoKeys[id] = k
		}
	}
	return nil
}

type gdalItem struct {
	Name   string `xml:"name,attr"`
	Sample string `xml:"sample,attr"`
	Role   string `xml:"role,attr"`
	Domain string `xml:"domain,attr"`
	Value  string `xml:",chardata"`
}

func (f *File) parseGDALMetadata(doc string) {
	var meta struct {
		Items []gdalItem `xml:"Item"`
	}
	if xml.Unmarshal([]byte(doc), &meta) != nil {
		return
	}
	for _, it := range meta.Items {
		switch {
		case it.Sample == "" && it.Domain == "":
			f.Tags[it.Name] = it.Value
		case it.Sample == "0" && it.Role == "scale":
			if v, err := strconv.ParseFloat(strings.TrimSpace(it.Value), 64); err == nil {
				f.Scale, f.HasScale = v, true
			}
		case it.Sample == "0" && it.Role == "offset":
			if v, err := strconv.ParseFloat(strings.TrimSpace(it.Value), 64); err == nil {
				f.Offset, f.HasOffset = v, true
			}
		}
	}
}

func (f *File) blockSize() (int, int) {
	if f.TileWidth > 0 {
		return f.TileWidth, f.TileHeight
	}
	return f.Width, f.RowsPerStrip
}

func (f *File) blockGrid() (int, int) {
	bw, bh := f.blockSize()
	return (f.Width + bw - 1) / bw, (f.Height + bh - 1) / bh
}

// Geotransform returns the GDAL-style affine transform for pixel EDGES:
// x = g[0] + col*g[1] + row*g[2]; y = g[3] + col*g[4] + row*g[5].
func (f *File) Geotransform() ([6]float64, bool) {
	var g [6]float64
	shift := 0.0
	if k, ok := f.GeoKeys[1025]; ok && k.Short == 2 { // RasterPixelIsPoint
		shift = 0.5
	}
	if len(f.Transform) == 16 {
		t := f.Transform
		g = [6]float64{t[3], t[0], t[1], t[7], t[4], t[5]}
	} else if len(f.PixelScale) >= 2 && len(f.Tiepoints) >= 6 {
		sx, sy := f.PixelScale[0], f.PixelScale[1]
		g = [6]float64{f.Tiepoints[3] - f.Tiepoints[0]*sx, sx, 0, f.Tiepoints[4] + f.Tiepoints[1]*sy, 0, -sy}
	} else {
		return g, false
	}
	if shift != 0 {
		g[0] -= shift * (g[1] + g[2])
		g[3] -= shift * (g[4] + g[5])
	}
	return g, true
}

// IsNoData reports whether a raw sample equals the declared NoData value.
func (f *File) IsNoData(v float64) bool {
	if !f.HasNoData {
		return false
	}
	if math.IsNaN(f.NoData) {
		return math.IsNaN(v)
	}
	if f.SampleFormat == SampleFloat && f.BitsPerSample == 32 {
		return float32(v) == float32(f.NoData)
	}
	return v == f.NoData
}

// block returns the decoded samples (band 0) of one strip/tile, cached.
func (f *File) block(index int) ([]float64, error) {
	f.mu.Lock()
	if data, ok := f.cache[index]; ok {
		f.mu.Unlock()
		return data, nil
	}
	f.mu.Unlock()
	data, err := f.decodeBlock(index)
	if err != nil {
		return nil, err
	}
	f.mu.Lock()
	if len(f.order) >= defaultBlockCache {
		delete(f.cache, f.order[0])
		f.order = f.order[1:]
	}
	f.cache[index] = data
	f.order = append(f.order, index)
	f.BlocksDecoded++
	f.mu.Unlock()
	return data, nil
}

func (f *File) decodeBlock(index int) ([]float64, error) {
	if f.SamplesPerPixel != 1 {
		return nil, formatErr("pixel access is limited to single-band rasters")
	}
	off, n := f.Offsets[index], f.ByteCounts[index]
	bw, bh := f.blockSize()
	if f.TileWidth == 0 { // last strip may be short
		_, down := f.blockGrid()
		if index == down-1 {
			bh = f.Height - index*f.RowsPerStrip
		}
	}
	bps := f.BitsPerSample / 8
	want := bw * bh * bps
	if n == 0 { // sparse (unwritten) block: GDAL semantics = NoData / zero
		out := make([]float64, bw*bh)
		if f.HasNoData {
			for i := range out {
				out[i] = f.NoData
			}
		}
		return out, nil
	}
	if n > maxEncodedBlock {
		return nil, formatErr("encoded block %d is implausibly large (%d bytes)", index, n)
	}
	enc := make([]byte, n)
	if err := f.readAt(enc, int64(off)); err != nil {
		return nil, formatErr("cannot read block %d: %v", index, err)
	}
	var raw []byte
	var err error
	switch f.Compression {
	case 1:
		raw = enc
	case 5:
		raw, err = lzwDecode(enc, want)
	case 8, 32946:
		var zr io.ReadCloser
		if zr, err = zlib.NewReader(bytes.NewReader(enc)); err == nil {
			raw = make([]byte, want)
			var got int
			got, err = io.ReadFull(zr, raw)
			zr.Close()
			if err == io.ErrUnexpectedEOF || err == io.EOF {
				raw, err = raw[:got], nil
			}
		}
	case 32773:
		raw, err = packBitsDecode(enc, want)
	default:
		return nil, formatErr("unsupported TIFF compression %d (supported: none, LZW, Deflate, PackBits)", f.Compression)
	}
	if err != nil {
		return nil, formatErr("cannot decompress block %d: %v", index, err)
	}
	if len(raw) < want {
		return nil, formatErr("block %d is truncated (%d of %d bytes)", index, len(raw), want)
	}
	raw = raw[:want]
	rowBytes := bw * bps
	switch f.Predictor {
	case 1:
	case 2:
		if f.SampleFormat == SampleFloat {
			return nil, formatErr("horizontal predictor on floating-point samples is not supported")
		}
		for r := 0; r < bh; r++ {
			row := raw[r*rowBytes : (r+1)*rowBytes]
			switch bps {
			case 1:
				for i := 1; i < bw; i++ {
					row[i] += row[i-1]
				}
			case 2:
				for i := 1; i < bw; i++ {
					f.bo.PutUint16(row[i*2:], f.bo.Uint16(row[i*2:])+f.bo.Uint16(row[i*2-2:]))
				}
			case 4:
				for i := 1; i < bw; i++ {
					f.bo.PutUint32(row[i*4:], f.bo.Uint32(row[i*4:])+f.bo.Uint32(row[i*4-4:]))
				}
			case 8:
				for i := 1; i < bw; i++ {
					f.bo.PutUint64(row[i*8:], f.bo.Uint64(row[i*8:])+f.bo.Uint64(row[i*8-8:]))
				}
			}
		}
	case 3:
		if f.SampleFormat != SampleFloat {
			return nil, formatErr("floating-point predictor on integer samples")
		}
		tmp := make([]byte, rowBytes)
		for r := 0; r < bh; r++ {
			row := raw[r*rowBytes : (r+1)*rowBytes]
			for i := 1; i < rowBytes; i++ {
				row[i] += row[i-1]
			}
			copy(tmp, row)
			// Byte planes are stored most-significant first, independent of file order.
			for s := 0; s < bw; s++ {
				for b := 0; b < bps; b++ {
					v := tmp[b*bw+s]
					if f.bo == binary.LittleEndian {
						row[s*bps+(bps-1-b)] = v
					} else {
						row[s*bps+b] = v
					}
				}
			}
		}
	default:
		return nil, formatErr("unsupported TIFF predictor %d", f.Predictor)
	}
	out := make([]float64, bw*bh)
	for i := range out {
		p := raw[i*bps:]
		switch {
		case f.SampleFormat == SampleFloat && bps == 4:
			out[i] = float64(math.Float32frombits(f.bo.Uint32(p)))
		case f.SampleFormat == SampleFloat && bps == 8:
			out[i] = math.Float64frombits(f.bo.Uint64(p))
		case bps == 1 && f.SampleFormat == SampleUint:
			out[i] = float64(p[0])
		case bps == 1:
			out[i] = float64(int8(p[0]))
		case bps == 2 && f.SampleFormat == SampleUint:
			out[i] = float64(f.bo.Uint16(p))
		case bps == 2:
			out[i] = float64(int16(f.bo.Uint16(p)))
		case bps == 4 && f.SampleFormat == SampleUint:
			out[i] = float64(f.bo.Uint32(p))
		case bps == 4:
			out[i] = float64(int32(f.bo.Uint32(p)))
		case f.SampleFormat == SampleUint:
			out[i] = float64(f.bo.Uint64(p))
		default:
			out[i] = float64(int64(f.bo.Uint64(p)))
		}
	}
	return out, nil
}

// Pixel returns the raw band-0 value at (col,row); ok=false outside the raster.
func (f *File) Pixel(col, row int) (float64, bool, error) {
	if col < 0 || row < 0 || col >= f.Width || row >= f.Height {
		return 0, false, nil
	}
	bw, bh := f.blockSize()
	across, _ := f.blockGrid()
	var index, x, y int
	if f.TileWidth > 0 {
		index, x, y = (row/bh)*across+col/bw, col%bw, row%bh
	} else {
		index, x, y = row/bh, col, row%bh
	}
	data, err := f.block(index)
	if err != nil {
		return 0, false, err
	}
	return data[y*bw+x], true, nil
}

// ReadWindow returns raw band-0 samples for a window fully inside the raster.
func (f *File) ReadWindow(x0, y0, w, h int) ([]float64, error) {
	if w <= 0 || h <= 0 || x0 < 0 || y0 < 0 || x0+w > f.Width || y0+h > f.Height {
		return nil, formatErr("window %d,%d %dx%d is outside the %dx%d raster", x0, y0, w, h, f.Width, f.Height)
	}
	out := make([]float64, w*h)
	bw, bh := f.blockSize()
	across, _ := f.blockGrid()
	for by := y0 / bh; by*bh < y0+h; by++ {
		bxStart, bxEnd := 0, 1
		if f.TileWidth > 0 {
			bxStart, bxEnd = x0/bw, (x0+w-1)/bw+1
		}
		for bx := bxStart; bx < bxEnd; bx++ {
			index := by
			if f.TileWidth > 0 {
				index = by*across + bx
			}
			data, err := f.block(index)
			if err != nil {
				return nil, err
			}
			rows := len(data) / bw
			for y := max(y0, by*bh); y < min(y0+h, by*bh+rows); y++ {
				xa, xb := max(x0, bx*bw), min(x0+w, bx*bw+bw)
				copy(out[(y-y0)*w+(xa-x0):(y-y0)*w+(xb-x0)], data[(y-by*bh)*bw+(xa-bx*bw):(y-by*bh)*bw+(xb-bx*bw)])
			}
		}
	}
	return out, nil
}

// WindowEncodedBytes estimates the compressed bytes a window read must fetch.
func (f *File) WindowEncodedBytes(x0, y0, w, h int) (bytesTotal uint64, blocks int) {
	bw, bh := f.blockSize()
	across, _ := f.blockGrid()
	for by := y0 / bh; by*bh < y0+h; by++ {
		bxStart, bxEnd := 0, 1
		if f.TileWidth > 0 {
			bxStart, bxEnd = x0/bw, (x0+w-1)/bw+1
		}
		for bx := bxStart; bx < bxEnd; bx++ {
			index := by
			if f.TileWidth > 0 {
				index = by*across + bx
			}
			if index >= 0 && index < len(f.ByteCounts) {
				bytesTotal += f.ByteCounts[index]
				blocks++
			}
		}
	}
	return
}

func packBitsDecode(src []byte, want int) ([]byte, error) {
	out := make([]byte, 0, want)
	for i := 0; i < len(src) && len(out) < want; {
		n := int(int8(src[i]))
		i++
		switch {
		case n >= 0:
			if i+n+1 > len(src) {
				return nil, errors.New("PackBits literal run overruns input")
			}
			out = append(out, src[i:i+n+1]...)
			i += n + 1
		case n != -128:
			if i >= len(src) {
				return nil, errors.New("PackBits repeat run overruns input")
			}
			for k := 0; k < 1-n; k++ {
				out = append(out, src[i])
			}
			i++
		}
	}
	return out, nil
}

// lzwDecode implements TIFF 6.0 LZW (MSB-first codes, "early change").
func lzwDecode(src []byte, want int) ([]byte, error) {
	const clear, eoi = 256, 257
	type entry struct {
		prefix int32
		last   byte
		length int32
	}
	table := make([]entry, 4096)
	for i := 0; i < 256; i++ {
		table[i] = entry{prefix: -1, last: byte(i), length: 1}
	}
	out := make([]byte, 0, want)
	width, next := uint(9), 258
	var bits uint32
	var nbits uint
	prev := -1
	pos := 0
	emit := func(code int) byte {
		n := int(table[code].length)
		start := len(out)
		out = append(out, make([]byte, n)...)
		for c, i := code, start+n-1; c >= 0 && i >= start; i-- {
			out[i] = table[c].last
			c = int(table[c].prefix)
		}
		return out[start]
	}
	for len(out) < want {
		for nbits < width {
			if pos >= len(src) {
				return out, nil
			}
			bits = bits<<8 | uint32(src[pos])
			pos++
			nbits += 8
		}
		code := int(bits >> (nbits - width) & (1<<width - 1))
		nbits -= width
		switch {
		case code == eoi:
			return out, nil
		case code == clear:
			width, next, prev = 9, 258, -1
			continue
		case prev < 0:
			if code >= 256 {
				return nil, errors.New("LZW stream starts with a non-literal code")
			}
			out = append(out, byte(code))
		case code < next:
			first := emit(code)
			if next < 4096 {
				table[next] = entry{prefix: int32(prev), last: first, length: table[prev].length + 1}
				next++
			}
		case code == next && next < 4096:
			first := table[prev].last
			for c := prev; c >= 0; c = int(table[c].prefix) {
				first = table[c].last
			}
			table[next] = entry{prefix: int32(prev), last: first, length: table[prev].length + 1}
			next++
			emit(code)
		default:
			return nil, errors.New("corrupt LZW code")
		}
		prev = code
		if next+1 >= 1<<width && width < 12 {
			width++
		}
	}
	return out, nil
}
