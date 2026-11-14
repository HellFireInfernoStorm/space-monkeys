"""The diagnostic aperture must never report the surviving fraction of a star."""

import numpy as np
import pytest

from scripts.check_accuracy import aperture_flux


def test_comparison_aperture_preserves_flux_or_returns_empty():
    image = np.full((31, 31), 12.0)
    image[15, 15] += 100
    full = aperture_flux(image, 15.5, 15.5)
    assert full > 0
    assert aperture_flux(image + 500, 15.5, 15.5) == pytest.approx(full)
    image[15, 16] = np.nan
    assert aperture_flux(image, 15.5, 15.5) is None


def test_comparison_aperture_requires_a_measured_sky():
    image = np.full((31, 31), np.nan)
    image[13:18, 13:18] = 1
    assert aperture_flux(image, 15.5, 15.5) is None
    assert aperture_flux(np.ones((31, 31)), 2.5, 15.5) is None
