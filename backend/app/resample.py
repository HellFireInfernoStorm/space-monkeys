"""Pure NumPy geometry for live frames: the common output grid, resampling, and the
wavelength lookup table. No astronomy libraries and no network, so it is easy to test.

The output grid of every frame is the same: a tangent-plane (gnomonic) projection
centred on the frame centre, north up, east left, at the native pixel scale. Row 0 is
north and column 0 is east, exactly as in mock mode, so the front end treats both alike.
"""

import math

import numpy as np


def grid_offsets(n: int, scale_arcsec: float) -> tuple[np.ndarray, np.ndarray]:
    """Offsets east and north of the centre (arcseconds) of every output pixel centre.

    Shape (n, n). The centre position sits at x = y = n / 2, as in mock mode.
    """
    centres = np.arange(n) + 0.5
    east = (n / 2.0 - centres) * scale_arcsec
    north = (n / 2.0 - centres) * scale_arcsec
    return np.broadcast_to(east[None, :], (n, n)), np.broadcast_to(north[:, None], (n, n))


def tangent_to_sky(
    ra_c: float, dec_c: float, east_arcsec: np.ndarray, north_arcsec: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Inverse gnomonic projection: offsets on the tangent plane to RA and Dec (degrees)."""
    xi = np.radians(np.asarray(east_arcsec, dtype=float) / 3600.0)
    eta = np.radians(np.asarray(north_arcsec, dtype=float) / 3600.0)
    a0, d0 = math.radians(ra_c), math.radians(dec_c)
    denom = math.cos(d0) - eta * math.sin(d0)
    ra = a0 + np.arctan2(xi, denom)
    dec = np.arctan2(math.sin(d0) + eta * math.cos(d0), np.hypot(xi, denom))
    return np.degrees(ra) % 360.0, np.degrees(dec)


def sky_to_tangent(
    ra_c: float, dec_c: float, ra: np.ndarray, dec: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Gnomonic projection: RA and Dec (degrees) to offsets east and north (arcseconds)."""
    a = np.radians(np.asarray(ra, dtype=float))
    d = np.radians(np.asarray(dec, dtype=float))
    a0, d0 = math.radians(ra_c), math.radians(dec_c)
    cos_c = math.sin(d0) * np.sin(d) + math.cos(d0) * np.cos(d) * np.cos(a - a0)
    xi = np.cos(d) * np.sin(a - a0) / cos_c
    eta = (math.cos(d0) * np.sin(d) - math.sin(d0) * np.cos(d) * np.cos(a - a0)) / cos_c
    return np.degrees(xi) * 3600.0, np.degrees(eta) * 3600.0


def source_box(x: np.ndarray, y: np.ndarray, width: int, height: int, margin: int = 2):
    """The smallest block of a (height, width) image that covers pixel positions x, y.

    Returns (y0, y1, x0, x1) for slicing, or None if the positions miss the image.
    """
    ok = np.isfinite(x) & np.isfinite(y)
    if not ok.any():
        return None
    x0 = max(0, int(math.floor(float(x[ok].min()))) - margin)
    x1 = min(width, int(math.ceil(float(x[ok].max()))) + margin + 1)
    y0 = max(0, int(math.floor(float(y[ok].min()))) - margin)
    y1 = min(height, int(math.ceil(float(y[ok].max()))) + margin + 1)
    if x0 >= x1 or y0 >= y1:
        return None
    return y0, y1, x0, x1


def bilinear(image: np.ndarray, x: np.ndarray, y: np.ndarray, min_weight: float = 0.25) -> np.ndarray:
    """Sample `image` at fractional pixel positions (0-based, pixel centres at integers).

    Not-a-number pixels (masked or missing) are left out and the remaining weights are
    renormalised. Where less than `min_weight` of the weight is usable, the result is NaN.
    """
    h, w = image.shape
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    finite = np.isfinite(x) & np.isfinite(y)
    xs = np.where(finite, x, -10.0)
    ys = np.where(finite, y, -10.0)
    x0 = np.floor(xs).astype(np.int64)
    y0 = np.floor(ys).astype(np.int64)
    fx = xs - x0
    fy = ys - y0
    total = np.zeros(x.shape)
    weight = np.zeros(x.shape)
    for dy, dx, wgt in (
        (0, 0, (1 - fx) * (1 - fy)),
        (0, 1, fx * (1 - fy)),
        (1, 0, (1 - fx) * fy),
        (1, 1, fx * fy),
    ):
        xi = x0 + dx
        yi = y0 + dy
        inside = finite & (xi >= 0) & (xi < w) & (yi >= 0) & (yi < h)
        values = image[np.clip(yi, 0, h - 1), np.clip(xi, 0, w - 1)]
        good = inside & np.isfinite(values)
        total += np.where(good, wgt * np.where(good, values, 0.0), 0.0)
        weight += np.where(good, wgt, 0.0)
    out = np.full(x.shape, np.nan)
    usable = weight >= min_weight
    out[usable] = total[usable] / weight[usable]
    return out


def nearest(values: np.ndarray, x: np.ndarray, y: np.ndarray, fill: int = 0) -> np.ndarray:
    """Sample an integer image (such as pixel flags) at the nearest pixel; `fill` outside."""
    h, w = values.shape
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    finite = np.isfinite(x) & np.isfinite(y)
    xi = np.where(finite, np.round(np.where(finite, x, 0.0)), -1).astype(np.int64)
    yi = np.where(finite, np.round(np.where(finite, y, 0.0)), -1).astype(np.int64)
    inside = (xi >= 0) & (xi < w) & (yi >= 0) & (yi < h)
    out = np.full(x.shape, fill, dtype=values.dtype)
    out[inside] = values[yi[inside], xi[inside]]
    return out


def wavelength_at(
    table_x: np.ndarray, table_y: np.ndarray, table_values: np.ndarray, x: float, y: float
) -> tuple[float, float]:
    """Wavelength and bandwidth (micrometres) at a pixel, from the `WCS-WAVE` lookup table.

    `table_x` and `table_y` are the 1-based (FITS) pixel coordinates of the table nodes,
    `table_values` has shape (len(table_y), len(table_x), 2) with wavelength then
    bandwidth, as astropy reads the table. `x`, `y` are 0-based pixel coordinates.
    This is the same piecewise-linear lookup that astropy's `-TAB` coordinate system
    performs (method from the IRSA SPHEREx tutorials, docs/RESOURCES.md).
    """
    tx = np.asarray(table_x, dtype=float)
    ty = np.asarray(table_y, dtype=float)
    values = np.asarray(table_values, dtype=float)
    # Fractional position in the table, clamped to its edges.
    ix = float(np.interp(x + 1.0, tx, np.arange(len(tx))))
    iy = float(np.interp(y + 1.0, ty, np.arange(len(ty))))
    i0 = min(int(math.floor(ix)), len(tx) - 2)
    j0 = min(int(math.floor(iy)), len(ty) - 2)
    fx, fy = ix - i0, iy - j0
    corner = (
        (1 - fx) * (1 - fy) * values[j0, i0]
        + fx * (1 - fy) * values[j0, i0 + 1]
        + (1 - fx) * fy * values[j0 + 1, i0]
        + fx * fy * values[j0 + 1, i0 + 1]
    )
    return float(corner[0]), float(corner[1])
