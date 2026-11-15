"""Independent header-seeded plate-solving check. Never mutates science coordinates.

Centroids come from original detector pixels. Catalogue positions alone cannot verify
an image. Translation fits are diagnostics, not corrections applied to downstream data.
The conservative gates are engineering choices, not survey accuracy specifications.
"""

import asyncio
import csv
import io
import math
import re
import threading
import time
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import numpy as np

from . import live_frames, mock
from .cache import cache_for, make_key
from .config import PIXEL_SCALE_ARCSEC
from .flags import DEFAULT_BAD_MASK
from .models import AlignmentResult, StarMatch
from .resample import sky_to_tangent, tangent_to_sky

VERSION = "translation-check-v2"
FIELD_PIXELS = 161  # bounded ~16.5 arcminute native-pixel patch
MIN_MATCHES = 8
MATCH_RADIUS = PIXEL_SCALE_ARCSEC  # header-seeded, not a blind solver
MAX_RMS = 0.5 * PIXEL_SCALE_ARCSEC
_slots = threading.BoundedSemaphore(2)


def base_result(settings, exposure_id, mjd=None, **changes):
    return AlignmentResult(
        mode=settings.mode, exposure_id=exposure_id, mjd=mjd,
        state="complete", provenance="archive", reason="Not independently verified.",
        catalogue=settings.astrometry_catalogue, catalogue_url=settings.astrometry_catalogue_url,
        solver_version=VERSION, field_arcsec=FIELD_PIXELS * PIXEL_SCALE_ARCSEC, **changes,
    )


def detect(image, flags):
    """Isolated local maxima with complete clean 5x5 footprints; 0-based centroids.

No catalogue priors enter detection. No brightest-pixel selection at predicted stars.
"""
    good = np.isfinite(image) & ((flags & DEFAULT_BAD_MASK) == 0)
    values = image[good]
    if values.size < 100:
        return np.empty((0, 2))
    sky = float(np.median(values))
    noise = float(1.4826 * np.median(np.abs(values - sky)))
    if not math.isfinite(noise) or noise <= 0:
        return np.empty((0, 2))
    h, w = image.shape
    centre = image[2:h-2, 2:w-2]
    peaks = good[2:h-2, 2:w-2] & (centre > sky + 7 * noise)
    for dy in range(-1, 2):
        for dx in range(-1, 2):
            if dx or dy:
                peaks &= centre > image[2+dy:h-2+dy, 2+dx:w-2+dx]
    ys, xs = np.nonzero(peaks)
    order = np.argsort(image[ys+2, xs+2])[::-1]
    found = []
    for i in order[:500]:
        x, y = int(xs[i]+2), int(ys[i]+2)
        if np.count_nonzero((xs + 2 - x)**2 + (ys + 2 - y)**2 < 36) > 1:
            continue  # reject BOTH peaks of a close pair, including the brighter one
        if not good[y-2:y+3, x-2:x+3].all():
            continue
        # Reject competing peaks/blends in the centroid footprint.
        if any((x-px)**2 + (y-py)**2 < 36 for px, py in found):
            continue
        patch = image[y-2:y+3, x-2:x+3]
        border = np.concatenate([patch[0], patch[-1], patch[1:-1, 0], patch[1:-1, -1]])
        weights = np.maximum(patch - np.median(border), 0)
        total = weights.sum()
        if total <= 0:
            continue
        yy, xx = np.mgrid[-2:3, -2:3]
        cx, cy = x + float((xx*weights).sum()/total), y + float((yy*weights).sum()/total)
        if math.hypot(cx-x, cy-y) > 1:
            continue
        found.append((cx, cy))
        if len(found) >= 150:
            break
    return np.asarray(found, dtype=float).reshape(-1, 2)


def assess(result, ids, catalogue_sky, measured_sky, ra, dec):
    """Mutual, unambiguous nearest neighbours and a robust translation diagnostic.

Require at least eight matches, 2D spatial coverage, agreement without correction,
and leave-one-out residuals. Reject rather than fit away motion or wrong WCS.
"""
    result.detected = len(measured_sky)
    if not len(catalogue_sky) or not len(measured_sky):
        result.reason = "Not enough clean reference stars; showing archive coordinates."
        return result
    cat = np.column_stack(sky_to_tangent(ra, dec, catalogue_sky[:, 0], catalogue_sky[:, 1]))
    obs = np.column_stack(sky_to_tangent(ra, dec, measured_sky[:, 0], measured_sky[:, 1]))
    distances = np.linalg.norm(cat[:, None, :] - obs[None, :, :], axis=2)
    pairs = []
    for ci in range(len(cat)):
        oi = int(np.argmin(distances[ci]))
        # Reject ambiguous catalogue OR detection associations, not just duplicates.
        if (distances[ci, oi] <= MATCH_RADIUS and np.argmin(distances[:, oi]) == ci
                and np.sum(distances[ci] <= MATCH_RADIUS) == 1
                and np.sum(distances[:, oi] <= MATCH_RADIUS) == 1):
            pairs.append((ci, oi))
    result.matched = len(pairs)
    if len(pairs) < MIN_MATCHES:
        result.reason = f"Only {len(pairs)} unambiguous matches; need at least {MIN_MATCHES}."
    if not pairs:
        return result
    ci, oi = np.array(pairs).T
    offsets = obs[oi] - cat[ci]
    median = np.median(offsets, axis=0)
    residuals = np.linalg.norm(offsets - median, axis=1)
    # Fixed 0.35-pixel outlier gate; cannot inflate with a bad candidate fit.
    inliers = residuals <= 0.35 * PIXEL_SCALE_ARCSEC
    result.rejected = int((~inliers).sum())
    for k, (c, o) in enumerate(pairs):
        result.matches.append(StarMatch(
            source_id=str(ids[c]), catalogue_ra=float(catalogue_sky[c, 0]),
            catalogue_dec=float(catalogue_sky[c, 1]), measured_ra=float(measured_sky[o, 0]),
            measured_dec=float(measured_sky[o, 1]), east_arcsec=float(offsets[k, 0]),
            north_arcsec=float(offsets[k, 1]), residual_arcsec=float(np.linalg.norm(offsets[k])),
            inlier=bool(inliers[k]),
        ))
    if inliers.sum() < MIN_MATCHES:
        result.reason = f"Only {int(inliers.sum())} consistent matches; need at least {MIN_MATCHES}."
        return result
    points = cat[ci[inliers]]
    eigenvalues = np.linalg.eigvalsh(np.cov(points.T))
    if eigenvalues[0] < (3 * PIXEL_SCALE_ARCSEC)**2 or eigenvalues[0] < 0.05*eigenvalues[1]:
        result.reason = "Reference stars are clustered or nearly collinear; verification rejected."
        return result
    kept = offsets[inliers]
    translation = np.median(kept, axis=0)
    loo = [kept[i] - np.median(np.delete(kept, i, axis=0), axis=0) for i in range(len(kept))]
    result.rms_arcsec = float(np.sqrt(np.mean(np.sum(kept**2, axis=1))))
    result.rms_pixels = result.rms_arcsec / PIXEL_SCALE_ARCSEC
    result.median_arcsec = float(np.median(np.linalg.norm(kept, axis=1)))
    result.fit_rms_arcsec = float(np.sqrt(np.mean(np.sum(np.array(loo)**2, axis=1))))
    result.offset_east_arcsec, result.offset_north_arcsec = map(float, translation)
    if result.rms_arcsec > MAX_RMS or result.fit_rms_arcsec > MAX_RMS:
        result.reason = "Offsets exceed the 0.5-pixel gate; archive coordinates remain unverified."
        return result
    result.provenance = "mock" if result.mode == "mock" else "verified"
    result.reason = "Archive coordinates verified against detected reference stars. No correction applied."
    return result


def catalogue(settings, ra, dec, mjd):
    """Bounded Gaia TAP query; missing motions are excluded, not assumed zero."""
    import astropy.units as u
    from astropy.coordinates import SkyCoord
    from astropy.time import Time

    table = settings.astrometry_catalogue
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]*", table):
        raise ValueError("Invalid configured catalogue name")
    radius = FIELD_PIXELS * PIXEL_SCALE_ARCSEC / 3600  # circumscribes rotated patch
    query = (
        f"SELECT TOP 501 source_id,ra,dec,pmra,pmdec,ref_epoch FROM {table} "
        f"WHERE 1=CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',{ra:.9f},{dec:.9f},{radius:.9f})) "
        "AND pmra IS NOT NULL AND pmdec IS NOT NULL AND ruwe < 1.4 "
        "AND parallax < 10 AND phot_g_mean_mag < 18 ORDER BY phot_g_mean_mag"
    )
    payload = urlencode({"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": query})
    request = Request(settings.astrometry_tap_url, data=payload.encode(),
                      headers={"User-Agent": "spaceshift/astrometry-check"})
    with urlopen(request, timeout=settings.astrometry_io_timeout_s) as response:
        data = response.read(1_000_001)
    if len(data) > 1_000_000:
        raise ValueError("Catalogue response exceeded size limit")
    reader = csv.DictReader(io.StringIO(data.decode("utf-8-sig")))
    if not {"source_id", "ra", "dec", "pmra", "pmdec", "ref_epoch"}.issubset(reader.fieldnames or []):
        raise ValueError("Catalogue response is not the requested CSV table")
    rows = list(reader)
    if len(rows) > 500:
        raise ValueError("Catalogue field exceeded 500-source cap; verification rejected")
    if not rows:
        return [], np.empty((0, 2))
    numbers = np.array([[float(row[k]) for k in ("ra", "dec", "pmra", "pmdec", "ref_epoch")]
                        for row in rows])
    if not np.isfinite(numbers).all():
        raise ValueError("Catalogue contains invalid coordinates or motions")
    stars = SkyCoord(ra=numbers[:, 0]*u.deg, dec=numbers[:, 1]*u.deg,
                     pm_ra_cosdec=numbers[:, 2]*u.mas/u.yr, pm_dec=numbers[:, 3]*u.mas/u.yr,
                     obstime=Time(numbers[:, 4], format="jyear"))
    moved = stars.apply_space_motion(new_obstime=Time(mjd, format="mjd"))
    return [row["source_id"] for row in rows], np.column_stack([moved.ra.deg, moved.dec.deg])


def native_stars(settings, exposure, ra, dec):
    """Read only bounded IMAGE/FLAGS sections with full celestial distortion model."""
    from astropy.io import fits

    from .pixels import _celestial_wcs, _world_to_pixel

    if not exposure.cloud_url:
        raise ValueError("Exposure has no mirror location")
    kwargs = {}
    if exposure.cloud_url.startswith("https://"):
        import aiohttp

        kwargs = {"use_fsspec": True, "fsspec_kwargs": {
            "block_size": 131072, "cache_type": "bytes",
            "client_kwargs": {"timeout": aiohttp.ClientTimeout(
                total=settings.astrometry_io_timeout_s)},
        }}
    with fits.open(exposure.cloud_url, lazy_load_hdus=True, **kwargs) as hdus:
        hdu = hdus["IMAGE"]
        wcs = _celestial_wcs(hdu.header)
        x, y = _world_to_pixel(wcs, np.array([ra]), np.array([dec]))
        if not np.isfinite([x[0], y[0]]).all():
            raise ValueError("Position does not project onto detector")
        cx, cy = int(round(x[0])), int(round(y[0]))
        half = FIELD_PIXELS // 2
        x0, x1 = max(0, cx-half), min(hdu.header["NAXIS1"], cx+half+1)
        y0, y1 = max(0, cy-half), min(hdu.header["NAXIS2"], cy+half+1)
        if x0 >= x1 or y0 >= y1:
            raise ValueError("Position is outside detector")
        image = np.asarray(hdu.section[y0:y1, x0:x1], dtype=float)
        flags = np.asarray(hdus["FLAGS"].section[y0:y1, x0:x1], dtype=np.int64)
    xy = detect(image, flags)
    if not len(xy):
        return np.empty((0, 2))
    world = np.column_stack(wcs.all_pix2world(xy[:, 0]+x0, xy[:, 1]+y0, 0))
    return world[np.isfinite(world).all(axis=1)]


def solve(settings, exposure_id, ra, dec, target_ra, target_dec):
    started = time.monotonic()
    if settings.mode == "mock":
        exposure = mock.get_exposure(exposure_id)
        if exposure is None:
            raise live_frames.UnknownExposure(exposure_id)
    else:
        exposure = live_frames.find_exposure(settings, exposure_id)
    result = base_result(settings, exposure_id, exposure.mjd)
    result.center_ra, result.center_dec = ra, dec
    result.target_ra, result.target_dec = target_ra, target_dec
    if not _slots.acquire(blocking=False):
        return result.model_copy(update={
            "state": "busy", "reason": "Two checks already running. Try again shortly.",
        })
    try:
        cache = cache_for(settings.cache_dir)
        key = make_key(VERSION, settings.mode, exposure_id, getattr(exposure, "cloud_url", None),
                       ra, dec, target_ra, target_dec, settings.astrometry_catalogue,
                       settings.astrometry_tap_url)
        saved = cache.get_json("alignment", key, max_age_s=86400)
        if saved:
            return AlignmentResult(**saved)
        if settings.mode == "mock":
            # Use the same synthetic sources actually drawn in the image, not arbitrary dots.
            east, north, peaks = mock._sources(ra, dec, result.field_arcsec/2, exposure)
            keep = peaks > 2
            east, north = east[keep], north[keep]
            # Centroid markers sit on the actual drawn source positions; the mock
            # reference catalogue has a small deliberately injected offset.
            sky = np.column_stack(tangent_to_sky(ra, dec, east-0.4, north+0.2))
            measured = np.column_stack(tangent_to_sky(ra, dec, east, north))
            if exposure.detector == 6:
                sky, measured = sky[:3], measured[:3]  # reproducible sparse-field demonstration
            ids = [f"synthetic-{i}" for i in range(len(sky))]
            result.catalogue = "Synthetic demonstration — not Gaia"
            result.catalogue_url = ""
        else:
            measured = native_stars(settings, exposure, ra, dec)
            result.detected = len(measured)
            ids, sky = catalogue(settings, ra, dec, exposure.mjd)
        # Exclude moving target and neighbours within 3 native pixels from BOTH lists.
        for name, stars in (("cat", sky), ("obs", measured)):
            if not len(stars):
                continue
            e, n = sky_to_tangent(target_ra, target_dec, stars[:, 0], stars[:, 1])
            keep = np.hypot(e, n) > 3*PIXEL_SCALE_ARCSEC
            if name == "cat":
                sky = stars[keep]
                ids = [value for value, good in zip(ids, keep, strict=True) if good]
            else:
                measured = stars[keep]
        result = assess(result, ids, sky, measured, ra, dec)
        result.elapsed_s = round(time.monotonic()-started, 3)
        if settings.mode == "mock":
            result.provenance = "mock"
            result.reason = "Mock demonstration (not real measurements). " + result.reason
        cache.put_json("alignment", key, result.model_dump())
        return result
    except (TimeoutError, OSError, ValueError, KeyError, ImportError) as error:
        timed_out = isinstance(error, TimeoutError) or (
            isinstance(error, URLError) and isinstance(error.reason, TimeoutError)
        )
        result.state = "timeout" if timed_out else "failed"
        result.reason = f"Check unavailable ({type(error).__name__}); showing unverified archive coordinates."
        result.elapsed_s = round(time.monotonic()-started, 3)
        return result
    finally:
        _slots.release()


async def check(settings, exposure_id, ra, dec, target_ra, target_dec):
    # wait_for returns promptly. A timed-out thread retains its slot until it exits,
    # so repeated requests cannot create unbounded active network readers.
    try:
        return await asyncio.wait_for(asyncio.to_thread(
            solve, settings, exposure_id, ra, dec, target_ra, target_dec,
        ), timeout=settings.astrometry_timeout_s)
    except TimeoutError:
        return base_result(settings, exposure_id).model_copy(update={
            "state": "timeout", "reason": "Check timed out; showing unverified archive coordinates.",
        })
