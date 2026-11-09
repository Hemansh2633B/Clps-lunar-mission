//! Isolated migration spike. Not wired into the application or Vercel functions.
//! Keeps the Python backend intact while candidate crates are exercised on Linux CI.

use std::path::Path;

pub fn fixture(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tests/fixtures/python-v1.11")
        .join(name)
}

pub fn json(name: &str) -> serde_json::Value {
    serde_json::from_slice(&std::fs::read(fixture(name)).unwrap()).unwrap()
}

/// Landing-centered spherical AEQD, matching backend.coordinate_utils.local_crs.
pub fn local_projection(lat: f64, lon: f64, radius: f64) -> proj4rs::Proj {
    proj4rs::Proj::from_proj_string(&format!(
        "+proj=aeqd +lat_0={lat} +lon_0={lon} +R={radius} +units=m +no_defs +type=crs"
    ))
    .unwrap()
}

pub fn geographic_projection(radius: f64) -> proj4rs::Proj {
    proj4rs::Proj::from_proj_string(&format!(
        "+proj=longlat +R={radius} +no_defs +type=crs"
    ))
    .unwrap()
}

/// Bilinear sample of a bounded window. NoData in any contributing stencil cell
/// is a gap, never zero. Window origin is in source pixel-corner coordinates.
pub fn bilinear(
    window: &[Option<f32>],
    cols: usize,
    col: f64,
    row: f64,
) -> Option<f64> {
    let c = col.floor() as isize;
    let r = row.floor() as isize;
    if c < 0 || r < 0 || (c + 2) as usize > cols || (r + 2) as usize > window.len() / cols {
        return None;
    }
    let (c, r) = (c as usize, r as usize);
    let h = [window[r * cols + c]?, window[r * cols + c + 1]?, window[(r + 1) * cols + c]?, window[(r + 1) * cols + c + 1]?];
    let u = col - c as f64;
    let v = row - r as f64;
    Some(h[0] as f64 * (1.0 - u) * (1.0 - v) + h[1] as f64 * u * (1.0 - v)
        + h[2] as f64 * (1.0 - u) * v + h[3] as f64 * u * v)
}
