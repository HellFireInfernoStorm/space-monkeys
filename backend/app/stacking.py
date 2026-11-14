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
# Position fit: a 2-D Gaussian on a FIT_BOX by FIT_BOX window. Its width (sigma, pixels) is
# fitted within FIT_SIGMA_BOUNDS. 7.5 arcsec FWHM is 0.52 pixel; each bilinear resampling
# widens a star by about 1/6 pixel^2 in variance, and a stack image has been resampled twice.
FIT_BOX = 5
DEFAULT_FIT_SIGMA_PX = 0.8
FIT_SIGMA_BOUNDS = (0.45, 1.6)
# Position uncertainty: re-stack each visit from its exposures drawn with replacement.
BOOTSTRAP_DRAWS = 200
BOOTSTRAP_SEED = 20261114


@dataclass
class StackInput:
    exposure_id: str
    mjd: float
    wavelength_um: float
    image: np.ndarray  # (n, n), background not yet removed, NaN where masked
    # Where the image is centred: the object's position from proper motion alone, east and
    # north of the reference position (arcsec). This is geometry: the patch was read here.
    east_arcsec: float
    north_arcsec: float
    # The same pixels without the bad-pixel mask, only to fill holes in the picture
    # (the cores of bright stars are flagged; see live_frames.fill_for_display).
    raw: np.ndarray | None = None
    # Parallax shift at this exposure's date (arcsec east, north). Part of the predicted
    # position, not of the image centre (under a tenth of a pixel for every target).
    parallax_east: float = 0.0
    parallax_north: float = 0.0
    # Fixed catalogue neighbour in this object's grid, only when explicitly known.
    neighbour: tuple[float, float] | None = None


@dataclass
class Measured:
    """Position of the object in one visit, from a Gaussian fit (arcsec from the reference)."""

    east: float
    north: float
    err_east: float  # 1-sigma; from the bootstrap over exposures, else from the fit
    err_north: float
    method: str  # "bootstrap" or "fit"
    fit_err_east: float
    fit_err_north: float
    draws: int  # bootstrap draws that gave a fit
    sigma_px: float


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
    measured: Measured | None = None
    # True when pixels at the target are empty because they are flagged in most exposures
    # (the saturated core of a bright star): then there is no S/N.
    saturated: bool = False
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
    stack, count, _weight = combine_weighted(images, sigmas, min_count, clip)
    return stack, count


def combine_weighted(
    images: list[np.ndarray], sigmas: list[float], min_count: int | None = None, clip: float = CLIP_SIGMA
):
    """As `combine`, and also the summed weight per pixel: one over it is the formal
    variance of the stacked value (0 where the pixel is empty)."""
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
    empty = (count < needed) | (total_weight <= 0)
    stack[empty] = np.nan
    return stack, count, np.where(empty, 0.0, total_weight)


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
    """Median and robust noise in a fixed local annulus, independent of field size."""
    n_y, n_x = image.shape
    yy, xx = np.mgrid[0:n_y, 0:n_x] + 0.5
    radius = np.hypot(xx - x, yy - y)
    far = (radius > exclude_px) & (radius <= 8.0)
    values = image[far & np.isfinite(image)]
    if values.size < 10:
        return None
    level = float(np.median(values))
    return level, float(1.4826 * np.median(np.abs(values - level)))


def snr_at(image: np.ndarray, x: float, y: float) -> float | None:
    """Fixed PSF amplitude divided by its scatter in local empty apertures.

    Fit a fixed Gaussian plus a constant sky in identical 5x5 apertures, including
    pixel phase, at the target and integer offsets 4--7 pixels away. The local
    control-aperture scatter includes correlated noise and unresolved field sources.
    The footprint and noise sample do not grow with the requested field size.
    """

    def flux(cx, cy):
        ix, iy = int(math.floor(cx)), int(math.floor(cy))
        if ix < 2 or iy < 2 or ix + 2 >= image.shape[1] or iy + 2 >= image.shape[0]:
            return None
        patch = image[iy - 2 : iy + 3, ix - 2 : ix + 3]
        if not np.isfinite(patch).all():
            return None
        yy, xx = np.mgrid[iy - 2 : iy + 3, ix - 2 : ix + 3] + 0.5
        psf = np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * DEFAULT_FIT_SIGMA_PX**2))
        # Project out the constant sky term before solving for the PSF amplitude.
        psf -= np.mean(psf)
        return float(np.sum(patch * psf) / np.sum(psf**2))

    signal = flux(x, y)
    if signal is None:
        return None
    empty = []
    for dy in range(-7, 8):
        for dx in range(-7, 8):
            if 4 <= math.hypot(dx, dy) <= 7:
                value = flux(x + dx, y + dy)
                if value is not None:
                    empty.append(value)
    if len(empty) < 20:
        return None
    level = float(np.median(empty))
    scatter = float(np.std(empty, ddof=1))
    return (signal - level) / scatter if scatter > 0 else None


def core_flagged(image: np.ndarray, x: float, y: float) -> bool:
    """True when part of the 3 by 3 box at (x, y) is empty: pixels flagged in most
    exposures, which at a source means the saturated core of a bright star."""
    box = _box(image, x, y)
    if box is None:
        return False
    y0, y1, x0, x1 = box
    return bool((~np.isfinite(image[y0:y1, x0:x1])).any())


@dataclass
class Fit:
    """A 2-D Gaussian fitted to a source. Pixel coordinates as elsewhere in this module."""

    x: float
    y: float
    amplitude: float
    sigma_px: float
    err_x: float  # 1-sigma, pixels, from the fit covariance (scaled by the reduced chi-square if above 1)
    err_y: float
    chi2_red: float
    n_pixels: int


def peak_pixel(image: np.ndarray, x: float, y: float) -> tuple[int, int] | None:
    """(column, row) of the brightest usable pixel in the 3 by 3 box at (x, y)."""
    box = _box(image, x, y)
    if box is None:
        return None
    y0, y1, x0, x1 = box
    patch = image[y0:y1, x0:x1]
    if not np.isfinite(patch).any():
        return None
    py, px = np.unravel_index(np.nanargmax(patch), patch.shape)
    return x0 + int(px), y0 + int(py)


def fit_gaussian(
    image: np.ndarray,
    weight: np.ndarray | None,
    start: tuple[int, int],
    level: float,
    sigma_px: float = DEFAULT_FIT_SIGMA_PX,
    fit_sigma: bool = False,
    box: int = FIT_BOX,
    sigma_bounds: tuple[float, float] = FIT_SIGMA_BOUNDS,
    neighbour: tuple[float, float] | None = None,
) -> Fit | None:
    """Weighted least-squares fit of `A * exp(-r^2 / (2 s^2)) + level` on a `box` by `box`
    pixel window centred on pixel `start` (column, row).

    `level` (the background) is fixed. The width `s` is fixed at `sigma_px` unless
    `fit_sigma`, then it is fitted within `sigma_bounds`. `weight` is one over each pixel's
    variance (None: equal weights). Empty (NaN) pixels are left out, so a flagged core is
    fitted from its wings. When `neighbour` is given its centre is fixed, with a free
    nonnegative amplitude and the same fitted width as the target. The catalogue
    position is never pulled toward the target. Levenberg-Marquardt, pure NumPy.
    Returns None when the fit
    fails, the amplitude is not positive, or the centre leaves the window.
    """
    n_y, n_x = image.shape
    half = box // 2
    cx, cy = start
    y0, y1 = max(0, cy - half), min(n_y, cy + half + 1)
    x0, x1 = max(0, cx - half), min(n_x, cx + half + 1)
    data = image[y0:y1, x0:x1].astype(np.float64)
    if weight is None:
        w = np.ones_like(data)
    else:
        w = np.asarray(weight[y0:y1, x0:x1], dtype=np.float64).copy()
    use = np.isfinite(data) & np.isfinite(w) & (w > 0)
    free = [0, 1, 2] + ([3] if fit_sigma else []) + ([4] if neighbour is not None else [])
    n_params = len(free)
    if use.sum() < n_params + 3:
        return None
    yy, xx = np.mgrid[y0:y1, x0:x1] + 0.5
    xs, ys, d, w = xx[use], yy[use], data[use] - level, w[use]
    # Start: the window's highest value, at the start pixel's centre.
    params = np.array([max(float(d.max()), 1e-6), cx + 0.5, cy + 0.5, sigma_px, 0.0])
    lo_s, hi_s = sigma_bounds

    def model(p):
        r2 = (xs - p[1]) ** 2 + (ys - p[2]) ** 2
        g = np.exp(-r2 / (2.0 * p[3] ** 2))
        result = p[0] * g
        if neighbour is not None:
            nr2 = (xs - neighbour[0]) ** 2 + (ys - neighbour[1]) ** 2
            result = result + p[4] * np.exp(-nr2 / (2 * p[3] ** 2))
        return result, g, r2

    def derivatives(p, g, r2):
        columns = [g, p[0] * g * (xs - p[1]) / p[3] ** 2, p[0] * g * (ys - p[2]) / p[3] ** 2]
        width = p[0] * g * r2 / p[3] ** 3
        if neighbour is not None:
            nr2 = (xs - neighbour[0]) ** 2 + (ys - neighbour[1]) ** 2
            ng = np.exp(-nr2 / (2 * p[3] ** 2))
            width = width + p[4] * ng * nr2 / p[3] ** 3
        if fit_sigma:
            columns.append(width)
        if neighbour is not None:
            columns.append(ng)
        return np.stack(columns, axis=1)

    def chi2(p):
        m, _, _ = model(p)
        return float(np.sum(w * (d - m) ** 2))

    damping = 1e-3
    current = chi2(params)
    for _ in range(100):
        m, g, r2 = model(params)
        jac = derivatives(params, g, r2)
        hess = jac.T @ (w[:, None] * jac)
        grad = jac.T @ (w * (d - m))
        try:
            step = np.linalg.solve(hess + damping * np.diag(np.diag(hess)), grad)
        except np.linalg.LinAlgError:
            return None
        trial = params.copy()
        trial[free] += step
        trial[4] = max(0.0, trial[4])
        trial[3] = min(max(trial[3], lo_s), hi_s)
        value = chi2(trial)
        if value < current:
            converged = current - value < 1e-10 * max(current, 1.0)
            params, current, damping = trial, value, max(damping / 10.0, 1e-9)
            if converged:
                break
        else:
            damping *= 10.0
            if damping > 1e9:
                break
    if params[0] <= 0 or abs(params[1] - (cx + 0.5)) > half or abs(params[2] - (cy + 0.5)) > half:
        return None
    m, g, r2 = model(params)
    jac = derivatives(params, g, r2)
    dof = max(1, d.size - n_params)
    chi2_red = current / dof
    try:
        cov = np.linalg.inv(jac.T @ (w[:, None] * jac)) * max(1.0, chi2_red)
    except np.linalg.LinAlgError:
        return None
    return Fit(
        x=float(params[1]),
        y=float(params[2]),
        amplitude=float(params[0]),
        sigma_px=float(params[3]),
        err_x=float(math.sqrt(max(cov[1, 1], 0.0))),
        err_y=float(math.sqrt(max(cov[2, 2], 0.0))),
        chi2_red=float(chi2_red),
        n_pixels=int(d.size),
    )


def measure_visit(
    images: list[np.ndarray],
    sigmas: list[float],
    east: list[float],
    north: list[float],
    n: int,
    scale_arcsec: float,
    draws: int = BOOTSTRAP_DRAWS,
    seed: int = BOOTSTRAP_SEED,
    neighbours: list[tuple[float, float]] | None = None,
) -> tuple[Measured | None, float | None, bool]:
    """Where the object is in one visit. Returns (measured, snr, core flagged).

    The images are object-centred (each was read centred on the predicted position from
    proper motion, `east`, `north`), so they are stacked as they are: one resampling only.
    Stacks shifted onto a fixed grid have been resampled twice, and a second bilinear
    shift with a sub-pixel phase that differs from visit to visit moves a fitted peak by
    up to 0.05 pixel (0.3 arcsec) in a simulation of this pipeline. In object-centred
    stacks the object sits at the same pixel phase in every visit, so that cancels.

    The object's offset from the grid centre comes from a Gaussian fit (`fit_gaussian`,
    width fitted within bounds, weighted by the stack's formal variance). Its uncertainty
    comes from a bootstrap: the visit's exposures are drawn with replacement, re-stacked
    and re-fitted `draws` times, and the spread of the fitted centres is the error. That
    includes noise that the fit does not know about (pixels correlated by resampling,
    exposure-to-exposure position errors). Measured only at S/N of at least
    MIN_MEASURE_SNR. Flagged cores have no motion measurement: a symmetric Gaussian
    fitted to their wings can have a small statistical error and a large systematic bias.
    """
    centre = n / 2.0
    stack, _count, weight = combine_weighted(images, sigmas)
    snr = snr_at(stack, centre, centre)
    flagged = snr is None and core_flagged(stack, centre, centre)
    if flagged:
        return None, snr, True
    stats = background_stats(stack, centre, centre)
    if stats is None or (not flagged and (snr is None or snr < MIN_MEASURE_SNR)):
        return None, snr, flagged
    level = stats[0]
    start = peak_pixel(stack, centre, centre)
    options = {"fit_sigma": True}
    if neighbours is not None:
        options["neighbour"] = tuple(np.mean(neighbours, axis=0))
    if start is None:
        return None, snr, flagged
    fit = fit_gaussian(stack, weight, start, level, **options)
    if fit is None:
        return None, snr, flagged

    rng = np.random.default_rng(seed)
    xs, ys = [], []
    count = len(images)
    for _ in range(draws):
        pick = rng.integers(0, count, count)
        drawn, _c, drawn_weight = combine_weighted([images[i] for i in pick], [sigmas[i] for i in pick])
        drawn_level = background_stats(drawn, centre, centre)
        if drawn_level is None:
            continue
        drawn_options = dict(options)
        if neighbours is not None:
            drawn_options["neighbour"] = tuple(np.mean([neighbours[i] for i in pick], axis=0))
        again = fit_gaussian(drawn, drawn_weight, start, drawn_level[0], **drawn_options)
        if again is not None:
            xs.append(again.x)
            ys.append(again.y)
    if len(xs) >= 20:
        err_x, err_y, method = float(np.std(xs, ddof=1)), float(np.std(ys, ddof=1)), "bootstrap"
    else:
        err_x, err_y, method = fit.err_x, fit.err_y, "fit"
    measured = Measured(
        east=float(np.mean(east)) + (centre - fit.x) * scale_arcsec,
        north=float(np.mean(north)) + (centre - fit.y) * scale_arcsec,
        err_east=err_x * scale_arcsec,
        err_north=err_y * scale_arcsec,
        method=method,
        fit_err_east=fit.err_x * scale_arcsec,
        fit_err_north=fit.err_y * scale_arcsec,
        draws=len(xs),
        sigma_px=fit.sigma_px,
    )
    return measured, snr, flagged


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
    local_sigmas = []
    for i in inputs:
        stats = background_stats(i.image, centre, centre)
        levels.append(stats[0] if stats is not None else 0.0)
        local_sigmas.append(stats[1] if stats is not None else 0.0)
    own = [i.image.astype(np.float64) - lv for i, lv in zip(inputs, levels, strict=True)]
    own_raw = [
        (i.raw if i.raw is not None else i.image).astype(np.float64) - lv
        for i, lv in zip(inputs, levels, strict=True)
    ]
    sigmas = local_sigmas
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
    tracked.saturated = tracked.snr is None and core_flagged(tracked_image, centre, centre)
    single.saturated = single.snr is None and core_flagged(own[pick], centre, centre)

    if has_motion:

        def to_fixed(image: np.ndarray, item: StackInput) -> np.ndarray:
            return shift(image, item.east_arcsec / scale_arcsec, item.north_arcsec / scale_arcsec)

        fixed = [to_fixed(im, i) for im, i in zip(own, inputs, strict=True)]
        fixed_raw = [to_fixed(im, i) for im, i in zip(own_raw, inputs, strict=True)]
        fixed_sigmas = [
            stats[1] if (stats := background_stats(i, centre, centre)) is not None else 0.0
            for i in fixed
        ]
    else:
        fixed, fixed_raw, fixed_sigmas = own, own_raw, sigmas

    def static_stack(kind: str, index: int, members: list[int]) -> Stack:
        image, _ = combine([fixed[k] for k in members], [fixed_sigmas[k] for k in members])
        # Predicted position: proper motion (the image centres) plus parallax.
        plx_east = float(np.mean([inputs[k].parallax_east for k in members]))
        plx_north = float(np.mean([inputs[k].parallax_north for k in members]))
        east = float(np.mean([inputs[k].east_arcsec for k in members])) + plx_east
        north = float(np.mean([inputs[k].north_arcsec for k in members])) + plx_north
        x, y = static_position(east, north, n, scale_arcsec)
        display = _filled(image, _median_fill([fixed_raw[k] for k in members]))
        snr = snr_at(image, x, y)
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
            saturated=snr is None and core_flagged(image, x, y),
            extra={"east": east, "north": north, "parallax_east": plx_east, "parallax_north": plx_north},
        )

    def epoch_stack(index: int, members: list[int]) -> Stack:
        """The picture is on the fixed grid (for the blink); the position is measured in the
        object-centred stack of the same exposures (`measure_visit`)."""
        stack = static_stack("epoch", index, members)
        measured, snr, flagged = measure_visit(
            [own[k] for k in members],
            [sigmas[k] for k in members],
            [inputs[k].east_arcsec for k in members],
            [inputs[k].north_arcsec for k in members],
            n,
            scale_arcsec,
            seed=BOOTSTRAP_SEED + index,
            neighbours=[inputs[k].neighbour for k in members]
            if all(inputs[k].neighbour is not None for k in members)
            else None,
        )
        stack.measured = measured
        stack.extra["measure_snr"] = snr
        stack.saturated = stack.saturated or flagged
        return stack

    static = static_stack("static", 0, every) if has_motion else None
    epochs = [epoch_stack(i, g) for i, g in enumerate(group_epochs(mjds))]
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
