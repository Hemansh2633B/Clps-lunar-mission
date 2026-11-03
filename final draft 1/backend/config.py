"""Scientific conventions, limits, and explicitly supplied DEM assumptions."""
from dataclasses import dataclass, field
import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LUNAR_RADIUS_M = 1_737_400.0  # Demo only; real mode uses the DEM CRS sphere.
LUNAR_RADIUS_LIMITS_M = (1_700_000.0, 1_800_000.0)
RADIUS_LIMITS_KM = (0.5, 20.0)
LONGITUDE_CONVENTION = "east-positive, -180 to +180 degrees (0–360 input also accepted)"
LATITUDE_CONVENTION = "planetocentric degrees; spherical lunar CRSs only"
QUALITY_GRIDS = {"low": 129, "medium": 257, "high": 513}  # Odd: exact center vertex.
MAX_SUBSET_PIXELS = 16_000_000
MAX_REQUEST_BYTES = 16_384
SYNTHETIC_WARNING = "SYNTHETIC TERRAIN — NOT REAL LUNAR DATA"
RENDER_COORDINATE_CONVENTION = "landing tangent frame: east/up/north; Three.js X= east, Y= up, Z= south; units km"
GEOMETRY_MODEL = "radial elevation on a sphere; local AEQD distances converted to a curved landing tangent frame"
LOLA_COG_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF"
LOLA_PRODUCT_PAGE = "https://pgda.gsfc.nasa.gov/products/90"
LOLA_SUBSET_ASSUMPTIONS = {
    "vertical_unit": "m", "value_kind": "elevation",
    "elevation_reference": "LOLA surface height relative to the 1737.4 km reference sphere; verify against product documentation before mission use",
    "elevation_reference_radius_m": 1_737_400.0,
    "lunar_reference_frame": "MOON_ME (JPL DE421)",
    "source_url": LOLA_COG_URL, "product_page": LOLA_PRODUCT_PAGE,
}


class TerrainError(ValueError):
    """An actionable error safe to display to the local user."""


@dataclass
class Settings:
    dem_path: Path | None = None
    dem_options: dict = field(default_factory=dict)

    @classmethod
    def load(cls, dem_path=None, config_path=None):
        options = {}
        if config_path:
            try:
                options = json.loads(Path(config_path).read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                raise TerrainError(f"Cannot read DEM configuration: {exc}") from exc
            if not isinstance(options, dict):
                raise TerrainError("DEM configuration must be a JSON object.")
        supplied_path = dem_path or options.get("dem_path")
        path = Path(supplied_path).expanduser() if supplied_path else None
        if path and not path.is_absolute():
            path = PROJECT_ROOT / path
        return cls(path, options)
