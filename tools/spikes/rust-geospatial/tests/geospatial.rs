use chandra_geospatial_spike::{bilinear, fixture, geographic_projection, json, local_projection};
use geotiff_reader::GeoTiffFile;

#[test]
fn opens_real_geotiff_and_reads_geokeys_georeferencing_and_nodata() {
    let file = GeoTiffFile::open(fixture("sloped.tif")).unwrap();
    assert_eq!(file.band_count(), 1);
    assert_eq!((file.width(), file.height()), (401, 401));
    assert_eq!(file.crs().model_type, 1);
    assert_eq!(file.nodata().unwrap().parse::<f64>().unwrap(), -9999.0);
    let gt = file.transform().unwrap();
    let (x, y) = gt.pixel_to_geo(0.0, 0.0);
    assert_eq!((x, y), (-20050.0, 20050.0));
    let citation = file.crs().horizontal().unwrap().projection_citation.as_deref().unwrap_or("");
    assert!(citation.contains("aeqd") || citation.contains("Azimuthal"), "citation: {citation}");
}

#[test]
fn wkt_conversion_and_lunar_aeqd_roundtrip_match_python() {
    let radius = 1_737_400.0;
    let local = local_projection(-89.5, 45.0, radius);
    let geo = geographic_projection(radius);
    for case in json("coordinates.json").as_array().unwrap() {
        let lat = case["latitude"].as_f64().unwrap();
        let lon = case["longitude"].as_f64().unwrap();
        let east = case["east_m"].as_f64().unwrap();
        let north = case["north_m"].as_f64().unwrap();
        let local = local_projection(lat, lon, radius);
        let mut p = (east, north, 0.0);
        proj4rs::transform::transform(&local, &geo, &mut p).unwrap();
        let got_lon = p.0.to_degrees();
        let got_lat = p.1.to_degrees();
        let want_lon = case["result_longitude"].as_f64().unwrap();
        let want_lat = case["result_latitude"].as_f64().unwrap();
        // At the exact pole longitude is the chosen meridian convention; compare
        // the vector rather than treating 180/-180 as a physical discrepancy.
        let dlon = (got_lon - want_lon).abs().min((got_lon - want_lon + 360.0).abs()).min((got_lon - want_lon - 360.0).abs());
        assert!((got_lat - want_lat).abs() < 1e-9, "lat {got_lat} vs {want_lat}");
        assert!(dlon < 1e-9 || got_lat.abs() > 89.999999, "lon {got_lon} vs {want_lon}");
    }
    let mut p = (45.0_f64.to_radians(), -89.5_f64.to_radians(), 0.0);
    proj4rs::transform::transform(&geo, &local, &mut p).unwrap();
    assert!(p.0.abs() < 1e-6 && p.1.abs() < 1e-6);
}

#[test]
fn bounded_window_read_and_bilinear_preserve_plane_and_nodata() {
    let file = GeoTiffFile::open(fixture("sloped.tif")).unwrap();
    let raw = file.read_band_window::<f32>(0, 198, 198, 5, 5).unwrap();
    let values: Vec<Option<f32>> = raw.iter().copied().map(Some).collect();
    let h = bilinear(&values, 5, 2.5, 2.5).unwrap();
    assert!((h - 100.0).abs() < 0.001, "landing {h}");
    let nodata = GeoTiffFile::open(fixture("nodata.tif")).unwrap();
    let raw = nodata.read_band_window::<f32>(0, 220, 170, 15, 15).unwrap();
    let values: Vec<Option<f32>> = raw.iter().map(|&v| if v == -9999.0 { None } else { Some(v) }).collect();
    assert!(bilinear(&values, 15, 7.5, 7.5).is_none());
}

#[test]
fn candidate_wkt_parser_handles_the_python_lunar_wkt() {
    let file = GeoTiffFile::open(fixture("sloped.tif")).unwrap();
    let citation = file.crs().horizontal().unwrap().projection_citation.as_deref().unwrap_or("");
    // GeoTIFF often stores a PROJ string in the citation rather than full WKT.
    // Either way it must describe the same spherical lunar projection.
    let proj_string = if citation.starts_with('+') {
        citation.to_string()
    } else {
        proj4wkt::wkt_to_projstring(citation).unwrap()
    };
    let parsed = proj4rs::Proj::from_proj_string(&proj_string).unwrap();
    let (a, b) = parsed.ellipse_parameters();
    assert!((a - 1_737_400.0).abs() < 0.01);
    assert!((a - b).abs() < 0.01);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn remote_cog_uses_bounded_http_ranges_without_full_raster_fallback() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
    let bytes = Arc::new(std::fs::read(fixture("remote-cog.tif")).unwrap());
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let full_fallbacks = Arc::new(AtomicUsize::new(0));
    let range_requests = Arc::new(AtomicUsize::new(0));
    let server_bytes = bytes.clone();
    let fallback_count = full_fallbacks.clone();
    let range_count = range_requests.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let mut stream = stream.unwrap();
            let mut buf = [0u8; 8192];
            let n = stream.read(&mut buf).unwrap();
            let request = String::from_utf8_lossy(&buf[..n]);
            let first = request.lines().next().unwrap_or("");
            if first.starts_with("HEAD") {
                let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nETag: \"spike\"\r\nConnection: close\r\n\r\n", server_bytes.len());
                stream.write_all(head.as_bytes()).unwrap();
                continue;
            }
            let range = request.lines().find_map(|l| l.strip_prefix("Range: bytes=").or_else(|| l.strip_prefix("range: bytes=")));
            let Some(range) = range else {
                fallback_count.fetch_add(1, Ordering::SeqCst);
                stream.write_all(b"HTTP/1.1 416 Range Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
                continue;
            };
            let (a, b) = range.trim().split_once('-').unwrap();
            let start: usize = a.parse().unwrap();
            let end: usize = b.parse().unwrap();
            let body = &server_bytes[start..=end];
            range_count.fetch_add(1, Ordering::SeqCst);
            let head = format!("HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {start}-{end}/{}\r\nETag: \"spike\"\r\nConnection: close\r\n\r\n", body.len(), server_bytes.len());
            stream.write_all(head.as_bytes()).unwrap();
            stream.write_all(body).unwrap();
        }
    });
    let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap();
    let options = geotiff_reader::cog_async::AsyncHttpOpenOptions {
        chunk_size: 64 * 1024,
        cache_bytes: 1024 * 1024,
        cache_slots: 17,
        max_coalesced_chunks: 2,
        max_retries: 0,
        connect_timeout: Some(std::time::Duration::from_secs(2)),
        request_timeout: Some(std::time::Duration::from_secs(5)),
        client: Some(client),
        ..Default::default()
    };
    let file = geotiff_reader::cog_async::AsyncHttpGeoTiffFile::open_with_options(format!("http://{addr}/remote-cog.tif"), options).await.unwrap();
    let window = file.read_band_window::<f32>(0, 500, 500, 4, 4).await.unwrap();
    assert_eq!(window.shape(), &[4, 4]);
    assert_eq!(full_fallbacks.load(Ordering::SeqCst), 0);
    assert!(range_requests.load(Ordering::SeqCst) > 0);
    assert!(bytes.len() > 100_000);
}
