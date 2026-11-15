"""Layer 4: an AllWISE image of the same patch of sky as the SPHEREx view.

WISE observed the whole sky in 2010. An object that moved since then sits at a different
place in the WISE image than in the SPHEREx image of the same field.

Data: AllWISE Atlas images (coadds of the 2010 WISE survey and the NEOWISE post-cryogenic
months), from IRSA's public mirror on AWS (`settings.wise_bucket_url`). The uncompressed
``-int-3.fits`` tiles are read with byte-range requests, like the SPHEREx files, so only
the patch is downloaded. Tiles are 4095 x 4095 pixels of 1.375 arcseconds (about 1.56
degrees). IRSA's search service is not used: the tile is found by listing the mirror's
folders, which are named after the tile centre (``1342m076_ac51``: RA 134.2, Dec -7.6),
and the listing is cached.

The image is resampled, north up and east left, onto a grid with the requested centre and
width at the WISE pixel scale, so it covers exactly the same sky as the SPHEREx image and
field stars line up. WISE images are sharper (1.375 arcsecond pixels, about 6 arcsecond
resolution) than SPHEREx (6.15 arcsecond pixels); the interface says so.
"""

import math
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np

from . import live_frames, mock
from . import models as m
from .cache import make_key
from .config import Settings
from .resample import bilinear, grid_offsets, sky_to_tangent, source_box, tangent_to_sky

BANDS = ("W1", "W2")
# Atlas pixel scale, from the tile header (CDELT2 = 0.0003819444 degrees).
WISE_PIXEL_ARCSEC = 1.375
# Half the width of a tile: 4095 pixels of 0.0003819444 degrees, halved.
TILE_HALF_DEG = 4095 * 0.0003819444 / 2.0
MAX_PIXELS = 437  # 600 arcseconds, the largest view size, at 1.375 arcseconds
# Bump when the reading or resampling changes, so old cached images are not reused.
WISE_VERSION = 1
SURVEY = "AllWISE Atlas"

_S3_NS = {"s": "http://s3.amazonaws.com/doc/2006-03-01/"}
_TILE_NAME = re.compile(r"^(\d{4})([pm])(\d{3})_ac51$")


class NoTile(LookupError):
    """No AllWISE Atlas tile covers the position."""


@dataclass(frozen=True)
class WiseImage:
    meta: m.WiseImage
    image: np.ndarray  # n x n, row 0 north, column 0 east; NaN where the tile has no data


# --- finding the tile ---------------------------------------------------------------------


def parse_tile(coadd_id: str) -> tuple[float, float]:
    """Tile centre (RA, Dec in degrees, to 0.1 degree) from its name, e.g. 1342m076_ac51."""
    match = _TILE_NAME.match(coadd_id)
    if match is None:
        raise ValueError(f"not an AllWISE Atlas tile name: {coadd_id!r}")
    sign = 1.0 if match[2] == "p" else -1.0
    return int(match[1]) / 10.0, sign * int(match[3]) / 10.0


def _folder(settings: Settings, ra10: int) -> str:
    return f"{settings.wise_atlas_prefix}/{ra10 // 100:02d}/{ra10:04d}/"


def tile_url(settings: Settings, coadd_id: str, band: str) -> str:
    """Address of a tile's intensity image on the mirror."""
    ra10 = int(coadd_id[:4])
    folder = f"{settings.wise_bucket_url}/{_folder(settings, ra10)}{coadd_id}"
    return f"{folder}/{coadd_id}-{band.lower()}-int-3.fits"


def _list_prefixes(settings: Settings, prefix: str) -> list[str]:
    """Sub-folder names under a prefix of the public bucket (S3 ListObjectsV2)."""
    names: list[str] = []
    token = None
    while True:
        query = {"list-type": "2", "delimiter": "/", "prefix": prefix}
        if token:
            query["continuation-token"] = token
        url = f"{settings.wise_bucket_url}/?{urllib.parse.urlencode(query)}"
        with urllib.request.urlopen(url, timeout=30) as response:  # noqa: S310 - fixed https address
            root = ET.fromstring(response.read())
        for common in root.findall("s:CommonPrefixes", _S3_NS):
            names.append(common.find("s:Prefix", _S3_NS).text[len(prefix) :].rstrip("/"))
        next_token = root.find("s:NextContinuationToken", _S3_NS)
        if next_token is None:
            return names
        token = next_token.text


def tiles_in_folder(settings: Settings, ra10: int) -> list[str]:
    """Tile names in one RA folder, from the disk cache when known (the archive is fixed)."""
    cache = live_frames._cache(settings)
    key = make_key("wisetiles", settings.wise_bucket_url, _folder(settings, ra10))
    stored = cache.get_json("wisetiles", key)
    if stored is not None:
        return stored
    names = [n for n in _list_prefixes(settings, _folder(settings, ra10)) if _TILE_NAME.match(n)]
    cache.put_json("wisetiles", key, names)
    return names


def _distance_from_centre(tile: str, ra: float, dec: float) -> float:
    """How far (degrees, the larger of east and north) a position is from a tile's centre."""
    t_ra, t_dec = parse_tile(tile)
    east, north = sky_to_tangent(t_ra, t_dec, np.array([ra]), np.array([dec]))
    return max(abs(float(east[0])), abs(float(north[0]))) / 3600.0


def best_tile(tiles: list[str], ra: float, dec: float) -> str | None:
    """The tile whose centre is nearest the position, if the position lies inside it."""
    near = [t for t in tiles if abs(parse_tile(t)[1] - dec) < 2 * TILE_HALF_DEG]
    if not near:
        return None
    best = min(near, key=lambda t: _distance_from_centre(t, ra, dec))
    return best if _distance_from_centre(best, ra, dec) < TILE_HALF_DEG else None


def find_tile(settings: Settings, ra: float, dec: float) -> str:
    """The AllWISE Atlas tile covering a position. Raises NoTile if there is none."""
    half_width_ra = min(10.0, (TILE_HALF_DEG + 0.1) / max(math.cos(math.radians(dec)), 0.05))
    first = math.floor((ra - half_width_ra) * 10)
    last = math.ceil((ra + half_width_ra) * 10)
    folders = sorted({r % 3600 for r in range(first, last + 1)})
    with ThreadPoolExecutor(max_workers=max(1, settings.s3_concurrency)) as pool:
        listed = list(pool.map(lambda r: tiles_in_folder(settings, r), folders))
    tile = best_tile([t for names in listed for t in names], ra, dec)
    if tile is None:
        raise NoTile(f"No AllWISE Atlas tile covers RA {ra:.4f}, Dec {dec:.4f}.")
    return tile


# --- reading and resampling -----------------------------------------------------------------


def wise_pixels(size_arcsec: float) -> int:
    """Odd width in WISE pixels for a view `size_arcsec` wide."""
    return min(MAX_PIXELS, max(9, round(size_arcsec / WISE_PIXEL_ARCSEC)) | 1)


def _mjd(iso: str) -> float:
    from astropy.time import Time

    return float(Time(iso, format="isot", scale="utc").mjd)


def read_rows(location: str, header, y0: int, y1: int) -> np.ndarray:
    """Rows y0 to y1 (whole width) of a primary-HDU float32 image, in one byte-range request.

    Reading a patch through `section` fetches it row by row, one request each; the rows of
    a patch are contiguous in the file, so one request is far faster over a long network
    path. The data start right after the header, which is padded to 2880-byte blocks.
    """
    width = int(header["NAXIS1"])
    start = len(header.tostring(sep="", endcard=True, padding=True)) + y0 * width * 4
    end = start + (y1 - y0) * width * 4 - 1
    request = urllib.request.Request(location, headers={"Range": f"bytes={start}-{end}"})
    with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310 - configured mirror
        raw = response.read()
    return np.frombuffer(raw, dtype=">f4").reshape(y1 - y0, width)


def read_tile_patch(location: str, ra: float, dec: float, n: int) -> tuple[np.ndarray, dict]:
    """The n x n patch around a position, north up and east left at the WISE pixel scale,
    and the tile's header facts. NaN where the tile has no data."""
    from .pixels import _celestial_wcs, _open, _world_to_pixel

    east, north = grid_offsets(n, WISE_PIXEL_ARCSEC)
    sky_ra, sky_dec = tangent_to_sky(ra, dec, east, north)
    with _open(location) as hdus:
        hdu = hdus[0]
        header = hdu.header
        width, height = int(header["NAXIS1"]), int(header["NAXIS2"])
        x, y = _world_to_pixel(_celestial_wcs(header), sky_ra, sky_dec)
        box = source_box(x, y, width, height)
        if box is None:
            image = np.full((n, n), np.nan)
        else:
            y0, y1, x0, x1 = box
            if location.startswith(("http://", "https://")) and int(header["BITPIX"]) == -32:
                data = read_rows(location, header, y0, y1)[:, x0:x1]
            else:
                data = np.array(hdu.section[y0:y1, x0:x1], dtype=np.float64)
            data = data.astype(np.float64)
            data[~np.isfinite(data)] = np.nan
            image = bilinear(data, x - x0, y - y0)
        facts = {
            "wavelength_um": float(header.get("WAVELEN", float("nan"))),
            "date_start": str(header["DATEOBS1"]),
            "date_end": str(header["DATEOBS2"]),
            "date_mid": str(header["MIDOBS"]),
            "unit": str(header.get("BUNIT", "DN")),
            "tile": str(header.get("COADDID", "")),
        }
    return image.astype(np.float32), facts


def _image_url(ra: float, dec: float, size: float, band: str) -> str:
    return "/api/wise.png?" + urllib.parse.urlencode(
        {"ra": f"{ra:.6f}", "dec": f"{dec:.6f}", "size": f"{size:g}", "band": band}
    )


def _meta(mode, ra, dec, size, band, n, facts, source, image, warnings) -> m.WiseImage:
    coverage = float(np.isfinite(image).mean()) if image.size else 0.0
    if coverage < 1.0:
        warnings = [
            *warnings,
            f"The WISE tile covers {coverage:.0%} of this field; the rest is blank (the field crosses the "
            "edge of the tile).",
        ]
    return m.WiseImage(
        mode=mode,
        survey=SURVEY,
        band=band,
        wavelength_um=round(facts["wavelength_um"], 3),
        ra=ra,
        dec=dec,
        size=size,
        pixel_scale=WISE_PIXEL_ARCSEC,
        pixels=n,
        date_start=facts["date_start"],
        date_end=facts["date_end"],
        date_mid=facts["date_mid"],
        mjd_mid=round(_mjd(facts["date_mid"]), 5),
        unit=facts["unit"],
        tile=facts["tile"],
        source=source,
        coverage=round(coverage, 4),
        image_url=_image_url(ra, dec, size, band),
        warnings=warnings,
    )


# --- mock mode ------------------------------------------------------------------------------

# Made-up values in the shape of the real ones. The `mode` field says "mock".
MOCK_FACTS = {
    "W1": {"wavelength_um": 3.4, "unit": "DN"},
    "W2": {"wavelength_um": 4.6, "unit": "DN"},
}
MOCK_DATES = ("2010-05-01T00:00:00.000", "2010-11-01T00:00:00.000", "2010-05-04T00:00:00.000")
MOCK_SIGMA_ARCSEC = 2.7  # star width; WISE's images are about 6 arcseconds across


def _mock_image(ra: float, dec: float, n: int, band: str) -> np.ndarray:
    """The mock sky as WISE would have seen it in 2010: the same synthetic stars as the
    SPHEREx mock frames, with the built-in targets at their 2010 positions."""
    exposure = mock.MockExposure(
        f"mock-wise-{band}", "mock-wise", 0, _mjd(MOCK_DATES[2]), MOCK_FACTS[band]["wavelength_um"], 0.0
    )
    half = (n / 2.0 + 4.0) * WISE_PIXEL_ARCSEC
    east, north, peak = mock._sources(ra, dec, half, exposure)
    x = n / 2.0 - east / WISE_PIXEL_ARCSEC
    y = n / 2.0 - north / WISE_PIXEL_ARCSEC
    sigma = MOCK_SIGMA_ARCSEC / WISE_PIXEL_ARCSEC
    centres = np.arange(n) + 0.5
    gx = np.exp(-((centres[None, :] - x[:, None]) ** 2) / (2.0 * sigma**2))
    gy = np.exp(-((centres[None, :] - y[:, None]) ** 2) / (2.0 * sigma**2))
    image = np.einsum("k,ky,kx->yx", peak, gy, gx)
    rng = np.random.default_rng(mock._seed("wise-noise", band, round(ra, 5), round(dec, 5), n))
    return (image + 1.0 + rng.normal(0.0, mock.NOISE_SIGMA, (n, n))).astype(np.float32)


# --- the result -----------------------------------------------------------------------------


def wise_image(settings: Settings, ra: float, dec: float, size: float, band: str) -> WiseImage:
    """The WISE image of a field: from the disk cache when known, otherwise read and cached."""
    n = wise_pixels(size)
    if settings.mode == "mock":
        facts = {
            **MOCK_FACTS[band],
            "date_start": MOCK_DATES[0],
            "date_end": MOCK_DATES[1],
            "date_mid": MOCK_DATES[2],
            "tile": "mock",
        }
        image = _mock_image(ra, dec, n, band)
        meta = _meta("mock", ra, dec, size, band, n, facts, "mock: synthetic image", image, [])
        return WiseImage(meta, image)

    cache = live_frames._cache(settings)
    key = make_key(
        "wise",
        WISE_VERSION,
        f"{ra:.6f}",
        f"{dec:.6f}",
        n,
        band,
        settings.wise_bucket_url,
        settings.wise_atlas_prefix,
    )
    meta_json = cache.get_json("wise", key)
    arrays = cache.get_arrays("wiseimg", key) if meta_json is not None else None
    if meta_json is not None and arrays is not None:
        meta = m.WiseImage(**meta_json)
        # The address depends on the requested size, which may differ within one pixel.
        meta = meta.model_copy(update={"size": size, "image_url": _image_url(ra, dec, size, band)})
        return WiseImage(meta, arrays["image"])

    tile = find_tile(settings, ra, dec)
    url = tile_url(settings, tile, band)
    image, facts = read_tile_patch(url, ra, dec, n)
    meta = _meta("live", ra, dec, size, band, n, facts, url, image, [])
    cache.put_arrays("wiseimg", key, {"image": image})
    cache.put_json("wise", key, meta.model_dump())
    return WiseImage(meta, image)


def wise_png(image: np.ndarray) -> bytes:
    """Greyscale PNG with the same kind of stretch as the SPHEREx frames."""
    shown = live_frames.background_subtracted(image.astype(np.float64))
    stretch = live_frames.common_stretch([shown])
    return live_frames.render(shown, stretch)
