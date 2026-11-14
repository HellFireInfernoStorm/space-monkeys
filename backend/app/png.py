"""Encoding a scaled image as a greyscale PNG. Shared by mock and live mode."""

import io
import math

import numpy as np
from PIL import Image

MIN_PNG_PIXELS = 256


def encode_grey(scaled: np.ndarray) -> bytes:
    """PNG of an image scaled to 0..1 (clipped), enlarged with sharp pixels to at least
    MIN_PNG_PIXELS wide so the browser does not blur it."""
    grey = (np.clip(scaled, 0.0, 1.0) * 255.0).round().astype(np.uint8)
    factor = max(1, math.ceil(MIN_PNG_PIXELS / grey.shape[0]))
    grey = np.repeat(np.repeat(grey, factor, axis=0), factor, axis=1)
    buffer = io.BytesIO()
    Image.fromarray(grey).save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()
