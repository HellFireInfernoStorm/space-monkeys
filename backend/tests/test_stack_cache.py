"""One request form for stacks, so that the site's links hit the stacks scripts/prewarm.py built."""

import numpy as np
import pytest

from app import stack_service
from app.config import Settings
from app.targets import find_target

StackRequest = stack_service.StackRequest


@pytest.mark.parametrize("rounded", [False, True])
def test_known_neighbour_is_selected_for_nearby_sky_requests(monkeypatch, rounded):
    target = find_target("wise-0855")
    from app.targets import position_at_mjd

    ra = 133.8189 if rounded else target.ra
    req = StackRequest.normalised(ra, target.dec, 60, 4.4, 5, target.pmra, target.pmdec, 2000)
    pos = position_at_mjd(req.ra, req.dec, req.pmra, req.pmdec, req.epoch, 61000)
    exposure = stack_service._Exposure("one", 61000, 4.7, np.ones((21, 21)), *pos)
    monkeypatch.setattr(stack_service, "_live_inputs", lambda *_: ([exposure], 1, [], False))
    captured = []

    def capture(inputs, *_):
        captured.extend(inputs)
        return {"single": None, "tracked": None, "static": None, "epochs": []}

    monkeypatch.setattr(stack_service.stacking, "build", capture)
    meta, _ = stack_service._compute(Settings(mode="live", _env_file=None), req)
    assert captured[0].neighbour is not None
    assert any("known field star" in w for w in meta["result"]["warnings"])


def test_small_crops_preserve_snr_motion_and_markers(monkeypatch):
    from app import stacking

    rng = np.random.default_rng(98)
    yy, xx = np.indices((49, 49)) + 0.5
    images = [
        rng.normal(0, 0.4, (49, 49)) + 10 * np.exp(-((xx - 24.5) ** 2 + (yy - 24.5) ** 2) / (2 * 0.8**2))
        for _ in range(18)
    ]

    def inputs(_settings, req, n):
        crop = (49 - n) // 2
        return (
            [
                stack_service._Exposure(
                    str(k),
                    61000 + (k // 6) * 180 + k % 6,
                    4.7,
                    im[crop : crop + n, crop : crop + n],
                    req.ra,
                    req.dec,
                )
                for k, im in enumerate(images)
            ],
            18,
            [],
            False,
        )

    real_measure = stacking.measure_visit

    def fast_measure(*args, **kwargs):
        return real_measure(*args, **kwargs, draws=25)

    monkeypatch.setattr(stack_service, "_live_inputs", inputs)
    monkeypatch.setattr(stacking, "measure_visit", fast_measure)
    results = []
    for size in (60, 80, 120, 300):
        req = StackRequest.normalised(10, 20, size, 4.4, 5, 1, 2, 2000)
        meta, arrays = stack_service._compute(Settings(mode="live", _env_file=None), req)
        result = meta["result"]
        n = stack_service.mock.patch_pixels(size)
        assert arrays["tracked_0"].shape == (n, n)
        assert result["pixels"] == n and result["tracked"]["target_x"] == n / 2
        assert result["tracked"]["snr"] is not None
        assert result["motion"][1]["measured_east_arcsec"] is not None
        results.append(([result[k]["snr"] for k in ("single", "tracked", "static")], result["motion"]))
    assert all(r == results[0] for r in results)


def test_unavailable_snr_has_an_explanation(monkeypatch):
    image = np.full((21, 21), np.nan)
    image[7:14, 7:14] = np.random.default_rng(17).normal(0, 1, (7, 7))
    monkeypatch.setattr(
        stack_service,
        "_live_inputs",
        lambda *_: ([stack_service._Exposure("edge", 61000, 4.7, image, 10, 20)], 1, [], False),
    )
    req = StackRequest.normalised(10, 20, 60, 4.4, 5, 0, 0, 2000)
    meta, _ = stack_service._compute(Settings(mode="live", _env_file=None), req)
    assert meta["result"]["tracked"]["snr"] is None
    assert meta["result"]["tracked"]["saturated"] is False
    assert any("S/N is unavailable" in w for w in meta["result"]["warnings"])


@pytest.mark.parametrize("raises", [False, True])
def test_failed_archive_result_is_not_cached_and_recovers(tmp_path, monkeypatch, raises):
    settings = Settings(mode="live", cache_dir=tmp_path, _env_file=None)
    req = StackRequest.normalised(10, 20, 60, 4.4, 5, 0, 0, 2000)
    calls = []

    def compute(*_):
        calls.append(1)
        if len(calls) == 1:
            if raises:
                raise stack_service.live_frames.SearchFailed("every collection failed")
            return {"result": {"returned": 0, "warnings": ["Search of collection failed: 502"]}}, {}
        return {"result": {"returned": 1, "warnings": []}}, {"tracked_0": np.ones((11, 11))}

    monkeypatch.setattr(stack_service, "_compute", compute)
    if raises:
        with pytest.raises(stack_service.live_frames.SearchFailed):
            stack_service.get_stack(settings, req)
    else:
        assert stack_service.get_stack(settings, req)[0]["result"]["returned"] == 0
    cache = stack_service.live_frames._cache(settings)
    assert cache.get_json("stack", stack_service._key(settings, req)) is None
    assert cache.get_arrays("stackimg", stack_service._key(settings, req)) is None
    assert stack_service.get_stack(settings, req)[0]["result"]["returned"] == 1
    assert stack_service.get_stack(settings, req)[0]["result"]["returned"] == 1
    assert len(calls) == 2


def test_live_wise_fit_gets_a_fixed_sky_neighbour(monkeypatch):
    import numpy as np

    from app.resample import sky_to_tangent
    from app.targets import position_at_mjd

    target = find_target("wise-0855")
    req = StackRequest.normalised(
        target.ra,
        target.dec,
        120,
        4.4,
        5.0,
        target.pmra,
        target.pmdec,
        target.epoch,
        target.parallax,
    )
    positions = [
        position_at_mjd(target.ra, target.dec, target.pmra, target.pmdec, target.epoch, mjd)
        for mjd in (60990, 61160)
    ]
    exposures = [
        stack_service._Exposure(str(k), mjd, 4.7, np.ones((21, 21)), *position)
        for k, (mjd, position) in enumerate(zip((60990, 61160), positions, strict=True))
    ]
    monkeypatch.setattr(stack_service, "_live_inputs", lambda *_: (exposures, 2, [], False))
    captured = []

    def capture(inputs, *_):
        captured.extend(inputs)
        return {"single": None, "tracked": None, "static": None, "epochs": []}

    monkeypatch.setattr(stack_service.stacking, "build", capture)
    stack_service._compute(Settings(mode="live", _env_file=None), req)
    for item, (ra, dec) in zip(captured, positions, strict=True):
        east, north = sky_to_tangent(ra, dec, np.array([133.75818250]), np.array([-7.24115591]))
        assert np.allclose(item.neighbour, (10.5 - east[0] / 6.15, 10.5 - north[0] / 6.15))
    assert captured[0].neighbour != captured[1].neighbour


def _site_trim(value: float, decimals: int) -> float:
    """What frontend/src/urlState.ts writes into the address: fixed decimals, no trailing zeros."""
    return float(f"{value:.{decimals}f}")


def test_site_request_matches_the_prewarmed_stack_for_every_target():
    settings = Settings(mode="live", _env_file=None)
    for target_id in ("wise-0855", "barnard", "eps-ind-b", "rw-aur", "r-dra"):
        t = find_target(target_id)
        prewarm = StackRequest.normalised(t.ra, t.dec, 120.0, 4.4, 5.0, t.pmra, t.pmdec, t.epoch, t.parallax)
        site = StackRequest.normalised(
            _site_trim(t.ra, 7),
            _site_trim(t.dec, 7),
            120.0,
            4.4,
            5.0,
            _site_trim(t.pmra, 3),
            _site_trim(t.pmdec, 3),
            _site_trim(t.epoch, 3),
            _site_trim(t.parallax, 3),
        )
        assert site == prewarm, target_id
        assert stack_service._key(settings, site) == stack_service._key(settings, prewarm)
        assert (site.ra, site.dec, site.parallax) == (t.ra, t.dec, t.parallax)  # the catalogue values


def test_other_positions_are_rounded_the_same_way_everywhere():
    a = StackRequest.normalised(10.12345671, 20.0000004, 120.04, 1.00001, None, 0.0, 0.0, 2000.0)
    b = StackRequest.normalised(10.1234567, 20.0, 120.0, 1.0, None, 0.0, 0.0, 2000.0)
    assert a == b
    assert (a.ra, a.dec, a.size, a.wl_min) == (10.123457, 20.0, 120.0, 1.0)
    # A different target or a real change of position is a different stack.
    assert StackRequest.normalised(10.12347, 20.0, 120.0, 1.0, None, 0.0, 0.0, 2000.0) != b
    t = find_target("wise-0855")
    moved = StackRequest.normalised(t.ra + 1e-4, t.dec, 120.0, 4.4, 5.0, t.pmra, t.pmdec, t.epoch, t.parallax)
    assert moved.ra != t.ra


def test_site_shaped_stack_request_in_mock_mode(client):
    t = find_target("wise-0855")
    params = {
        "ra": _site_trim(t.ra, 7),
        "dec": t.dec,
        "wl_min": 4.4,
        "wl_max": 5,
        "pmra": t.pmra,
        "pmdec": t.pmdec,
        "parallax": 439,
    }
    body = client.get("/api/stack", params=params).json()
    assert body["ra"] == t.ra and body["parallax"] == t.parallax
    assert "ra=133.81890825" in body["tracked"]["image_url"]  # image addresses use the canonical form
