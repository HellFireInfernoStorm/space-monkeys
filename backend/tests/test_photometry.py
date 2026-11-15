"""Layer 3: aperture photometry. No network: the archive and the image reader are replaced."""

import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import photometry as phot
from app.config import Settings, get_settings
from app.live import LiveExposure
from app.main import app
from app.pixels import Patch


def _star(n: int = 31, total: float = 100.0, sky: float = 5.0, sigma: float = 1.0) -> np.ndarray:
    """A Gaussian star of `total` (MJy/sr summed over pixels) centred at (n/2, n/2) on a flat sky."""
    yy, xx = np.indices((n, n)) + 0.5
    r2 = (xx - n / 2) ** 2 + (yy - n / 2) ** 2
    return sky + total * np.exp(-r2 / (2 * sigma**2)) / (2 * math.pi * sigma**2)


def test_measure_recovers_a_known_flux_in_janskys():
    result = phot.measure(_star(total=100.0), 15.5, 15.5)
    # 98.9 % of a sigma = 1 pixel Gaussian falls inside a 3 pixel radius.
    assert result.flux == pytest.approx(100.0 * phot.JY_PER_PIXEL_MJY_SR, rel=0.02)
    assert result.flux_err < 1e-3 * result.flux  # a flat sky: only the faint wings of the star scatter


def test_measure_ignores_the_background_level():
    a = phot.measure(_star(sky=5.0), 15.5, 15.5)
    b = phot.measure(_star(sky=500.0), 15.5, 15.5)
    assert a.flux == pytest.approx(b.flux)


def test_measure_matches_the_validated_2mass_conversion():
    """Same numbers as the aperture checked against 2MASS in pull request #5."""
    image = np.full((31, 31), 12.0)
    image[15, 15] += 100
    solid_angle = np.radians(6.15 / 3600) ** 2
    assert phot.measure(image, 15.5, 15.5).flux == pytest.approx(100 * 1e6 * solid_angle)


def test_error_matches_the_scatter_of_repeated_measurements():
    rng = np.random.default_rng(1)
    fluxes, errors = [], []
    for _ in range(400):
        result = phot.measure(_star() + rng.normal(0, 1.0, (31, 31)), 15.5, 15.5)
        fluxes.append(result.flux)
        errors.append(result.flux_err)
    assert np.std(fluxes) == pytest.approx(np.mean(errors), rel=0.15)


def test_an_empty_aperture_pixel_means_no_measurement():
    image = _star()
    image[15, 16] = np.nan
    assert phot.measure(image, 15.5, 15.5) is None


def test_empty_sky_pixels_are_left_out_of_the_background():
    image = _star()
    image[15, 22] = np.nan  # 6.5 pixels from the centre: in the annulus
    assert phot.measure(image, 15.5, 15.5) is not None


def test_no_measurement_near_the_edge_or_without_enough_sky():
    assert phot.measure(_star(), 5.0, 15.5) is None
    image = np.full((31, 31), np.nan)
    image[12:19, 12:19] = 1.0
    assert phot.measure(image, 15.5, 15.5) is None


def test_refusals_say_why():
    image = _star()
    assert phot.measure_or_reason(image, 15.5, 15.5)[1] is None
    assert phot.measure_or_reason(image, 5.0, 15.5) == (None, phot.EDGE)
    image[15, 15] = np.nan
    assert phot.measure_or_reason(image, 15.5, 15.5) == (None, phot.EMPTY)
    sparse = np.full((31, 31), np.nan)
    sparse[12:19, 12:19] = 1.0
    assert phot.measure_or_reason(sparse, 15.5, 15.5) == (None, phot.NO_SKY)


def test_reason_names_problem_flags_but_not_informational_ones():
    flags = (1 << 26) | (1 << 15) | (1 << 21)  # BLOOM, NONLINEAR, SOURCE (informational)
    assert phot.reason_text(phot.EMPTY, flags) == f"{phot.EMPTY}; flags: NONLINEAR, BLOOM"
    assert phot.reason_text(phot.EMPTY, 1 << 21) == phot.EMPTY
    assert phot.reason_text(phot.EDGE, 1 << 26) == phot.EDGE


def test_aperture_flags_combine_the_aperture_only():
    flags = np.zeros((21, 21), dtype=np.int32)
    flags[10, 10] = 1 << 21
    flags[11, 9] = 1 << 0
    flags[0, 0] = 1 << 5  # far outside the aperture
    assert phot.aperture_flags(flags, 10.5, 10.5) == (1 << 21) | 1


def test_known_neighbour_in_the_aperture_is_found_along_the_motion():
    """WISE 0855's catalogued field star (targets.py) is inside the aperture in 2025 and 2026."""
    from app.targets import find_target

    t = find_target("wise-0855")
    found = phot.neighbours_in_aperture(t.ra, t.dec, t.pmra, t.pmdec, t.epoch, t.parallax, [60801.0, 61160.0])
    assert len(found) == 1
    source, closest, farthest = found[0]
    assert source == t.neighbours[0].source
    assert 3.0 < closest < farthest < 12.0
    # Far from it (the 2000 position, two arcminutes away), nothing is found.
    assert phot.neighbours_in_aperture(t.ra, t.dec, 0, 0, 2000, 0, [60801.0]) == []


def test_search_incomplete():
    assert phot.search_incomplete(["Search of spherex_qr3 failed: TimeoutError: slow"])
    assert phot.search_incomplete(["The archive search failed; showing the last saved search result."])
    assert not phot.search_incomplete(["Measured 10 of 20 matching exposures, spread evenly over time."])


# --- the live endpoint, with the archive replaced ------------------------------------------


def _exposure(i: int) -> LiveExposure:
    return LiveExposure(
        exposure_id=f"obs{i}-D6",
        obs_id=f"obs{i}",
        collection="spherex_qr3",
        detector=6,
        bandpass="SPHEREx-D6",
        mjd=60800.0 + 10 * i,
        exptime_s=None,
        wl_min_um=4.4,
        wl_max_um=5.0,
        access_url=None,
        cloud_url=f"https://example.invalid/{i}.fits",
    )


@pytest.fixture
def fake_archive(monkeypatch):
    """Three exposures: a clean star, one with a flagged core, one that cannot be read."""
    calls = {"search": 0, "warnings": []}

    def matching(settings, ra, dec, wl_min, wl_max, pmra, pmdec, epoch):
        calls["search"] += 1
        items = [(_exposure(i), 4.6 + 0.01 * i) for i in range(3)]
        return items, list(calls["warnings"]), 0, False

    def patch(settings, exposure, ra_c, dec_c, n):
        image = _star(n=n)
        flags = np.zeros((n, n), dtype=np.int32)
        if exposure.exposure_id.startswith("obs1"):
            image[n // 2, n // 2] = np.nan
            flags[n // 2, n // 2] = 1 << 4
        if exposure.exposure_id.startswith("obs2"):
            raise OSError("unreadable")
        return Patch(image=image, raw=image, flags=flags)

    monkeypatch.setattr(phot, "matching_exposures", matching)
    monkeypatch.setattr(phot, "get_patch", patch)
    return calls


@pytest.fixture
def live_api(tmp_path):
    app.dependency_overrides[get_settings] = lambda: Settings(mode="live", cache_dir=tmp_path, _env_file=None)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_live_photometry_endpoint(live_api, fake_archive):
    body = live_api.get("/api/photometry", params={"ra": 133.8, "dec": -7.2, "wl_min": 4.4}).json()
    assert body["mode"] == "live"
    assert body["flux_unit"] == "uJy"
    assert body["total"] == 3 and body["returned"] == 2
    good, flagged = body["points"]
    assert good["flux"] == pytest.approx(100.0 * phot.JY_PER_PIXEL_MJY_SR * 1e6, rel=0.02)
    assert good["usable"] is True and good["reason"] is None
    assert good["det_id"] == 6 and good["obs_id"] == "obs0"
    assert good["lambda_width"] == pytest.approx(4.6 / 130.0, abs=1e-5)
    assert flagged["flux"] is None and flagged["flux_err"] is None
    assert flagged["flags"] == 1 << 4
    assert flagged["usable"] is False
    assert flagged["reason"] == phot.EMPTY  # bit 4 is not a known problem bit, so no names
    assert any("could not be read" in w for w in body["warnings"])
    assert any("1 of 2 point(s) have no flux" in w for w in body["warnings"])


def test_live_photometry_is_cached(live_api, fake_archive):
    params = {"ra": 133.8, "dec": -7.2}
    first = live_api.get("/api/photometry", params=params).json()
    second = live_api.get("/api/photometry", params=params).json()
    assert first == second
    assert fake_archive["search"] == 1


def test_live_photometry_after_a_failed_search_is_not_cached(live_api, fake_archive):
    fake_archive["warnings"] = ["Search of spherex_qr3 failed: TimeoutError: slow"]
    params = {"ra": 133.8, "dec": -7.2}
    live_api.get("/api/photometry", params=params)
    live_api.get("/api/photometry", params=params)
    assert fake_archive["search"] == 2


def test_parallax_moves_the_aperture(monkeypatch, tmp_path, fake_archive):
    """The parallax shift is applied to the aperture: 3 pixels east of a 1 pixel star loses half of it."""
    monkeypatch.setattr(phot, "parallax_offset", lambda ra, dec, plx, mjd: (3 * 6.15 * plx / 1000.0, 0.0))
    settings = Settings(mode="live", cache_dir=tmp_path, _env_file=None)
    centred = phot.live_photometry(settings, 133.8, -7.2, 0, 0, 2000, 0.0, None, None, None)
    moved = phot.live_photometry(settings, 133.8, -7.2, 0, 0, 2000, 1000.0, None, None, None)
    assert moved.points[0].flux is not None
    assert 0.2 * centred.points[0].flux < moved.points[0].flux < 0.7 * centred.points[0].flux
