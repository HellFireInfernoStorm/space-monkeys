"""One request form for stacks, so that the site's links hit the stacks scripts/prewarm.py built."""

from app import stack_service
from app.config import Settings
from app.targets import find_target

StackRequest = stack_service.StackRequest


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
        east, north = sky_to_tangent(ra, dec, np.array([133.7582]), np.array([-7.2412]))
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
