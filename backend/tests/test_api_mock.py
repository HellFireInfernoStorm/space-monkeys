PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

WISE = {"ra": 133.81890825, "dec": -7.247048, "pmra": -8123.7, "pmdec": 673.2, "epoch": 2000.0}


def test_health_reports_mock_mode(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["mode"] == "mock"
    assert len(body["collections"]) >= 1


def test_bands(client):
    bands = client.get("/api/bands").json()["bands"]
    assert [b["band"] for b in bands] == [1, 2, 3, 4, 5, 6]
    assert bands[0]["wl_min_um"] == 0.75
    assert bands[5]["wl_max_um"] == 5.0


def test_five_targets(client):
    body = client.get("/api/targets").json()
    assert {t["id"] for t in body["targets"]} == {"barnard", "eps-ind-b", "wise-0855", "rw-aur", "r-dra"}


def test_resolve_ignores_case_and_punctuation(client):
    assert client.get("/api/resolve", params={"name": "barnards star"}).json()["target"]["id"] == "barnard"
    assert client.get("/api/resolve", params={"name": "WISE-0855"}).json()["target"]["id"] == "wise-0855"
    assert client.get("/api/resolve", params={"name": "Vega"}).status_code == 404


def test_exposures_cap(client):
    body = client.get("/api/exposures", params={"ra": 10, "dec": 20, "max": 10}).json()
    assert body["mode"] == "mock"
    assert body["total"] == 72
    assert body["returned"] == 10
    assert body["capped"] is True
    mjds = [e["mjd"] for e in body["exposures"]]
    assert mjds == sorted(mjds)


def test_exposures_follow_proper_motion(client):
    body = client.get("/api/exposures", params=WISE).json()
    first, last = body["exposures"][0], body["exposures"][-1]
    assert first["target_ra"] > last["target_ra"]  # moving west
    assert abs(first["target_ra"] - 133.76) < 0.01  # near the 2026 position, not the 2000 one


def test_exposures_reject_bad_coordinates(client):
    assert client.get("/api/exposures", params={"ra": 400, "dec": 0}).status_code == 422
    assert client.get("/api/exposures", params={"ra": 10, "dec": -91}).status_code == 422


def test_frames_wavelength_filter(client):
    params = {"ra": 10, "dec": 20, "wl_min": 4.42, "wl_max": 5.0}
    body = client.get("/api/frames", params=params).json()
    assert body["total"] == 12
    assert all(4.42 <= f["wavelength_um"] <= 5.0 for f in body["frames"])
    assert all(f["image_url"].startswith("/api/frame.png?") for f in body["frames"])


def test_frames_fixed_centre_and_tracking(client):
    fixed = client.get("/api/frames", params=WISE).json()["frames"]
    assert len({(f["center_ra"], f["center_dec"]) for f in fixed}) == 1
    assert len({(f["target_ra"], f["target_dec"]) for f in fixed}) > 1

    tracked = client.get("/api/frames", params={**WISE, "track": "true"}).json()["frames"]
    assert all(f["center_ra"] == f["target_ra"] and f["center_dec"] == f["target_dec"] for f in tracked)


def test_frame_png_is_a_png_and_repeatable(client):
    frame = client.get("/api/frames", params={"ra": 269.4463, "dec": 4.7682}).json()["frames"][0]
    first = client.get(frame["image_url"])
    second = client.get(frame["image_url"])
    assert first.status_code == 200
    assert first.headers["content-type"] == "image/png"
    assert first.content.startswith(PNG_SIGNATURE)
    assert first.content == second.content


def test_difference_frame(client):
    frames = client.get("/api/frames", params={"ra": 10, "dec": 20, "wl_min": 4.42}).json()["frames"]
    url = frames[1]["image_url"] + "&diff_ref=" + frames[0]["exposure_id"]
    plain = client.get(frames[1]["image_url"])
    diff = client.get(url)
    assert diff.status_code == 200
    assert diff.content.startswith(PNG_SIGNATURE)
    assert diff.content != plain.content


def test_frame_png_unknown_exposure(client):
    params = {"exposure_id": "nope", "ra": 10, "dec": 20}
    assert client.get("/api/frame.png", params=params).status_code == 404


def test_photometry_shape(client):
    body = client.get("/api/photometry", params={"ra": 248.1676, "dec": 66.755}).json()
    assert body["flux_unit"] == "uJy"
    assert body["returned"] == 72
    point = body["points"][0]
    assert set(point) == {
        "exposure_id",
        "obs_id",
        "det_id",
        "mjd",
        "wavelength",
        "lambda_width",
        "flux",
        "flux_err",
        "flags",
    }
