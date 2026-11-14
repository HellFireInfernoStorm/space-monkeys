"""One request form for stacks, so that the site's links hit the stacks scripts/prewarm.py built."""

from app import stack_service
from app.config import Settings
from app.targets import find_target

StackRequest = stack_service.StackRequest


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
