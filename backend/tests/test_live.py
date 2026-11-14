"""Live mode. Only the last test uses the network, and only when SM_RUN_LIVE=1."""

import os

import pytest

from app.live import cloud_url

needs_network = pytest.mark.skipif(
    os.environ.get("SM_RUN_LIVE") != "1", reason="set SM_RUN_LIVE=1 to run tests that call the archive"
)


def test_unbuilt_live_endpoints_answer_501(live_client):
    assert live_client.get("/api/health").json()["mode"] == "live"
    assert live_client.get("/api/frames", params={"ra": 10, "dec": 20}).status_code == 501
    assert live_client.get("/api/photometry", params={"ra": 10, "dec": 20}).status_code == 501
    params = {"exposure_id": "x", "ra": 10, "dec": 20}
    assert live_client.get("/api/frame.png", params=params).status_code == 501


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
