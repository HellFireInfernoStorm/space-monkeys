"""Layer 3: quick-look aperture photometry at one point, in every matching exposure.

Plot the points against wavelength for a spectrum, or against time for a light curve.

The method is the one checked against 2MASS in issue #4 (pull request #5):

- aperture of radius 3 pixels around the object's position on the date of the exposure;
- background: the median of an annulus from 5 to 7.5 pixels;
- MJy/sr times the solid angle of one 6.15 arcsecond pixel gives janskys.

A point whose aperture holds any empty pixel (flagged, missing or off the detector; see
`Patch.image`) is returned with no flux. Summing the pixels that survive would report a
fraction of a star as if it were the whole star, which is how a saturated star core
would otherwise look like a faint one. Empty pixels in the annulus are simply left out
of the background.

These are quick estimates. IRSA's Spectrophotometry Tool is the precise method.
"""

import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np

from . import models as m
from .bands import RESOLVING_POWER
from .cache import make_key
from .config import PIXEL_SCALE_ARCSEC, Settings
from .flags import describe
from .live_frames import GRID_VERSION, _cache, _centre_text, _safe, get_patch, matching_exposures
from .mock import patch_pixels
from .resample import sky_to_tangent
from .sampling import sample_evenly
from .targets import TARGETS, parallax_offset, position_at_mjd

APERTURE_RADIUS_PX = 3.0
SKY_INNER_PX = 5.0
SKY_OUTER_PX = 7.5
MIN_SKY_PIXELS = 20
# Patch width on the sky. 120 arcseconds is 21 pixels: room for the annulus around the
# centre, and the same patch the blink player reads at its default size when it is
# centred on the same point, so the two share the disk cache.
PATCH_SIZE_ARCSEC = 120.0
# Bump when the measurement changes, so old cached results are not reused.
PHOTOMETRY_VERSION = 5

# The same unit as mock mode, so the two answer alike. 1 Jy = 1e6 uJy.
FLUX_UNIT = "uJy"
UJY_PER_JY = 1e6
METHOD = (
    "Quick-look aperture photometry: radius 3 pixels (18.5 arcsec), background from the median "
    "of an annulus of 5 to 7.5 pixels, error from the scatter of that annulus. The error covers "
    "background noise only: for bright sources the scatter between exposures is larger (3.8 % "
    "for a 0.14 Jy check star, issue #7). Points whose aperture holds a flagged or missing pixel "
    "have no flux. lambda_width uses the approximate resolving power of each detector. For "
    "precise values use IRSA's Spectrophotometry Tool."
)

# MJy/sr in one pixel -> Jy.
JY_PER_PIXEL_MJY_SR = 1e6 * math.radians(PIXEL_SCALE_ARCSEC / 3600.0) ** 2


@dataclass(frozen=True)
class Measurement:
    flux: float  # Jy
    flux_err: float  # Jy


def _radius(shape: tuple[int, int], x: float, y: float) -> np.ndarray:
    """Distance (pixels) of every pixel centre from (x, y). Pixel centres sit at i + 0.5."""
    yy, xx = np.indices(shape) + 0.5
    return np.hypot(xx - x, yy - y)


# Why a point could not be measured. The front end shows these words as they are.
EDGE = "too close to the edge of the image for the aperture and background ring"
EMPTY = "empty pixel in the aperture (flagged, missing or off the detector)"
NO_SKY = "too few usable pixels in the background ring"


def measure(image: np.ndarray, x: float, y: float) -> Measurement | None:
    """Aperture flux and its error at (x, y), in janskys, or None if it cannot be measured.

    See `measure_or_reason` for the method; this form is for callers that need only the number.
    """
    return measure_or_reason(image, x, y)[0]


def measure_or_reason(image: np.ndarray, x: float, y: float) -> tuple[Measurement | None, str | None]:
    """(measurement, None), or (None, why it was refused): one of EDGE, EMPTY, NO_SKY.

    `image` is MJy/sr with NaN for unusable pixels. (x, y) is in pixels from the image
    corner, with pixel centres at i + 0.5. Refused when the annulus does not fit inside the
    image, any aperture pixel is empty, or fewer than `MIN_SKY_PIXELS` sky pixels are left.

    The error combines the pixel scatter in the aperture with the uncertainty of the
    median background: sigma * sqrt(N_ap + (pi / 2) * N_ap**2 / N_sky), where sigma is
    the robust standard deviation (1.4826 times the median absolute deviation) of the
    annulus.
    """
    if min(x, y, image.shape[1] - x, image.shape[0] - y) < SKY_OUTER_PX:
        return None, EDGE
    radius = _radius(image.shape, x, y)
    source = image[radius <= APERTURE_RADIUS_PX]
    sky = image[(radius >= SKY_INNER_PX) & (radius <= SKY_OUTER_PX)]
    sky = sky[np.isfinite(sky)]
    if source.size == 0 or not np.isfinite(source).all():
        return None, EMPTY
    if sky.size < MIN_SKY_PIXELS:
        return None, NO_SKY
    level = float(np.median(sky))
    sigma = 1.4826 * float(np.median(np.abs(sky - level)))
    n_ap, n_sky = source.size, sky.size
    error = sigma * math.sqrt(n_ap + (math.pi / 2.0) * n_ap**2 / n_sky)
    flux = float(np.sum(source - level))
    return Measurement(flux=flux * JY_PER_PIXEL_MJY_SR, flux_err=error * JY_PER_PIXEL_MJY_SR), None


def reason_text(reason: str, flags: int) -> str:
    """The refusal reason, with the names of the problem flags set in the aperture, if any."""
    names = [f.name for f in describe(flags) if not f.informational]
    return f"{reason}; flags: {', '.join(names)}" if reason == EMPTY and names else reason


def aperture_flags(flags: np.ndarray, x: float, y: float) -> int:
    """Bitwise OR of the flag bits of every pixel in the aperture."""
    inside = flags[_radius(flags.shape, x, y) <= APERTURE_RADIUS_PX]
    return int(np.bitwise_or.reduce(inside.astype(np.int64))) if inside.size else 0


# A known field star whose centre is closer than this to the aperture centre adds its light to
# the measurement: the aperture radius plus one pixel, for the star's own spread.
NEIGHBOUR_RADIUS_ARCSEC = (APERTURE_RADIUS_PX + 1.0) * PIXEL_SCALE_ARCSEC


def neighbours_in_aperture(
    ra: float, dec: float, pmra: float, pmdec: float, epoch: float, parallax: float, mjds: list[float]
) -> list[tuple[str, float, float]]:
    """Known field stars (`Target.neighbours` in targets.py) near the measured position on any of
    the dates: (source, closest, farthest) separation in arcseconds over the dates where it is near."""
    found = []
    for target in TARGETS:
        for known in target.neighbours:
            seps = []
            for mjd in mjds:
                t_ra, t_dec = position_at_mjd(ra, dec, pmra, pmdec, epoch, mjd)
                plx_east, plx_north = parallax_offset(t_ra, t_dec, parallax, mjd)
                east, north = sky_to_tangent(t_ra, t_dec, np.array([known.ra]), np.array([known.dec]))
                sep = math.hypot(float(east[0]) - plx_east, float(north[0]) - plx_north)
                if sep <= NEIGHBOUR_RADIUS_ARCSEC:
                    seps.append(sep)
            if seps:
                found.append((known.source, min(seps), max(seps)))
    return found


def search_incomplete(warnings: list[str]) -> bool:
    """True if some collection could not be searched, or a saved search stood in for a failed
    one. Such a result is not cached: it would freeze an incomplete answer for hours."""
    return any(("Search of " in w and " failed:" in w) or "archive search failed" in w for w in warnings)


def _key(settings: Settings, query: tuple) -> str:
    return make_key(
        "photometry",
        PHOTOMETRY_VERSION,
        GRID_VERSION,
        query,
        PIXEL_SCALE_ARCSEC,
        ",".join(settings.collections),
    )


def live_photometry(
    settings: Settings,
    ra: float,
    dec: float,
    pmra: float,
    pmdec: float,
    epoch: float,
    parallax: float,
    wl_min: float | None,
    wl_max: float | None,
    max_items: int | None,
) -> m.PhotometryResult:
    """The /api/photometry answer in live mode: from the disk cache if fresh, else measured."""
    cap = min(max_items, settings.max_exposures) if max_items is not None else settings.max_exposures
    query = (
        f"{ra:.6f}",
        f"{dec:.6f}",
        f"{pmra:g}",
        f"{pmdec:g}",
        f"{epoch:g}",
        f"{parallax:g}",
        "" if wl_min is None else f"{wl_min:g}",
        "" if wl_max is None else f"{wl_max:g}",
        cap,
    )
    cache = _cache(settings)
    key = _key(settings, query)
    stored = cache.get_json("photometry", key, max_age_s=settings.search_cache_hours * 3600.0)
    if stored is not None:
        return m.PhotometryResult(**stored)
    result = _measure_all(settings, ra, dec, pmra, pmdec, epoch, parallax, wl_min, wl_max, cap)
    if result.returned and not search_incomplete(result.warnings):
        cache.put_json("photometry", key, result.model_dump())
    return result


def _measure_all(
    settings: Settings,
    ra: float,
    dec: float,
    pmra: float,
    pmdec: float,
    epoch: float,
    parallax: float,
    wl_min: float | None,
    wl_max: float | None,
    cap: int,
) -> m.PhotometryResult:
    matching, notes, failed, probes_capped = matching_exposures(
        settings, ra, dec, wl_min, wl_max, pmra, pmdec, epoch
    )
    picked = sample_evenly(matching, cap)
    if len(picked) < len(matching):
        notes.append(
            f"Measured {len(picked)} of {len(matching)} matching exposures, spread evenly over time."
        )
    n = patch_pixels(PATCH_SIZE_ARCSEC)

    def one(item):
        exposure, wavelength = item
        t_ra, t_dec = position_at_mjd(ra, dec, pmra, pmdec, epoch, exposure.mjd)
        # Centre the patch on the object, rounded as in image addresses so the cache is shared.
        c_ra, c_dec = float(_centre_text(t_ra)), float(_centre_text(t_dec))
        patch = get_patch(settings, exposure, c_ra, c_dec, n)
        if patch is None:
            return None
        east, north = sky_to_tangent(c_ra, c_dec, np.array([t_ra]), np.array([t_dec]))
        plx_east, plx_north = parallax_offset(t_ra, t_dec, parallax, exposure.mjd)
        size = patch.image.shape[0]
        x = size / 2.0 - (float(east[0]) + plx_east) / PIXEL_SCALE_ARCSEC
        y = size / 2.0 - (float(north[0]) + plx_north) / PIXEL_SCALE_ARCSEC
        result, reason = measure_or_reason(patch.image, x, y)
        flags = aperture_flags(patch.flags, x, y)
        return m.PhotometryPoint(
            exposure_id=exposure.exposure_id,
            obs_id=exposure.obs_id,
            det_id=exposure.detector,
            mjd=exposure.mjd,
            wavelength=round(wavelength, 5),
            lambda_width=round(wavelength / RESOLVING_POWER[exposure.detector], 5),
            flux=None if result is None else round(result.flux * UJY_PER_JY, 2),
            flux_err=None if result is None else round(result.flux_err * UJY_PER_JY, 2),
            flags=flags,
            usable=result is not None,
            reason=None if reason is None else reason_text(reason, flags),
        )

    with ThreadPoolExecutor(max_workers=max(1, settings.s3_concurrency)) as pool:
        outcomes = list(pool.map(_safe(one), picked))
    points = []
    for ok, point in outcomes:
        if not ok or point is None:
            failed += 1
        else:
            points.append(point)
    if failed:
        notes.append(f"{failed} exposure(s) could not be read and were skipped.")
    usable_dates = [p.mjd for p in points if p.usable]
    for source, closest, farthest in neighbours_in_aperture(
        ra, dec, pmra, pmdec, epoch, parallax, usable_dates
    ):
        notes.append(
            f"A known field star is {closest:.1f} to {farthest:.1f} arcseconds from the measured position, "
            f"inside the 18.5-arcsecond aperture: these fluxes include its light, and its share changes as "
            f"the object moves. They do not measure the object alone, and differences between visits are "
            f"not evidence of a brightness change. The Stack view fits the object and the star separately. "
            f"Source: {source}"
        )
    unmeasured = sum(1 for p in points if not p.usable)
    if unmeasured:
        notes.append(
            f"{unmeasured} of {len(points)} point(s) have no flux: the aperture holds flagged or missing "
            "pixels (for example a saturated star core, a cosmic ray or the detector edge)."
        )
    return m.PhotometryResult(
        mode="live",
        total=len(matching),
        returned=len(points),
        capped=len(picked) < len(matching) or probes_capped,
        warnings=notes,
        ra=ra,
        dec=dec,
        flux_unit=FLUX_UNIT,
        method=METHOD,
        points=points,
    )
