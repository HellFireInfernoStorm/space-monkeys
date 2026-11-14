"""Layer 2: adding many exposures together ("stacking"). Pure NumPy, no network.

Every input is one exposure already resampled onto the common grid (north up, east
left) and centred on where the object is predicted to be at that exposure's time. Bad
pixels are NaN. From these the module builds, on grids of the same size:

- `tracked`: the inputs as they are, combined. The object stays in the same pixel, so
  its light adds up while the noise averages down.
- `static`: every input shifted back onto one fixed sky grid (centred on the reference
  position), combined. Stars stay sharp; a moving object is smeared along its path.
- `epoch` stacks: the inputs grouped by visit (a gap of more than `EPOCH_GAP_DAYS`
  starts a new group), one static-grid stack per group. Blinking them shows the object
  stepping while the stars stay put.

Combining (`combine`): each exposure's noise is 1.4826 times the median absolute
deviation of its usable pixels; exposures are weighted by one over that noise squared;
at every pixel, values more than `CLIP_SIGMA` noise levels from the median across
exposures are left out (cosmic rays, satellite trails, flagged pixels that slipped
through); masked pixels never count; a pixel with fewer than `min_count` usable values
is left empty (NaN).

Pixel coordinates in this module run from the top-left (north-east) corner of a grid
of `n` pixels: pixel `i` covers `i` to `i + 1`, so the grid centre is `n / 2`, as in
`resample.grid_offsets`.
"""

import math
import warnings
from dataclasses import dataclass, field

import numpy as np

from .resample import bilinear

CLIP_SIGMA = 4.0
EPOCH_GAP_DAYS = 30.0
MIN_EPOCH_EXPOSURES = 5
# Star images are about 7.5 arcseconds wide (full width at half maximum, docs/SCIENCE.md).
FWHM_ARCSEC = 7.5
# Below this signal-to-noise ratio an epoch's position is not measured (null, not a bad number).
MIN_MEASURE_SNR = 5.0
# Pixels closer than this to the object are left out of the stack's noise estimate.
NOISE_EXCLUDE_PX = 3.0


@dataclass
class StackInput:
    exposure_id: str
    mjd: float
    wavelength_um: float
    image: np.ndarray  # (n, n), background not yet removed, NaN where masked
    east_arcsec: float  # predicted object position, east of the reference position
    north_arcsec: float  # predicted object position, north of the reference position
    # The same pixels without the bad-pixel mask, only to fill holes in the picture
    # (the cores of bright stars are flagged; see live_frames.fill_for_display).
    raw: np.ndarray | None = None


@dataclass
class Stack:
    kind: str  # "single", "tracked", "static", "epoch"
    index: int
    image: np.ndarray  # the measured stack: masked pixels never count, empty pixels are NaN
    display: np.ndarray  # for the picture only: empty pixels filled from unmasked values
    members: list[int]  # indices into the inputs
    target_x: float  # predicted object position, pixels from the left edge
    target_y: float  # pixels from the top edge
    snr: float | None
    mjd_mid: float
    # East, north (arcsec from the reference) and error (None when not estimable).
    measured: tuple[float, float, float | None] | None = None
    extra: dict = field(default_factory=dict)


# --- per-exposure helpers ----------------------------------------------------------------


def robust_sigma(image: np.ndarray) -> float:
    """1.4826 times the median absolute deviation of the usable pixels (0 if too few)."""
    finite = image[np.isfinite(image)]
    if finite.size < 4:
        return 0.0
    return float(1.4826 * np.median(np.abs(finite - np.median(finite))))


def subtract_background(image: np.ndarray) -> np.ndarray:
    finite = image[np.isfinite(image)]
    if finite.size == 0:
        return image.astype(np.float64)
    return image.astype(np.float64) - float(np.median(finite))


def shift(image: np.ndarray, dx_px: float, dy_px: float) -> np.ndarray:
    """Resample `image` so that output pixel (row k, column j) takes the value at input
    position (column j + dx_px, row k + dy_px). Bilinear; NaN pixels are left out."""
    n_y, n_x = image.shape
    if dx_px == 0.0 and dy_px == 0.0:
        return image.astype(np.float64)
    ys, xs = np.mgrid[0:n_y, 0:n_x].astype(float)
    return bilinear(image, xs + dx_px, ys + dy_px)


def onto_static_grid(item: StackInput, scale_arcsec: float) -> np.ndarray:
    """An input (centred on the object) moved onto the fixed grid centred on the reference.

    A fixed-grid pixel at offset p from the reference lies at offset p - d from the
    object, where d is the object's offset; in the input grid that is d / scale pixels
    further east (left) and north (up), hence sampling at +d / scale.
    """
    return shift(item.image, item.east_arcsec / scale_arcsec, item.north_arcsec / scale_arcsec)


def static_position(
    east_arcsec: float, north_arcsec: float, n: int, scale_arcsec: float
) -> tuple[float, float]:
    """Pixel position on the fixed grid of a point at an offset from the reference."""
    return n / 2.0 - east_arcsec / scale_arcsec, n / 2.0 - north_arcsec / scale_arcsec


def group_epochs(mjds: list[float], gap_days: float = EPOCH_GAP_DAYS, min_size: int = MIN_EPOCH_EXPOSURES):
    """Indices of `mjds` grouped into visits: sorted by time, a gap longer than `gap_days`
    starts a new group, and groups with fewer than `min_size` members are dropped."""
    order = sorted(range(len(mjds)), key=lambda i: mjds[i])
    groups: list[list[int]] = []
    for i in order:
        if groups and mjds[i] - mjds[groups[-1][-1]] <= gap_days:
            groups[-1].append(i)
        else:
            groups.append([i])
    return [g for g in groups if len(g) >= min_size]


# --- combining -----------------------------------------------------------------------------


def default_min_count(n_inputs: int) -> int:
    return 1 if n_inputs < 2 else max(2, int(0.25 * n_inputs))


def combine(
    images: list[np.ndarray], sigmas: list[float], min_count: int | None = None, clip: float = CLIP_SIGMA
):
    """Inverse-variance weighted mean with per-pixel sigma clipping about the median.

    Returns (stack, count): count is how many exposures contributed to each pixel.
    The clipping threshold at a pixel is `clip` times the larger of the exposure's own
    noise and the spread across exposures at that pixel (so a star whose brightness
    differs between exposures, because each sees it at a different wavelength, is kept).
    """
    if not images:
        raise ValueError("nothing to combine")
    cube = np.stack([np.asarray(i, dtype=np.float64) for i in images])
    sig = np.asarray(sigmas, dtype=np.float64)
    usable = np.isfinite(cube) & (sig[:, None, None] > 0)
    values = np.where(usable, cube, np.nan)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN pixels, handled by the count
        median = np.nanmedian(values, axis=0)
        spread = 1.4826 * np.nanmedian(np.abs(values - median), axis=0)
    spread = np.nan_to_num(spread, nan=0.0)
    limit = clip * np.maximum(sig[:, None, None], spread[None])
    keep = usable & (np.abs(np.nan_to_num(values - median, nan=np.inf)) <= limit)
    weights = np.where(keep, 1.0 / np.where(sig > 0, sig, 1.0)[:, None, None] ** 2, 0.0)
    total_weight = weights.sum(axis=0)
    count = keep.sum(axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
        stack = (weights * np.nan_to_num(values, nan=0.0)).sum(axis=0) / total_weight
    needed = default_min_count(len(images)) if min_count is None else min_count
    stack[(count < needed) | (total_weight <= 0)] = np.nan
    return stack, count


# --- measuring -----------------------------------------------------------------------------


def _box(image: np.ndarray, x: float, y: float, half: int = 1):
    n_y, n_x = image.shape
    ix, iy = int(math.floor(x)), int(math.floor(y))
    y0, y1 = max(0, iy - half), min(n_y, iy + half + 1)
    x0, x1 = max(0, ix - half), min(n_x, ix + half + 1)
    if y0 >= y1 or x0 >= x1:
        return None
    return y0, y1, x0, x1


def background_stats(image: np.ndarray, x: float, y: float, exclude_px: float = NOISE_EXCLUDE_PX):
    """(median, robust noise) of the pixels farther than `exclude_px` from (x, y)."""
    n_y, n_x = image.shape
    yy, xx = np.mgrid[0:n_y, 0:n_x] + 0.5
    far = np.hypot(xx - x, yy - y) > exclude_px
    values = image[far & np.isfinite(image)]
    if values.size < 10:
        return None
    level = float(np.median(values))
    return level, float(1.4826 * np.median(np.abs(values - level)))


def snr_at(image: np.ndarray, x: float, y: float) -> float | None:
    """Peak of the 3 by 3 pixel box at (x, y), above the background, divided by the
    stack's robust noise away from that position. Note: the peak of nine pixels is
    biased upward, so an empty position typically reads about 1 to 2, not 0."""
    box = _box(image, x, y)
    stats = background_stats(image, x, y)
    if box is None or stats is None or stats[1] <= 0:
        return None
    y0, y1, x0, x1 = box
    patch = image[y0:y1, x0:x1]
    if not np.isfinite(patch).any():
        return None
    level, noise = stats
    return float((np.nanmax(patch) - level) / noise)


def centroid(image: np.ndarray, x: float, y: float, scale_arcsec: float):
    """Flux-weighted centroid near (x, y): find the brightest pixel within one pixel of
    (x, y), then weight the 3 by 3 box around it by its positive values.

    Returns (x, y, error_arcsec) in pixel coordinates, or None if the source is too
    faint (signal-to-noise below MIN_MEASURE_SNR). The error is the rule of thumb
    FWHM / (signal-to-noise)."""
    snr = snr_at(image, x, y)
    stats = background_stats(image, x, y)
    if snr is None or stats is None or snr < MIN_MEASURE_SNR:
        return None
    level = stats[0]
    search = _box(image, x, y)
    y0, y1, x0, x1 = search
    patch = image[y0:y1, x0:x1]
    py, px = np.unravel_index(np.nanargmax(patch), patch.shape)
    cy, cx = y0 + int(py), x0 + int(px)
    box = _box(image, cx + 0.5, cy + 0.5)
    by0, by1, bx0, bx1 = box
    values = np.nan_to_num(image[by0:by1, bx0:bx1] - level, nan=0.0)
    values = np.clip(values, 0.0, None)
    total = values.sum()
    if total <= 0:
        return None
    yy, xx = np.mgrid[by0:by1, bx0:bx1] + 0.5
    return float((values * xx).sum() / total), float((values * yy).sum() / total), FWHM_ARCSEC / snr


# --- the whole set --------------------------------------------------------------------------


def _median_fill(images: list[np.ndarray]) -> np.ndarray:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN pixels stay NaN
        return np.nanmedian(np.stack(images), axis=0)


def _filled(image: np.ndarray, fill: np.ndarray) -> np.ndarray:
    return np.where(np.isfinite(image), image, fill)


def build(inputs: list[StackInput], n: int, scale_arcsec: float, has_motion: bool) -> dict:
    """All stacks for one request. Returns a dict with:

    `single` (one typical exposure), `tracked`, `static` (None without motion), `epochs`
    (list), and `sigmas` (per input).

    The single exposure shown is the one whose signal-to-noise ratio at the predicted
    position is the median of all exposures: a typical exposure, not a lucky one."""
    if not inputs:
        return {"single": None, "tracked": None, "static": None, "epochs": [], "sigmas": []}
    centre = n / 2.0
    levels = []
    for i in inputs:
        finite = i.image[np.isfinite(i.image)]
        levels.append(float(np.median(finite)) if finite.size else 0.0)
    own = [i.image.astype(np.float64) - lv for i, lv in zip(inputs, levels, strict=True)]
    own_raw = [
        (i.raw if i.raw is not None else i.image).astype(np.float64) - lv
        for i, lv in zip(inputs, levels, strict=True)
    ]
    sigmas = [robust_sigma(i) for i in own]
    mjds = [i.mjd for i in inputs]

    singles = [snr_at(im, centre, centre) if s > 0 else None for im, s in zip(own, sigmas, strict=True)]
    rated = sorted((v, k) for k, v in enumerate(singles) if v is not None)
    pick = rated[len(rated) // 2][1] if rated else 0
    single = Stack(
        kind="single",
        index=0,
        image=own[pick],
        display=_filled(own[pick], own_raw[pick]),
        members=[pick],
        target_x=centre,
        target_y=centre,
        snr=singles[pick],
        mjd_mid=inputs[pick].mjd,
        extra={"single_snrs": [v for v, _ in rated]},
    )

    every = list(range(len(inputs)))
    tracked_image, _ = combine(own, sigmas)
    tracked = Stack(
        kind="tracked",
        index=0,
        image=tracked_image,
        display=_filled(tracked_image, _median_fill(own_raw)),
        members=every,
        target_x=centre,
        target_y=centre,
        snr=snr_at(tracked_image, centre, centre),
        mjd_mid=float(np.mean(mjds)),
    )

    if has_motion:

        def to_fixed(image: np.ndarray, item: StackInput) -> np.ndarray:
            return shift(image, item.east_arcsec / scale_arcsec, item.north_arcsec / scale_arcsec)

        fixed = [to_fixed(im, i) for im, i in zip(own, inputs, strict=True)]
        fixed_raw = [to_fixed(im, i) for im, i in zip(own_raw, inputs, strict=True)]
        fixed_sigmas = [robust_sigma(i) for i in fixed]
    else:
        fixed, fixed_raw, fixed_sigmas = own, own_raw, sigmas

    def static_stack(kind: str, index: int, members: list[int]) -> Stack:
        image, _ = combine([fixed[k] for k in members], [fixed_sigmas[k] for k in members])
        east = float(np.mean([inputs[k].east_arcsec for k in members]))
        north = float(np.mean([inputs[k].north_arcsec for k in members]))
        x, y = static_position(east, north, n, scale_arcsec)
        display = _filled(image, _median_fill([fixed_raw[k] for k in members]))
        snr = snr_at(image, x, y)
        found = centroid(image, x, y, scale_arcsec)
        if found is None and snr is None:
            # The core is flagged in most exposures (a saturated bright star): its position
            # is still measurable from the unflagged values, though less precisely.
            found = centroid(display, x, y, scale_arcsec)
            if found is not None:
                found = (found[0], found[1], None)  # no honest error estimate for saturated pixels
        measured = None
        if found is not None:
            m_east = (centre - found[0]) * scale_arcsec
            m_north = (centre - found[1]) * scale_arcsec
            measured = (m_east, m_north, found[2])
        return Stack(
            kind=kind,
            index=index,
            image=image,
            display=display,
            members=members,
            target_x=x,
            target_y=y,
            snr=snr,
            mjd_mid=float(np.mean([mjds[k] for k in members])),
            measured=measured,
            extra={"east": east, "north": north},
        )

    static = static_stack("static", 0, every) if has_motion else None
    epochs = [static_stack("epoch", i, g) for i, g in enumerate(group_epochs(mjds))]
    return {"single": single, "tracked": tracked, "static": static, "epochs": epochs, "sigmas": sigmas}


def control_reversed(
    inputs: list[StackInput], n: int, scale_arcsec: float
) -> tuple[np.ndarray, float | None]:
    """A check that the tracked stack is not fooling us: follow the opposite motion.

    Each input is centred on the object; the reversed path puts the object at -d instead
    of +d, which in the input grid is 2d / scale pixels away. Returns the stack and its
    signal-to-noise ratio at the centre."""
    moved = [
        subtract_background(
            shift(i.image, 2 * i.east_arcsec / scale_arcsec, 2 * i.north_arcsec / scale_arcsec)
        )
        for i in inputs
    ]
    image, _ = combine(moved, [robust_sigma(i) for i in moved])
    return image, snr_at(image, n / 2.0, n / 2.0)


def empty_positions_snr(image: np.ndarray, radius_px: float = 5.0, count: int = 8) -> list[float]:
    """Signal-to-noise ratio, measured the same way, at `count` positions on a ring
    around the centre: what "nothing there" reads like in this stack."""
    n_y, n_x = image.shape
    out = []
    for k in range(count):
        angle = 2.0 * math.pi * k / count
        value = snr_at(
            image, n_x / 2.0 + radius_px * math.cos(angle), n_y / 2.0 + radius_px * math.sin(angle)
        )
        if value is not None:
            out.append(value)
    return out
