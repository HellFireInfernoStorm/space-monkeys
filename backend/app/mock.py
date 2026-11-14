"""Synthetic data for SM_MODE=mock. Nothing in this file touches the network.

Everything is deterministic: the same request always gives the same answer, on every
machine. Random numbers are seeded from SHA-256 hashes, never from Python's ``hash()``
(which changes between runs).

THE NUMBERS HERE ARE MADE UP. Star positions, brightnesses, colours and periods are
chosen so that the pictures behave like real ones (stars stay put, the test targets move
or pulse, WISE 0855 is lost in the noise of a single frame). They are not measurements.
"""

import hashlib
import math
from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from .bands import BANDS, RESOLVING_POWER
from .config import PIXEL_SCALE_ARCSEC
from .png import encode_grey
from .targets import TARGETS, position_at_mjd

COLLECTION = "mock"

N_VISITS = 12
FIRST_MJD = 60800.0  # early May 2025
VISIT_SPACING_DAYS = 33.5
# Where in its band each visit lands. Real exposures also see a point at a different
# wavelength every time, which is why frames must be matched by wavelength before blinking.
BAND_FRACTIONS = (0.15, 0.5, 0.85)

MIN_PIXELS = 8
MAX_PIXELS = 96
SIGMA_PX = 0.75  # width of a star image, in pixels
NOISE_SIGMA = 0.15  # per pixel, MJy/sr
TILE_DEG = 0.2
N_ROWS = round(180.0 / TILE_DEG)
STARS_PER_TILE = 400

# One pixel is (6.15 arcsec)^2 = 8.89e-10 sr, so 1 MJy/sr over one pixel is 889 microjansky.
UJY_PER_PIXEL_MJY_SR = 889.0
PSF_AREA_PX = 2.0 * math.pi * SIGMA_PX**2

# Display stretch (fixed, so that brightness changes between frames stay visible).
STRETCH_SOFT = 0.3
STRETCH_LOW = -0.45
STRETCH_HIGH = 40.0
DIFF_HIGH = 10.0


@dataclass(frozen=True)
class MockExposure:
    exposure_id: str
    obs_id: str
    detector: int
    mjd: float
    wavelength_um: float
    exptime_s: float


@dataclass(frozen=True)
class _Look:
    """How a built-in target is drawn. Mock values, not measurements."""

    peak: float  # MJy/sr in the brightest pixel at 2.5 micrometres
    alpha: float  # brightness goes as (wavelength / 2.5) ** alpha
    amp: float = 0.0  # fractional brightness swing
    period: float = 100.0  # days
    min_wl: float = 0.0  # invisible below this wavelength


_LOOKS: dict[str, _Look] = {
    "barnard": _Look(peak=40.0, alpha=-1.5),
    "eps-ind-b": _Look(peak=6.0, alpha=1.0),
    "wise-0855": _Look(peak=0.3, alpha=0.0, min_wl=4.4),  # about 2 sigma in one frame
    "rw-aur": _Look(peak=30.0, alpha=-0.5, amp=0.5, period=97.0),
    "r-dra": _Look(peak=60.0, alpha=-1.0, amp=0.7, period=245.6),
}


def _seed(*parts: object) -> int:
    digest = hashlib.sha256("|".join(str(p) for p in parts).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


def _unit(*parts: object) -> float:
    """A repeatable number in [0, 1)."""
    return _seed(*parts) / 2**64


@lru_cache
def all_exposures() -> tuple[MockExposure, ...]:
    """The mock survey: 12 visits, each with all six detectors. The same for every position."""
    out: list[MockExposure] = []
    for visit in range(N_VISITS):
        obs_id = f"mock_{visit:04d}"
        visit_mjd = FIRST_MJD + visit * VISIT_SPACING_DAYS + 2.0 * _unit("mjd", visit)
        for detector, (lo, hi) in BANDS.items():
            fraction = BAND_FRACTIONS[visit % len(BAND_FRACTIONS)]
            fraction += 0.04 * (_unit("wl", visit, detector) - 0.5)
            out.append(
                MockExposure(
                    exposure_id=f"{obs_id}-D{detector}",
                    obs_id=obs_id,
                    detector=detector,
                    mjd=round(visit_mjd + 0.01 * detector, 5),
                    wavelength_um=round(lo + fraction * (hi - lo), 4),
                    exptime_s=113.6,
                )
            )
    out.sort(key=lambda e: e.mjd)
    return tuple(out)


@lru_cache
def _by_id() -> dict[str, MockExposure]:
    return {e.exposure_id: e for e in all_exposures()}


def get_exposure(exposure_id: str) -> MockExposure | None:
    return _by_id().get(exposure_id)


def patch_pixels(size_arcsec: float) -> int:
    """Width of a patch in original pixels."""
    return int(min(MAX_PIXELS, max(MIN_PIXELS, round(size_arcsec / PIXEL_SCALE_ARCSEC))))


# --- the mock sky -------------------------------------------------------------------


def _row_of(dec: float) -> int:
    return min(N_ROWS - 1, max(0, math.floor((dec + 90.0) / TILE_DEG)))


def _tiles_in_row(row: int) -> int:
    dec_mid = -90.0 + (row + 0.5) * TILE_DEG
    return max(1, round(360.0 * math.cos(math.radians(dec_mid)) / TILE_DEG))


@lru_cache(maxsize=512)
def _tile_stars(col: int, row: int) -> np.ndarray:
    """Stars of one sky tile. Columns: ra, dec, peak, alpha, amp, period, phase."""
    width = 360.0 / _tiles_in_row(row)
    rng = np.random.default_rng(_seed("tile", col, row))
    n = STARS_PER_TILE
    ra = (col + rng.random(n)) * width
    dec = -90.0 + (row + rng.random(n)) * TILE_DEG
    # Many faint stars, few bright ones.
    peak = np.minimum(0.3 / (1.0 - rng.random(n)) ** 0.8, 60.0)
    alpha = np.clip(rng.normal(-1.0, 1.0, n), -2.5, 1.5)
    variable = rng.random(n) < 0.05
    amp = np.where(variable, rng.uniform(0.3, 0.6, n), 0.0)
    period = rng.uniform(50.0, 400.0, n)
    phase = rng.uniform(0.0, 2.0 * math.pi, n)
    return np.column_stack([ra, dec, peak, alpha, amp, period, phase])


def _sources(
    ra_c: float, dec_c: float, half_arcsec: float, exposure: MockExposure
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Everything within a square around a position, as seen in one exposure.

    Returns offsets east and north of the centre (arcseconds) and peak brightness (MJy/sr).
    """
    wl, mjd = exposure.wavelength_um, exposure.mjd
    cos_c = max(math.cos(math.radians(dec_c)), 1e-6)

    blocks = []
    row_c = _row_of(dec_c)
    for row in sorted({max(0, row_c - 1), row_c, min(N_ROWS - 1, row_c + 1)}):
        n_cols = _tiles_in_row(row)
        col_c = int(ra_c / (360.0 / n_cols)) % n_cols
        for col in sorted({(col_c - 1) % n_cols, col_c, (col_c + 1) % n_cols}):
            blocks.append(_tile_stars(col, row))
    stars = np.vstack(blocks)

    east = (((stars[:, 0] - ra_c + 180.0) % 360.0) - 180.0) * cos_c * 3600.0
    north = (stars[:, 1] - dec_c) * 3600.0
    keep = (np.abs(east) < half_arcsec) & (np.abs(north) < half_arcsec)
    s = stars[keep]
    peak = s[:, 2] * (wl / 2.5) ** s[:, 3]
    peak = peak * (1.0 + s[:, 4] * np.sin(2.0 * math.pi * mjd / s[:, 5] + s[:, 6]))

    easts, norths, peaks = [east[keep]], [north[keep]], [peak]
    for target in TARGETS:
        look = _LOOKS.get(target.id)
        if look is None or wl < look.min_wl:
            continue
        t_ra, t_dec = position_at_mjd(target.ra, target.dec, target.pmra, target.pmdec, target.epoch, mjd)
        t_east = (((t_ra - ra_c + 180.0) % 360.0) - 180.0) * cos_c * 3600.0
        t_north = (t_dec - dec_c) * 3600.0
        if abs(t_east) >= half_arcsec or abs(t_north) >= half_arcsec:
            continue
        t_peak = look.peak * (wl / 2.5) ** look.alpha
        t_peak *= 1.0 + look.amp * math.sin(2.0 * math.pi * mjd / look.period)
        easts.append(np.array([t_east]))
        norths.append(np.array([t_north]))
        peaks.append(np.array([t_peak]))
    return np.concatenate(easts), np.concatenate(norths), np.concatenate(peaks)


def patch(exposure: MockExposure, ra_c: float, dec_c: float, size_arcsec: float) -> np.ndarray:
    """A square image patch in MJy/sr. Row 0 is north, column 0 is east."""
    n = patch_pixels(size_arcsec)
    half = (n / 2.0 + 4.0) * PIXEL_SCALE_ARCSEC
    east, north, peak = _sources(ra_c, dec_c, half, exposure)
    x = n / 2.0 - east / PIXEL_SCALE_ARCSEC
    y = n / 2.0 - north / PIXEL_SCALE_ARCSEC
    centres = np.arange(n) + 0.5
    gx = np.exp(-((centres[None, :] - x[:, None]) ** 2) / (2.0 * SIGMA_PX**2))
    gy = np.exp(-((centres[None, :] - y[:, None]) ** 2) / (2.0 * SIGMA_PX**2))
    image = np.einsum("k,ky,kx->yx", peak, gy, gx)

    background = 0.2 + 0.6 * _unit("background", exposure.exposure_id)
    rng = np.random.default_rng(_seed("noise", exposure.exposure_id, round(ra_c, 5), round(dec_c, 5), n))
    return image + background + rng.normal(0.0, NOISE_SIGMA, (n, n))


def render_png(image: np.ndarray, reference: np.ndarray | None = None) -> bytes:
    """Greyscale PNG of a patch, or of (patch minus reference) when a reference is given."""
    image = image - np.median(image)
    if reference is None:
        low = math.asinh(STRETCH_LOW / STRETCH_SOFT)
        high = math.asinh(STRETCH_HIGH / STRETCH_SOFT)
        scaled = (np.arcsinh(image / STRETCH_SOFT) - low) / (high - low)
    else:
        difference = image - (reference - np.median(reference))
        scaled = 0.5 + 0.5 * np.arcsinh(difference / STRETCH_SOFT) / math.asinh(DIFF_HIGH / STRETCH_SOFT)
    return encode_grey(scaled)


def frame_png(
    exposure: MockExposure,
    ra_c: float,
    dec_c: float,
    size_arcsec: float,
    reference: MockExposure | None = None,
) -> bytes:
    image = patch(exposure, ra_c, dec_c, size_arcsec)
    if reference is None:
        return render_png(image)
    return render_png(image, patch(reference, ra_c, dec_c, size_arcsec))


def photometry(exposure: MockExposure, ra: float, dec: float) -> tuple[float, float, float, int]:
    """Mock brightness at a point: (flux, flux_err, lambda_width, flags). Flux in microjansky."""
    east, north, peak = _sources(ra, dec, 4.0 * PIXEL_SCALE_ARCSEC, exposure)
    d2 = (east**2 + north**2) / PIXEL_SCALE_ARCSEC**2
    value = float(np.sum(peak * np.exp(-d2 / (2.0 * SIGMA_PX**2))))

    flux_err = NOISE_SIGMA * math.sqrt(2.0 * PSF_AREA_PX) * UJY_PER_PIXEL_MJY_SR
    rng = np.random.default_rng(_seed("phot", exposure.exposure_id, round(ra, 5), round(dec, 5)))
    flux = value * PSF_AREA_PX * UJY_PER_PIXEL_MJY_SR + float(rng.normal(0.0, flux_err))

    flags = 1 << 21 if value > 1.0 else 0  # SOURCE: "pixel mapped to a known source"
    if rng.random() < 0.05:
        flags |= 1 << 19  # OUTLIER, now and then, so the interface has something to show
    lambda_width = exposure.wavelength_um / RESOLVING_POWER[exposure.detector]
    return round(flux, 2), round(flux_err, 2), round(lambda_width, 5), flags
