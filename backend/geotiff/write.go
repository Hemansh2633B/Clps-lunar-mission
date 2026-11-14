package geotiff

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"encoding/xml"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
)

// WriteOptions describes a single-band, north-up GeoTIFF to serialise.
type WriteOptions struct {
	Width, Height int
	BitsPerSample int
	SampleFormat  int
	Data          []float64 // raw (unscaled) samples, row-major
	Geotransform  [6]float64
	GeoKeys       map[int]GeoKey
	HasNoData     bool
	NoData        float64
	Tags          map[string]string
	Scale, Offset *float64
	TileSize      int  // 0 = one strip per 16 rows
	Deflate       bool // zlib-compress blocks
}

// Write serialises a little-endian classic TIFF. It is used for regional DEM
// subsets (source samples, CRS keys, NoData and band scaling are copied
// verbatim, never resampled) and for deterministic test rasters.
func Write(w io.Writer, o WriteOptions) error {
	if o.Width <= 0 || o.Height <= 0 || len(o.Data) != o.Width*o.Height {
		return formatErr("cannot write raster: data length does not match %dx%d", o.Width, o.Height)
	}
	if o.Geotransform[2] != 0 || o.Geotransform[4] != 0 {
		return formatErr("cannot write a rotated raster")
	}
	bps := o.BitsPerSample / 8
	le := binary.LittleEndian
	encode := func(dst []byte, v float64) {
		switch {
		case o.SampleFormat == SampleFloat && bps == 4:
			le.PutUint32(dst, math.Float32bits(float32(v)))
		case o.SampleFormat == SampleFloat && bps == 8:
			le.PutUint64(dst, math.Float64bits(v))
		case bps == 1:
			dst[0] = byte(int64(v))
		case bps == 2:
			le.PutUint16(dst, uint16(int64(v)))
		case bps == 4:
			le.PutUint32(dst, uint32(int64(v)))
		default:
			le.PutUint64(dst, uint64(int64(v)))
		}
	}
	if (o.SampleFormat == SampleFloat && bps != 4 && bps != 8) || (bps != 1 && bps != 2 && bps != 4 && bps != 8) {
		return formatErr("cannot write %d-bit samples of format %d", o.BitsPerSample, o.SampleFormat)
	}
	bw, bh := o.Width, 16
	tiled := o.TileSize > 0
	if tiled {
		bw, bh = o.TileSize, o.TileSize
	}
	across, down := (o.Width+bw-1)/bw, (o.Height+bh-1)/bh
	var body bytes.Buffer
	body.Write(make([]byte, 8)) // header placeholder
	offsets := make([]uint32, 0, across*down)
	counts := make([]uint32, 0, across*down)
	fill := 0.0
	if o.HasNoData {
		fill = o.NoData
	}
	for by := 0; by < down; by++ {
		for bx := 0; bx < across; bx++ {
			rows := bh
			if !tiled && by*bh+rows > o.Height {
				rows = o.Height - by*bh
			}
			raw := make([]byte, bw*rows*bps)
			for y := 0; y < rows; y++ {
				for x := 0; x < bw; x++ {
					v := fill
					if sx, sy := bx*bw+x, by*bh+y; sx < o.Width && sy < o.Height {
						v = o.Data[sy*o.Width+sx]
					}
					encode(raw[(y*bw+x)*bps:], v)
				}
			}
			if o.Deflate {
				var z bytes.Buffer
				zw := zlib.NewWriter(&z)
				zw.Write(raw)
				zw.Close()
				raw = z.Bytes()
			}
			offsets = append(offsets, uint32(body.Len()))
			counts = append(counts, uint32(len(raw)))
			body.Write(raw)
			if body.Len()%2 == 1 {
				body.WriteByte(0)
			}
		}
	}
	type field struct {
		tag, typ uint16
		count    uint32
		data     []byte
	}
	var fields []field
	short := func(tag uint16, vals ...uint16) {
		b := make([]byte, 2*len(vals))
		for i, v := range vals {
			le.PutUint16(b[i*2:], v)
		}
		fields = append(fields, field{tag, 3, uint32(len(vals)), b})
	}
	long := func(tag uint16, vals ...uint32) {
		b := make([]byte, 4*len(vals))
		for i, v := range vals {
			le.PutUint32(b[i*4:], v)
		}
		fields = append(fields, field{tag, 4, uint32(len(vals)), b})
	}
	double := func(tag uint16, vals ...float64) {
		b := make([]byte, 8*len(vals))
		for i, v := range vals {
			le.PutUint64(b[i*8:], math.Float64bits(v))
		}
		fields = append(fields, field{tag, 12, uint32(len(vals)), b})
	}
	ascii := func(tag uint16, s string) {
		fields = append(fields, field{tag, 2, uint32(len(s) + 1), append([]byte(s), 0)})
	}
	long(tagImageWidth, uint32(o.Width))
	long(tagImageLength, uint32(o.Height))
	short(tagBitsPerSample, uint16(o.BitsPerSample))
	if o.Deflate {
		short(tagCompression, 8)
	} else {
		short(tagCompression, 1)
	}
	short(262, 1) // PhotometricInterpretation: MinIsBlack
	short(tagSamplesPerPixel, 1)
	short(tagPlanarConfig, 1)
	short(tagSampleFormat, uint16(o.SampleFormat))
	if tiled {
		long(tagTileWidth, uint32(bw))
		long(tagTileLength, uint32(bh))
		long(tagTileOffsets, offsets...)
		long(tagTileByteCounts, counts...)
	} else {
		long(tagStripOffsets, offsets...)
		long(tagRowsPerStrip, uint32(bh))
		long(tagStripByteCounts, counts...)
	}
	g := o.Geotransform
	double(tagModelPixelScale, g[1], -g[5], 0)
	double(tagModelTiepoint, 0, 0, 0, g[0], g[3], 0)
	if len(o.GeoKeys) > 0 {
		ids := make([]int, 0, len(o.GeoKeys))
		for id := range o.GeoKeys {
			ids = append(ids, id)
		}
		sort.Ints(ids)
		dir := []uint16{1, 1, 0, uint16(len(ids))}
		var dbl []float64
		var txt strings.Builder
		for _, id := range ids {
			k := o.GeoKeys[id]
			switch k.Kind {
			case 'd':
				dir = append(dir, uint16(id), tagGeoDoubleParams, uint16(len(k.Double)), uint16(len(dbl)))
				dbl = append(dbl, k.Double...)
			case 'a':
				dir = append(dir, uint16(id), tagGeoASCIIParams, uint16(len(k.ASCII)+1), uint16(txt.Len()))
				txt.WriteString(k.ASCII + "|")
			default:
				dir = append(dir, uint16(id), 0, 1, uint16(k.Short))
			}
		}
		short(tagGeoKeyDirectory, dir...)
		if len(dbl) > 0 {
			double(tagGeoDoubleParams, dbl...)
		}
		if txt.Len() > 0 {
			ascii(tagGeoASCIIParams, txt.String())
		}
	}
	if len(o.Tags) > 0 || o.Scale != nil || o.Offset != nil {
		var m strings.Builder
		m.WriteString("<GDALMetadata>\n")
		names := make([]string, 0, len(o.Tags))
		for k := range o.Tags {
			names = append(names, k)
		}
		sort.Strings(names)
		esc := func(s string) string {
			var b bytes.Buffer
			xml.EscapeText(&b, []byte(s))
			return b.String()
		}
		for _, k := range names {
			m.WriteString(`  <Item name="` + esc(k) + `">` + esc(o.Tags[k]) + "</Item>\n")
		}
		if o.Offset != nil {
			m.WriteString(`  <Item name="OFFSET" sample="0" role="offset">` + strconv.FormatFloat(*o.Offset, 'g', -1, 64) + "</Item>\n")
		}
		if o.Scale != nil {
			m.WriteString(`  <Item name="SCALE" sample="0" role="scale">` + strconv.FormatFloat(*o.Scale, 'g', -1, 64) + "</Item>\n")
		}
		m.WriteString("</GDALMetadata>\n")
		ascii(tagGDALMetadata, m.String())
	}
	if o.HasNoData {
		s := "nan"
		if !math.IsNaN(o.NoData) {
			s = strconv.FormatFloat(o.NoData, 'g', -1, 64)
		}
		ascii(tagGDALNoData, s)
	}
	sort.Slice(fields, func(i, j int) bool { return fields[i].tag < fields[j].tag })
	for i := range fields {
		if len(fields[i].data) > 4 {
			off := uint32(body.Len())
			body.Write(fields[i].data)
			if body.Len()%2 == 1 {
				body.WriteByte(0)
			}
			fields[i].data = make([]byte, 4)
			le.PutUint32(fields[i].data, off)
		} else {
			fields[i].data = append(fields[i].data, 0, 0, 0, 0)[:4]
		}
	}
	ifdOffset := uint32(body.Len())
	entry := make([]byte, 12)
	le.PutUint16(entry, uint16(len(fields)))
	body.Write(entry[:2])
	for _, fd := range fields {
		le.PutUint16(entry[0:], fd.tag)
		le.PutUint16(entry[2:], fd.typ)
		le.PutUint32(entry[4:], fd.count)
		copy(entry[8:], fd.data)
		body.Write(entry)
	}
	body.Write([]byte{0, 0, 0, 0})
	out := body.Bytes()
	copy(out, "II")
	le.PutUint16(out[2:], 42)
	le.PutUint32(out[4:], ifdOffset)
	_, err := w.Write(out)
	return err
}
