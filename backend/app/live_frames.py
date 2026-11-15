"""Layer 1 with real data: the frame list and frame images for SM_MODE=live.

Steps for /api/frames (docs/ARCHITECTURE.md, "The live data path"):

1. Search every configured collection (results kept on disk for `search_cache_hours`).
2. Keep exposures whose detector covers part of the requested wavelength range.
3. Read the wavelength at the target in each (the `WCS-WAVE` table at the target's pixel)
   and keep only those inside the range: never blink different wavelengths.
4. Cap to `max_frames`, spread evenly in time.
5. Read each patch by range requests, resample it onto one north-up, east-left grid,
   and cache it. One display stretch is computed over all frames and stored, so every
   PNG of the request uses the same scale and the blink does not flicker.

A second identical request reads everything from the cache and touches the network only
if the search result has expired.
"""

import math
import warnings
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from urllib.parse import urlencode

import numpy as np

from . import live
from . import models as m
from .cache import Cache, cache_for, make_key
from .config import PIXEL_SCALE_ARCSEC, Settings
from .live import LiveExposure
from .mock import patch_pixels
from .pixels import Patch, probe, read_patch
from .png import encode_grey
from .sampling import sample_evenly
from .targets import position_at_mjd, propagate

# Bump when the resampling changes, so old cached patches are not reused.
GRID_VERSION = 3


class SearchFailed(RuntimeError):
    """No collection could be searched (network or archive problem)."""


class UnknownExposure(KeyError):
    """An exposure id this server has not seen in a search."""


# --- small helpers ------------------------------------------------------------------


def _cache(settings: Settings) -> Cache:
    return cache_for(settings.cache_dir)


def _overlaps(e: LiveExposure, wl_min: float | None, wl_max: float | None) -> bool:
    return (wl_min is None or e.wl_max_um >= wl_min) and (wl_max is None or e.wl_min_um <= wl_max)


def _in_range(wavelength: float, wl_min: float | None, wl_max: float | None) -> bool:
    return (wl_min is None or wavelength >= wl_min) and (wl_max is None or wavelength <= wl_max)


def _centre_text(value: float) -> str:
    """Centres are written with 6 decimals in image addresses; cache keys use the same."""
    return f"{value:.6f}"


def _patch_key(exposure_id: str, ra_c: float, dec_c: float, n: int) -> str:
    return make_key(exposure_id, _centre_text(ra_c), _centre_text(dec_c), n, PIXEL_SCALE_ARCSEC, GRID_VERSION)


# --- exposures: search and the id -> file address registry ---------------------------


def remember_exposure(settings: Settings, exposure: LiveExposure) -> None:
    _cache(settings).put_json("exposure", make_key(exposure.exposure_id), asdict(exposure))


def find_exposure(settings: Settings, exposure_id: str) -> LiveExposure:
    data = _cache(settings).get_json("exposure", make_key(exposure_id))
    if data is None:
        raise UnknownExposure(exposure_id)
    return LiveExposure(**data)


def search(settings: Settings, ra: float, dec: float, radius: float) -> tuple[list[LiveExposure], list[str]]:
    """Exposures covering a position, from the disk cache when fresh enough.

    Raises SearchFailed when every collection failed and nothing usable is cached.
    """
    cache = _cache(settings)
    key = make_key(f"{ra:.4f}", f"{dec:.4f}", f"{radius:.5f}", ",".join(settings.collections))
    fresh = cache.get_json("search", key, max_age_s=settings.search_cache_hours * 3600.0)
    if fresh is not None:
        return [LiveExposure(**e) for e in fresh], []

    found, problems = live.search_exposures(settings, ra, dec, radius)
    if not found and len(problems) >= len(settings.collections):
        stale = cache.get_json("search", key)
        if stale is not None:
            note = "The archive search failed; showing the last saved search result."
            return [LiveExposure(**e) for e in stale], [note, *problems]
        raise SearchFailed("The SPHEREx archive search failed. " + " ".join(problems)[:400])
    if not problems:
        cache.put_json("search", key, [asdict(e) for e in found])
    for exposure in found:
        remember_exposure(settings, exposure)
    return found, problems


# --- wavelength at the target, and patches -------------------------------------------


def wavelength_at_target(settings: Settings, exposure: LiveExposure, ra: float, dec: float) -> float | None:
    """Cached wavelength (micrometres) at a position, or None if off the detector."""
    cache = _cache(settings)
    key = make_key(exposure.exposure_id, f"{ra:.4f}", f"{dec:.4f}")
    stored = cache.get_json("probe", key)
    if stored is not None:
        return stored["wavelength"]
    if not exposure.cloud_url:
        raise ValueError(f"{exposure.exposure_id} has no address on the AWS mirror")
    wavelength = probe(exposure.cloud_url, ra, dec)
    cache.put_json("probe", key, {"wavelength": wavelength})
    return wavelength


def get_patch(settings: Settings, exposure: LiveExposure, ra_c: float, dec_c: float, n: int) -> Patch | None:
    """Cached patch on the common grid, or None if the position misses the detector."""
    cache = _cache(settings)
    key = _patch_key(exposure.exposure_id, ra_c, dec_c, n)
    stored = cache.get_arrays("patch", key)
    if stored is not None:
        if stored["image"].size == 0:
            return None
        return Patch(image=stored["image"], raw=stored["raw"], flags=stored["flags"])
    if not exposure.cloud_url:
        raise ValueError(f"{exposure.exposure_id} has no address on the AWS mirror")
    patch = read_patch(
        exposure.cloud_url, float(_centre_text(ra_c)), float(_centre_text(dec_c)), n, PIXEL_SCALE_ARCSEC
    )
    if patch is None:
        empty = np.zeros((0, 0), dtype=np.float32)
        cache.put_arrays("patch", key, {"image": empty, "raw": empty, "flags": empty.astype(np.int32)})
        return None
    cache.put_arrays("patch", key, {"image": patch.image, "raw": patch.raw, "flags": patch.flags})
    return patch


# --- display ------------------------------------------------------------------------


def background_subtracted(image: np.ndarray) -> np.ndarray:
    """Remove the zodiacal light and other smooth background: the median of the usable
    pixels. Masked pixels stay NaN."""
    finite = image[np.isfinite(image)]
    if finite.size == 0:
        return image.astype(np.float64)
    return image.astype(np.float64) - float(np.median(finite))


def background_level(image: np.ndarray) -> float:
    finite = image[np.isfinite(image)]
    return float(np.median(finite)) if finite.size else 0.0


def fill_for_display(patch: Patch) -> np.ndarray:
    """A background-subtracted picture with no holes, for the blink view only.

    The cores of bright stars are flagged (overflow, bloom), so the masked image has a
    hole exactly where the star is. For the picture, masked pixels show their unmasked
    value; pixels with no value at all take the median of their usable neighbours. The
    background level and the stretch still come from good pixels only, and difference
    images use the masked image (a masked pixel there shows as "no change").
    """
    background = background_level(patch.image)
    shown = np.where(np.isfinite(patch.image), patch.image, patch.raw).astype(np.float64)
    holes = ~np.isfinite(shown)
    if holes.any():
        padded = np.pad(shown, 1, constant_values=np.nan)
        h, w = shown.shape
        windows = np.stack([padded[dy : dy + h, dx : dx + w] for dy in range(3) for dx in range(3)])
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN windows give NaN, handled below
            neighbours = np.nanmedian(windows, axis=0)
        shown[holes] = neighbours[holes]
    shown = shown - background
    shown[~np.isfinite(shown)] = 0.0
    return shown


def noise_sigma(image: np.ndarray) -> float:
    """Robust pixel noise: 1.4826 times the median absolute deviation."""
    finite = image[np.isfinite(image)]
    if finite.size < 4:
        return 0.0
    return float(1.4826 * np.median(np.abs(finite - np.median(finite))))


def common_stretch(images: list[np.ndarray]) -> dict[str, float]:
    """One asinh stretch for all frames of a request, in the style of mock mode:
    `soft` is twice the typical noise, black is three noise levels below the background,
    white is the 99.9th percentile of all frames, and differences saturate at a quarter
    of that (the same ratio as mock mode)."""
    noises = [noise_sigma(i) for i in images]
    noises = [s for s in noises if s > 0]
    noise = float(np.median(noises)) if noises else 1.0
    values = [i[np.isfinite(i)] for i in images]
    values = [v for v in values if v.size]
    peak = float(np.percentile(np.concatenate(values), 99.9)) if values else 0.0
    high = max(peak, 20.0 * noise)
    return {"soft": 2.0 * noise, "low": -3.0 * noise, "high": high, "diff_high": high / 4.0}


def render(image: np.ndarray, stretch: dict[str, float], reference: np.ndarray | None = None) -> bytes:
    """PNG of a background-subtracted patch (or of patch minus reference) with a given
    stretch. Pixels with no value show as background (or as "no change" in a difference)."""
    soft = stretch["soft"]
    if reference is None:
        low = math.asinh(stretch["low"] / soft)
        high = math.asinh(stretch["high"] / soft)
        scaled = (np.arcsinh(np.nan_to_num(image, nan=0.0) / soft) - low) / (high - low)
    else:
        difference = np.nan_to_num(image - reference, nan=0.0)
        scaled = 0.5 + 0.5 * np.arcsinh(difference / soft) / math.asinh(stretch["diff_high"] / soft)
    return encode_grey(scaled)


# --- the two endpoints ----------------------------------------------------------------


def matching_exposures(
    settings: Settings,
    ra: float,
    dec: float,
    wl_min: float | None,
    wl_max: float | None,
    pmra: float,
    pmdec: float,
    epoch: float,
) -> tuple[list[tuple[LiveExposure, float]], list[str], int, bool]:
    """Steps 1 to 3: every exposure whose wavelength at the (moving) target is in range,
    oldest first, with that wavelength.

    Returns (matching, notes, failed, probes_capped): `failed` counts exposures that could
    not be read; `probes_capped` says some candidates were not checked (`max_probes`).
    """
    notes: list[str] = []
    search_ra, search_dec = ra, dec
    if pmra or pmdec:
        search_ra, search_dec = propagate(ra, dec, pmra, pmdec, epoch, settings.search_epoch_year)
    found, search_warnings = search(settings, search_ra, search_dec, settings.search_radius_deg)
    notes.extend(search_warnings)

    candidates = [e for e in found if _overlaps(e, wl_min, wl_max) and e.cloud_url]
    no_address = sum(1 for e in found if _overlaps(e, wl_min, wl_max) and not e.cloud_url)
    probed = sample_evenly(candidates, settings.max_probes)
    if len(probed) < len(candidates):
        notes.append(
            f"Checked the wavelength of {len(probed)} of {len(candidates)} candidate exposures, "
            "spread evenly over time."
        )

    def where(e: LiveExposure) -> tuple[float, float]:
        return position_at_mjd(ra, dec, pmra, pmdec, epoch, e.mjd)

    def check(e: LiveExposure) -> float | None:
        t_ra, t_dec = where(e)
        return wavelength_at_target(settings, e, t_ra, t_dec)

    failed = no_address
    matching: list[tuple[LiveExposure, float]] = []
    with ThreadPoolExecutor(max_workers=max(1, settings.s3_concurrency)) as pool:
        results = list(zip(probed, pool.map(_safe(check), probed), strict=True))
    for e, (ok, wavelength) in results:
        if not ok:
            failed += 1
        elif wavelength is not None and _in_range(wavelength, wl_min, wl_max):
            matching.append((e, wavelength))
    matching.sort(key=lambda item: item[0].mjd)
    return matching, notes, failed, len(probed) < len(candidates)


def frame_list(
    settings: Settings,
    ra: float,
    dec: float,
    size: float,
    wl_min: float | None,
    wl_max: float | None,
    pmra: float,
    pmdec: float,
    epoch: float,
    track: bool,
    max_items: int | None,
) -> m.FrameList:
    cap = min(max_items, settings.max_frames) if max_items is not None else settings.max_frames
    n = patch_pixels(size)
    matching, notes, failed, probes_capped = matching_exposures(
        settings, ra, dec, wl_min, wl_max, pmra, pmdec, epoch
    )

    def where(e: LiveExposure) -> tuple[float, float]:
        return position_at_mjd(ra, dec, pmra, pmdec, epoch, e.mjd)

    picked = sample_evenly(matching, cap)
    positions = [where(e) for e, _ in picked]
    fixed_centre = positions[len(positions) // 2] if positions else (ra, dec)
    centres = [
        (float(_centre_text(c[0])), float(_centre_text(c[1])))
        for c in (positions if track else [fixed_centre] * len(positions))
    ]

    def load(i: int) -> Patch | None:
        return get_patch(settings, picked[i][0], centres[i][0], centres[i][1], n)

    with ThreadPoolExecutor(max_workers=max(1, settings.s3_concurrency)) as pool:
        loaded = list(pool.map(_safe(load), range(len(picked))))

    items: list[m.Frame] = []
    images: list[np.ndarray] = []
    keys: list[str] = []
    for i, (ok, patch) in enumerate(loaded):
        if not ok or patch is None:
            failed += 1
            continue
        e, wavelength = picked[i]
        c_ra, c_dec = centres[i]
        t_ra, t_dec = positions[i]
        query = urlencode(
            {
                "exposure_id": e.exposure_id,
                "ra": _centre_text(c_ra),
                "dec": _centre_text(c_dec),
                "size": f"{size:g}",
            }
        )
        items.append(
            m.Frame(
                exposure_id=e.exposure_id,
                collection=e.collection,
                detector=e.detector,
                mjd=e.mjd,
                wavelength_um=round(wavelength, 4),
                image_url=f"/api/frame.png?{query}",
                center_ra=c_ra,
                center_dec=c_dec,
                target_ra=t_ra,
                target_dec=t_dec,
            )
        )
        images.append(background_subtracted(patch.image))
        keys.append(_patch_key(e.exposure_id, c_ra, c_dec, n))

    if images:
        stretch = common_stretch(images)
        cache = _cache(settings)
        for key in keys:
            cache.put_json("stretch", key, stretch)
    if failed:
        notes.append(f"{failed} exposure(s) could not be read and were skipped.")

    return m.FrameList(
        mode="live",
        total=len(matching),
        returned=len(items),
        capped=len(picked) < len(matching) or probes_capped,
        warnings=notes,
        ra=ra,
        dec=dec,
        size=size,
        pixel_scale=PIXEL_SCALE_ARCSEC,
        track=track,
        frames=items,
    )


def frame_png(
    settings: Settings, exposure_id: str, ra_c: float, dec_c: float, size: float, diff_ref: str | None
) -> bytes | None:
    """PNG of one frame (or of a difference); None if the position is off the detector.

    Raises UnknownExposure for ids the server has never seen in a search.
    """
    n = patch_pixels(size)
    ra_c, dec_c = float(_centre_text(ra_c)), float(_centre_text(dec_c))
    exposure = find_exposure(settings, exposure_id)
    reference_exposure = find_exposure(settings, diff_ref) if diff_ref else None

    patch = get_patch(settings, exposure, ra_c, dec_c, n)
    if patch is None:
        return None
    image = background_subtracted(patch.image)
    stretch = _cache(settings).get_json("stretch", _patch_key(exposure_id, ra_c, dec_c, n))
    if stretch is None:
        stretch = common_stretch([image])  # not part of a frame list: scale it on its own

    if reference_exposure is None:
        return render(fill_for_display(patch), stretch)
    reference = get_patch(settings, reference_exposure, ra_c, dec_c, n)
    if reference is None:
        return None
    return render(image, stretch, background_subtracted(reference.image))


def _safe(function):
    """Wrap a function so that pool.map returns (ok, value) instead of raising."""

    def wrapped(argument):
        try:
            return True, function(argument)
        except ImportError:
            raise  # the `live` extra is missing: that is the server's problem, not the file's
        except Exception:  # noqa: BLE001 - one unreadable exposure must not sink the request
            return False, None

    return wrapped
