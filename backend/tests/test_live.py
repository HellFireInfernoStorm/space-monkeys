"""Live mode. Only the last test uses the network, and only when SM_RUN_LIVE=1."""

import os

import pytest

from app.live import cloud_url

needs_network = pytest.mark.skipif(
    os.environ.get("SM_RUN_LIVE") != "1", reason="set SM_RUN_LIVE=1 to run tests that call the archive"
)


def test_health_reports_live_mode(live_client):
    assert live_client.get("/api/health").json()["mode"] == "live"


def test_targets_work_in_live_mode(live_client):
    assert len(live_client.get("/api/targets").json()["targets"]) == 5


def test_cloud_url():
    field = '{"aws": {"bucket_name": "some-bucket", "key": "a/b/c.fits", "region": "us-east-1"}}'
    assert cloud_url(field) == "https://some-bucket.s3.us-east-1.amazonaws.com/a/b/c.fits"
    assert cloud_url(None) is None
    assert cloud_url("not json") is None


@needs_network
def test_live_exposure_search(live_client):
    # WISE 0855, with its proper motion: the server searches at the present-day position.
    params = {"ra": 133.81890825, "dec": -7.247048, "pmra": -8123.7, "pmdec": 673.2, "max": 20}
    body = live_client.get("/api/exposures", params=params).json()
    assert body["mode"] == "live"
    assert body["total"] > 50
    assert body["returned"] == 20
    first = body["exposures"][0]
    assert 1 <= first["detector"] <= 6
    assert 0.7 < first["wl_min_um"] < first["wl_max_um"] < 5.1
    assert first["cloud_url"].startswith("https://")


@needs_network
def test_live_frames_barnards_star(live_client):
    # Barnard's Star at 1.0 to 1.2 micrometres: real patches, wavelength-matched.
    params = {
        "ra": 269.4520769586187,
        "dec": 4.693364966576667,
        "pmra": -801.551,
        "pmdec": 10362.394,
        "wl_min": 1.0,
        "wl_max": 1.2,
        "max": 5,
    }
    body = live_client.get("/api/frames", params=params).json()
    assert body["mode"] == "live"
    assert body["returned"] >= 2
    assert all(1.0 <= f["wavelength_um"] <= 1.2 for f in body["frames"])
    png = live_client.get(body["frames"][0]["image_url"])
    assert png.status_code == 200
    assert png.content.startswith(b"\x89PNG\r\n\x1a\n")
