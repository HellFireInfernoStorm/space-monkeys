"""Checks on the science helpers: positions, flags, sampling, mock images."""

import math

import numpy as np

from app import mock
from app.bands import BANDS, band_of
from app.config import Settings
from app.flags import DEFAULT_BAD_MASK, FLAG_BITS, describe, is_bad
from app.sampling import sample_evenly
from app.targets import TARGETS, find_target, mjd_to_year, propagate, year_to_mjd


def _separation_arcsec(ra1, dec1, ra2, dec2):
    d_ra = (ra1 - ra2) * math.cos(math.radians(dec1))
    return math.hypot(d_ra, dec1 - dec2) * 3600.0


def test_wise_0855_position_in_2026():
    t = find_target("WISE 0855")
    ra, dec = propagate(t.ra, t.dec, t.pmra, t.pmdec, t.epoch, 2026.0)
    # Expected value worked out by hand from the catalogue numbers (docs/SCIENCE.md).
    assert _separation_arcsec(ra, dec, 133.75977, -7.24219) < 0.2
    # It is nowhere near the 2010-era position printed in the challenge text.
    assert _separation_arcsec(ra, dec, 133.795129, -7.245147) > 100


def test_barnards_star_moves_about_ten_arcsec_a_year():
    t = find_target("Barnard's Star")
    a = propagate(t.ra, t.dec, t.pmra, t.pmdec, t.epoch, 2025.0)
    b = propagate(t.ra, t.dec, t.pmra, t.pmdec, t.epoch, 2026.0)
    assert 10.0 < _separation_arcsec(*a, *b) < 10.8


def test_year_and_mjd_round_trip():
    assert mjd_to_year(51544.5) == 2000.0
    assert abs(year_to_mjd(mjd_to_year(61000.0)) - 61000.0) < 1e-6


def test_targets_are_unique_and_findable():
    assert len({t.id for t in TARGETS}) == 5
    for t in TARGETS:
        assert find_target(t.name) is t
        for alias in t.aliases:
            assert find_target(alias) is t


def test_bad_mask_leaves_out_informational_bits():
    assert not DEFAULT_BAD_MASK & (1 << 12)
    assert not DEFAULT_BAD_MASK & (1 << 21)
    assert DEFAULT_BAD_MASK & (1 << 10)  # hot pixel
    assert not is_bad(1 << 21)  # "known source" alone is a good pixel
    assert is_bad((1 << 21) | (1 << 10))
    assert [f.name for f in describe((1 << 21) | (1 << 0))] == ["TRANSIENT", "SOURCE"]
    assert len({f.bit for f in FLAG_BITS}) == len(FLAG_BITS)


def test_bands_do_not_overlap():
    edges = [edge for band in sorted(BANDS) for edge in BANDS[band]]
    assert edges == sorted(edges)
    assert band_of(4.7) == 6
    assert band_of(9.0) is None


def test_sample_evenly():
    items = list(range(100))
    assert sample_evenly(items, 200) == items
    picked = sample_evenly(items, 10)
    assert len(picked) == 10
    assert picked[0] == 0 and picked[-1] == 99
    assert sample_evenly(items, 1) == [50]


def test_settings_lists_accept_commas_and_json(monkeypatch):
    monkeypatch.setenv("SM_COLLECTIONS", "one, two")
    monkeypatch.setenv("SM_CORS_ORIGINS", '["https://example.org"]')
    settings = Settings(_env_file=None)
    assert settings.collections == ["one", "two"]
    assert settings.cors_origins == ["https://example.org"]


def test_mock_survey_shape():
    exposures = mock.all_exposures()
    assert len(exposures) == 72
    assert len({e.exposure_id for e in exposures}) == 72
    for e in exposures:
        lo, hi = BANDS[e.detector]
        assert lo <= e.wavelength_um <= hi


def test_mock_patch_is_repeatable_and_sized():
    e = mock.all_exposures()[0]
    a = mock.patch(e, 10.0, 20.0, 120.0)
    b = mock.patch(e, 10.0, 20.0, 120.0)
    assert a.shape == (20, 20)
    assert np.array_equal(a, b)
    assert mock.patch(e, 10.0, 20.0, 5000.0).shape == (96, 96)


def test_mock_barnards_star_is_the_brightest_thing_and_moves():
    t = find_target("barnard")
    band6 = [e for e in mock.all_exposures() if e.detector == 6]
    first, last = band6[0], band6[-1]
    centre = propagate(t.ra, t.dec, t.pmra, t.pmdec, t.epoch, mjd_to_year(first.mjd))
    early = mock.patch(first, *centre, 180.0)
    late = mock.patch(last, *centre, 180.0)
    n = early.shape[0]
    y0, x0 = np.unravel_index(np.argmax(early), early.shape)
    y1, x1 = np.unravel_index(np.argmax(late), late.shape)
    assert abs(y0 - n / 2) <= 1 and abs(x0 - n / 2) <= 1  # centred at the start
    assert y1 < y0  # a year later it has moved north (up)


def test_mock_wise_0855_is_hidden_in_one_frame_but_there_in_a_stack():
    t = find_target("wise-0855")
    band6 = [e for e in mock.all_exposures() if e.wavelength_um > 4.4]
    stack = []
    for e in band6:
        centre = propagate(t.ra, t.dec, t.pmra, t.pmdec, t.epoch, mjd_to_year(e.mjd))
        image = mock.patch(e, *centre, 120.0)
        stack.append(image - np.median(image))
    mean = np.mean(stack, axis=0)
    n = mean.shape[0]
    core = mean[n // 2 - 1 : n // 2 + 1, n // 2 - 1 : n // 2 + 1].mean()
    assert core > 3 * mock.NOISE_SIGMA / math.sqrt(len(stack))
