"""Reading SPHEREx pixels (live mode): only the bytes we need, by HTTP range requests.

A file on the AWS mirror is opened with `astropy.io.fits.open(..., use_fsspec=True)`, and
only the patch around the target is read from `IMAGE` and `FLAGS` through `.section`.
`VARIANCE` is not read: frames do not need it. Local file paths work too (used by the tests).

Astropy is imported inside the functions so that mock mode starts without it.
"""

import warnings
from dataclasses import dataclass

import numpy as np

from .flags import DEFAULT_BAD_MASK
from .resample import bilinear, grid_offsets, nearest, source_box, tangent_to_sky, wavelength_at

# Range-read settings for the AWS mirror (measured to work in the data spike).
FSSPEC_KWARGS = {"block_size": 131072, "cache_type": "bytes"}


@dataclass(frozen=True)
class Patch:
    """One exposure resampled onto the common grid. Row 0 is north, column 0 is east.

    `image` is MJy/sr resampled from good pixels only: bad pixels (`DEFAULT_BAD_MASK`) and
    missing values are NaN and never leak into their neighbours. Use it for anything
    quantitative (background, scaling, differences). `raw` is the same resampling without
    the mask; it is only for filling holes in a displayed picture (the cores of bright
    stars are flagged, see `fill_for_display`). `flags` are the flag bits of the nearest
    source pixel (0 outside the detector).
    """

    image: np.ndarray
    raw: np.ndarray
    flags: np.ndarray


def _open(location: str):
    from astropy.io import fits

    if location.startswith(("http://", "https://")):
        return fits.open(location, use_fsspec=True, fsspec_kwargs=FSSPEC_KWARGS, lazy_load_hdus=True)
    return fits.open(location, lazy_load_hdus=True)


def _celestial_wcs(header):
    from astropy.wcs import WCS, FITSFixedWarning

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", FITSFixedWarning)
        return WCS(header)


def _world_to_pixel(wcs, ra: np.ndarray, dec: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Sky to 0-based pixel positions, with the full distortion model (SIP)."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        x, y = wcs.all_world2pix(np.ravel(ra), np.ravel(dec), 0, quiet=True)
    return np.reshape(x, np.shape(ra)), np.reshape(y, np.shape(dec))


def probe(location: str, ra: float, dec: float) -> float | None:
    """Wavelength (micrometres) at a sky position in one exposure, or None if the
    position is not on the detector. Reads the `IMAGE` header and the `WCS-WAVE` table."""
    with _open(location) as hdus:
        header = hdus["IMAGE"].header
        width, height = int(header["NAXIS1"]), int(header["NAXIS2"])
        x, y = _world_to_pixel(_celestial_wcs(header), np.array([ra]), np.array([dec]))
        px, py = float(x[0]), float(y[0])
        if not (np.isfinite(px) and np.isfinite(py)):
            return None
        if not (-0.5 <= px < width - 0.5 and -0.5 <= py < height - 0.5):
            return None
        table = hdus["WCS-WAVE"].data
        wavelength, _bandwidth = wavelength_at(table["X"][0], table["Y"][0], table["VALUES"][0], px, py)
        return wavelength


def read_patch(location: str, ra_c: float, dec_c: float, n: int, scale_arcsec: float) -> Patch | None:
    """The patch around a position, resampled onto the common grid; None if it misses
    the detector. Bilinear for the image, nearest pixel for the flags. Bad pixels
    (`DEFAULT_BAD_MASK`) become NaN before resampling, so they never leak into neighbours."""
    east, north = grid_offsets(n, scale_arcsec)
    ra, dec = tangent_to_sky(ra_c, dec_c, east, north)
    with _open(location) as hdus:
        image_hdu = hdus["IMAGE"]
        header = image_hdu.header
        width, height = int(header["NAXIS1"]), int(header["NAXIS2"])
        x, y = _world_to_pixel(_celestial_wcs(header), ra, dec)
        box = source_box(x, y, width, height)
        if box is None:
            return None
        y0, y1, x0, x1 = box
        image = np.array(image_hdu.section[y0:y1, x0:x1], dtype=np.float64)
        flags = np.array(hdus["FLAGS"].section[y0:y1, x0:x1], dtype=np.int64)

    image[~np.isfinite(image)] = np.nan
    out_raw = bilinear(image, x - x0, y - y0)
    image[(flags & DEFAULT_BAD_MASK) != 0] = np.nan
    out_image = bilinear(image, x - x0, y - y0)
    out_flags = nearest(flags, x - x0, y - y0)
    if not np.isfinite(out_raw).any():
        return None
    return Patch(
        image=out_image.astype(np.float32), raw=out_raw.astype(np.float32), flags=out_flags.astype(np.int32)
    )
