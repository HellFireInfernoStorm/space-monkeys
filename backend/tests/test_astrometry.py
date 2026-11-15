"""Adversarial astrometric checks; no external service in the test suite."""

import asyncio
import io
import math
import re
import threading
from urllib.parse import parse_qs

import numpy as np
import pytest

from app import astrometry as a
from app import live_frames, mock
from app.config import Settings
from app.resample import sky_to_tangent, tangent_to_sky


def settings(tmp_path, **kw):
    return Settings(mode="live", cache_dir=tmp_path, _env_file=None, **kw)


def sky(points, ra=150, dec=20):
    return np.column_stack(tangent_to_sky(ra, dec, points[:, 0], points[:, 1]))


def points():
    return np.array([(x, y) for x in (-120, -40, 40, 120) for y in (-100, 0, 100)], dtype=float)


def assess(tmp_path, cat=None, obs=None, centre=(150, 20)):
    cat = points() if cat is None else cat
    obs = cat + [0.7, -0.4] if obs is None else obs
    return a.assess(a.base_result(settings(tmp_path), "test", 61000),
                    list(map(str, range(len(cat)))), sky(cat, *centre), sky(obs, *centre), *centre)


@pytest.mark.parametrize("centre", [(150, 20), (359.999, 0), (0.001, 85), (180, -85)])
def test_translation_units_wrap_and_poles(tmp_path, centre):
    r = assess(tmp_path, centre=centre)
    assert r.provenance == "verified"
    assert r.offset_east_arcsec == pytest.approx(0.7, abs=1e-6)
    assert r.offset_north_arcsec == pytest.approx(-0.4, abs=1e-6)
    assert r.rms_arcsec == pytest.approx(np.hypot(0.7, 0.4))
    assert r.rms_pixels == pytest.approx(r.rms_arcsec / 6.15)
    assert r.fit_rms_arcsec < 1e-6
    assert not r.correction_applied
    assert r.quality_passed
    for match in r.matches:
        assert match.offset_arcsec == pytest.approx(np.hypot(0.7, 0.4))
        assert match.residual_arcsec == match.offset_arcsec  # legacy API compatibility
        assert match.fit_residual_arcsec < 1e-6


@pytest.mark.parametrize("kind", ["empty", "few", "cluster", "line", "offset", "unrelated", "ambiguous"])
def test_bad_solutions_do_not_verify(tmp_path, kind):
    p = points()
    if kind == "empty":
        p = np.empty((0, 2))
    if kind == "few":
        p = p[:7]
    if kind == "cluster":
        p = np.array([(x, y) for x in (0, 8, 16, 24) for y in (0, 8, 16)], dtype=float)
    if kind == "line":
        p = np.column_stack([np.arange(12) * 20, np.zeros(12)])
    obs = p + [0.7, -0.4]
    if kind == "offset":
        obs = p + [4, 0]  # matches, but fails archive verification
    if kind == "unrelated":
        obs = p + [20, 20]
    if kind == "ambiguous":
        p = np.concatenate([p, p + 0.2])
    r = assess(tmp_path, p, obs)
    assert r.provenance == "archive"
    assert not r.quality_passed
    assert not r.correction_applied
    assert r.reason


def test_outliers_are_reported_not_silently_fitted(tmp_path):
    p = points()
    obs = p + [0.7, -0.4]
    obs[-1] += [4, 0]
    r = assess(tmp_path, p, obs)
    assert r.provenance == "verified"
    assert r.rejected == 1
    assert not r.matches[-1].inlier
    assert r.offset_east_arcsec == pytest.approx(0.7, abs=1e-6)


def test_unrelated_random_fields_never_verify(tmp_path):
    rng = np.random.default_rng(20261115)
    for _ in range(100):
        cat = rng.uniform(-500, 500, (500, 2))
        obs = rng.uniform(-500, 500, (150, 2))
        assert assess(tmp_path, cat, obs).provenance == "archive"


def test_blank_noise_does_not_create_reference_detections():
    image = np.random.default_rng(42).normal(size=(161, 161))
    assert len(a.detect(image, np.zeros(image.shape, dtype=np.int64))) == 0


def star_image():
    rng = np.random.default_rng(42)
    y, x = np.mgrid[:100, :100]
    image = rng.normal(0, 0.02, (100, 100))
    for cx, cy in ((20.2, 30.1), (60.1, 70.2), (85.1, 15.2)):
        image += 20*np.exp(-((x-cx)**2+(y-cy)**2)/(2*0.7**2))
    return image, np.zeros((100, 100), dtype=np.int64)


def test_detector_centroids_and_informational_bits():
    image, flags = star_image()
    flags[:] = (1 << 21) | (1 << 12)
    found = a.detect(image, flags)
    assert len(found) == 3
    for point in ((20.2, 30.1), (60.1, 70.2), (85.1, 15.2)):
        assert np.min(np.linalg.norm(found - point, axis=1)) < 0.06


@pytest.mark.parametrize("bad", ["flag", "nan", "edge", "flat"])
def test_detection_never_uses_bad_footprints(bad):
    image, flags = star_image()
    if bad == "flag":
        flags[28:33, 18:23] = 1 << 1
    if bad == "nan":
        image[30, 20] = np.nan
    if bad == "edge":
        image = image[29:]
        flags = flags[29:]
    if bad == "flat":
        image[:] = 1
    found = a.detect(image, flags)
    assert len(found) <= 2


def test_mock_is_deterministic_and_never_calls_network(tmp_path, monkeypatch):
    monkeypatch.setattr(a, "urlopen", lambda *args, **kw: pytest.fail("network in mock"))
    s = Settings(mode="mock", cache_dir=tmp_path, _env_file=None)
    e = mock.all_exposures()[0]
    first = a.solve(s, e.exposure_id, 150, 20, 150, 20)
    second = a.solve(s, e.exposure_id, 150, 20, 150, 20)
    assert first == second
    assert first.provenance == "mock"
    assert "Mock demonstration" in first.reason
    assert first.catalogue_url == ""
    assert not first.correction_applied


def test_mock_sparse_example_is_explicit(tmp_path):
    s = Settings(mode="mock", cache_dir=tmp_path, _env_file=None)
    e = next(e for e in mock.all_exposures() if e.detector == 6)
    r = a.solve(s, e.exposure_id, 150, 20, 150, 20)
    assert r.provenance == "mock"
    assert r.rms_arcsec is None
    assert "need at least 8" in r.reason


def test_unknown_exposure_is_404(client):
    response = client.get("/api/alignment", params={
        "exposure_id": "bad", "ra": 150, "dec": 20, "target_ra": 150, "target_dec": 20,
    })
    assert response.status_code == 404


@pytest.mark.parametrize("change", [{"ra": -1}, {"dec": 91}, {"target_ra": "nan"}, {"exposure_id": ""}])
def test_api_validation(client, change):
    p = {"exposure_id": "bad", "ra": 150, "dec": 20, "target_ra": 150, "target_dec": 20}
    response = client.get("/api/alignment", params=p | change)
    assert response.status_code == 422


def test_api_mock_contract(client):
    e = mock.all_exposures()[0]
    response = client.get("/api/alignment", params={
        "exposure_id": e.exposure_id, "ra": 150, "dec": 20, "target_ra": 150, "target_dec": 20,
    })
    assert response.status_code == 200
    assert response.json()["mode"] == "mock"
    assert not response.json()["correction_applied"]


def test_timeout_returns_without_waiting_for_reader(tmp_path, monkeypatch):
    finished = threading.Event()
    release = threading.Event()

    def slow(*args):
        release.wait(2)
        finished.set()

    monkeypatch.setattr(a, "solve", slow)
    async def run():
        try:
            r = await a.check(settings(tmp_path, astrometry_timeout_s=0.01), "test", 1, 2, 1, 2)
            assert r.state == "timeout"
            assert r.mjd is None
            assert not finished.is_set()
        finally:
            release.set()
    asyncio.run(run())
    assert finished.is_set()  # event-loop shutdown reaps the thread


def test_busy_and_failure_release_slot(tmp_path, monkeypatch):
    s = Settings(mode="mock", cache_dir=tmp_path, _env_file=None)
    e = mock.all_exposures()[0]
    slots = threading.BoundedSemaphore(1)
    monkeypatch.setattr(a, "_slots", slots)
    slots.acquire()
    assert a.solve(s, e.exposure_id, 150, 20, 150, 20).state == "busy"
    slots.release()
    monkeypatch.setattr(mock, "_sources", lambda *args: (_ for _ in ()).throw(ValueError("bad")))
    assert a.solve(s, e.exposure_id, 150, 20, 150, 20).state == "failed"
    assert slots.acquire(blocking=False)
    slots.release()


def test_cached_results_do_not_require_a_reader_slot(tmp_path, monkeypatch):
    s = Settings(mode="mock", cache_dir=tmp_path, _env_file=None)
    e = mock.all_exposures()[0]
    expected = a.solve(s, e.exposure_id, 150, 20, 150, 20)
    slots = threading.BoundedSemaphore(1)
    slots.acquire()
    monkeypatch.setattr(a, "_slots", slots)
    monkeypatch.setattr(mock, "_sources", lambda *args: pytest.fail("cache hit must not read sources"))
    assert a.solve(s, e.exposure_id, 150, 20, 150, 20) == expected
    assert not slots.acquire(blocking=False)  # cache hit must not release someone else's slot
    slots.release()


def test_mock_reports_geometry_rejection(tmp_path, monkeypatch):
    p = np.array([(x+100, y+100) for x in (0, 8, 16, 24) for y in (0, 8, 16)])
    monkeypatch.setattr(mock, "_sources", lambda *args: (p[:, 0], p[:, 1], np.full(len(p), 5)))
    s = Settings(mode="mock", cache_dir=tmp_path, _env_file=None)
    r = a.solve(s, mock.all_exposures()[0].exposure_id, 150, 20, 150, 20)
    assert r.provenance == "mock"
    assert not r.quality_passed
    assert r.matched == 12
    assert "clustered" in r.reason


@pytest.mark.parametrize("status", [403, 500, 503])
def test_mirror_http_errors_return_structured_failure(live_client, monkeypatch, status):
    aiohttp = pytest.importorskip("aiohttp")
    from app.live import LiveExposure
    e = LiveExposure("x", "x", "test", 1, "test", 61000, 1, 1, 2, None, "fixture")
    monkeypatch.setattr(live_frames, "find_exposure", lambda *args: e)

    def fail(*args):
        raise aiohttp.ClientResponseError(request_info=None, history=(), status=status, message="fixture")

    monkeypatch.setattr(a, "_native_stars", fail)
    response = live_client.get("/api/alignment", params={
        "exposure_id": "x", "ra": 150, "dec": 20, "target_ra": 150, "target_dec": 20,
    })
    assert response.status_code == 200
    r = response.json()
    assert r["state"] == "failed"
    assert r["provenance"] == "archive"
    assert r["rms_arcsec"] is None
    assert not r["quality_passed"]


def test_catalogue_parser_and_epoch_propagation(tmp_path, monkeypatch):
    pytest.importorskip("astropy")
    payload = b"source_id,ra,dec,pmra,pmdec,ref_epoch\n123,150,20,1000,0,2016\n"
    monkeypatch.setattr(a, "urlopen", lambda *args, **kw: io.BytesIO(payload))
    ids, coords = a.catalogue(settings(tmp_path), 150, 20, 61000)
    assert ids == ["123"]
    assert coords[0, 0] > 150.002
    assert coords[0, 1] == pytest.approx(20, abs=1e-6)


def test_catalogue_cone_uses_patch_half_diagonal_with_match_margin(tmp_path, monkeypatch):
    pytest.importorskip("astropy")
    queries = []

    def reply(request, **kwargs):
        queries.append(parse_qs(request.data.decode())["QUERY"][0])
        return io.BytesIO(b"source_id,ra,dec,pmra,pmdec,ref_epoch\n")

    monkeypatch.setattr(a, "urlopen", reply)
    a.catalogue(settings(tmp_path), 150, 20, 61000)
    radius = float(re.search(r"CIRCLE\('ICRS',[^,]+,[^,]+,([0-9.]+)\)", queries[0]).group(1))
    half_diagonal = a.FIELD_PIXELS / math.sqrt(2) * 6.15 / 3600
    assert radius == pytest.approx(half_diagonal + a.MATCH_RADIUS/3600, abs=1e-9)
    assert radius < a.FIELD_PIXELS * 6.15 / 3600


@pytest.mark.parametrize("payload", [b"<html>unavailable</html>",
    b"source_id,ra,dec,pmra,pmdec,ref_epoch\n1,nan,20,0,0,2016\n", b"x"*1_000_001])
def test_bad_catalogue_responses_are_rejected(tmp_path, monkeypatch, payload):
    pytest.importorskip("astropy")
    monkeypatch.setattr(a, "urlopen", lambda *args, **kw: io.BytesIO(payload))
    with pytest.raises(ValueError):
        a.catalogue(settings(tmp_path), 150, 20, 61000)


def test_native_pixels_rotated_mirrored_distorted_and_cropped(tmp_path):
    pytest.importorskip("astropy")
    from astropy.io import fits
    from astropy.wcs import WCS, Sip

    from app.live import LiveExposure
    image, flags = star_image()
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN-SIP", "DEC--TAN-SIP"]
    w.wcs.crval = [359.999, 80]
    w.wcs.crpix = [50.5, 50.5]
    w.wcs.cd = np.array([[0.0014, -0.001], [0.001, 0.0014]])
    coeff = np.zeros((3, 3))
    coeff[2, 0] = 1e-5
    w.sip = Sip(coeff, coeff.T.copy(), None, None, w.wcs.crpix)
    path = tmp_path / "test.fits"
    fits.HDUList([fits.PrimaryHDU(), fits.ImageHDU(image, w.to_header(relax=True), name="IMAGE"),
                  fits.ImageHDU(flags, name="FLAGS")]).writeto(path)
    e = LiveExposure("x", "x", "test", 1, "test", 61000, 1, 1, 2, None, str(path))
    coords = a.native_stars(settings(tmp_path), e, 359.999, 80)
    expected = np.column_stack(w.all_pix2world([20.2, 60.1, 85.1], [30.1, 70.2, 15.2], 0))
    assert len(coords) == 3
    for row in expected:
        distances = np.column_stack(sky_to_tangent(
            *row, coords[:, 0], coords[:, 1]))
        assert np.min(np.linalg.norm(distances, axis=1)) < 0.4


def test_no_target_or_neighbour_used_in_fit(tmp_path, monkeypatch):
    from app.live import LiveExposure
    e = LiveExposure("x", "x", "test", 1, "test", 61000, 1, 1, 2, None, "local")
    p = np.vstack([points(), [[0, 0], [6, 0]]])
    monkeypatch.setattr(live_frames, "find_exposure", lambda *args: e)
    monkeypatch.setattr(a, "native_stars", lambda *args: sky(p + [0.7, -0.4]))
    monkeypatch.setattr(a, "catalogue", lambda *args: (list(map(str, range(len(p)))), sky(p)))
    r = a.solve(settings(tmp_path), "x", 150, 20, 150, 20)
    assert r.provenance == "verified"
    assert r.matched == 12
    assert "12" not in [m.source_id for m in r.matches]
    assert "13" not in [m.source_id for m in r.matches]


def test_failed_network_is_not_cached(tmp_path, monkeypatch):
    from app.live import LiveExposure
    e = LiveExposure("x", "x", "test", 1, "test", 61000, 1, 1, 2, None, "local")
    monkeypatch.setattr(live_frames, "find_exposure", lambda *args: e)
    monkeypatch.setattr(a, "native_stars", lambda *args: (_ for _ in ()).throw(TimeoutError()))
    assert a.solve(settings(tmp_path), "x", 150, 20, 150, 20).state == "timeout"
    monkeypatch.setattr(a, "native_stars", lambda *args: sky(points()+[0.7, -0.4]))
    monkeypatch.setattr(a, "catalogue", lambda *args: (list(map(str, range(12))), sky(points())))
    assert a.solve(settings(tmp_path), "x", 150, 20, 150, 20).provenance == "verified"
