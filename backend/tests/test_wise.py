"""Layer 4: the WISE comparison image. No network: the mirror is replaced by local files."""

import io

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import wise
from app.config import Settings, get_settings
from app.main import app

CENTRE = (10.0, 20.0)


def _tile_file(path, star_east=20.0, star_north=10.0, size=601):
    """A small AllWISE-like tile: SIN projection, 1.375" pixels, north up, east left, with
    one star `star_east` and `star_north` arcseconds from the centre."""
    from astropy.io import fits

    scale = wise.WISE_PIXEL_ARCSEC / 3600.0
    crpix = (size + 1) / 2.0  # FITS pixels are 1-based
    image = np.full((size, size), 5.0, dtype=np.float32)
    # 0-based numpy position of the star: east is towards smaller x, north towards larger y.
    x = crpix - 1 - star_east / wise.WISE_PIXEL_ARCSEC
    y = crpix - 1 + star_north / wise.WISE_PIXEL_ARCSEC
    yy, xx = np.indices(image.shape)
    image += (500.0 * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * 1.5**2))).astype(np.float32)
    header = fits.Header()
    header.update(
        {
            "CTYPE1": "RA---SIN",
            "CTYPE2": "DEC--SIN",
            "CRVAL1": CENTRE[0],
            "CRVAL2": CENTRE[1],
            "CRPIX1": crpix,
            "CRPIX2": crpix,
            "CDELT1": -scale,
            "CDELT2": scale,
            "BUNIT": "DN",
            "WAVELEN": 4.618,
            "DATEOBS1": "2010-05-03T08:45:24.456",
            "DATEOBS2": "2010-11-13T11:18:30.534",
            "MIDOBS": "2010-05-06T08:11:58.322",
            "COADDID": "0100p200_ac51",
        }
    )
    fits.PrimaryHDU(image, header).writeto(path)
    return str(path)


# --- finding the tile ---------------------------------------------------------------------


def test_tile_names_and_addresses():
    assert wise.parse_tile("1342m076_ac51") == (134.2, -7.6)
    assert wise.parse_tile("0000p016_ac51") == (0.0, 1.6)
    with pytest.raises(ValueError):
        wise.parse_tile("not-a-tile")
    url = wise.tile_url(Settings(_env_file=None), "1342m076_ac51", "W2")
    assert url.endswith("/p3am_cdd/13/1342/1342m076_ac51/1342m076_ac51-w2-int-3.fits")
    assert url.startswith(Settings(_env_file=None).wise_bucket_url)


def test_best_tile_is_the_nearest_one_that_covers_the_position():
    tiles = ["1342m076_ac51", "1327m076_ac51", "1336m061_ac51"]
    assert wise.best_tile(tiles, 133.7601, -7.2422) == "1342m076_ac51"  # WISE 0855 today
    assert wise.best_tile(tiles, 140.0, -7.2) is None  # outside every listed tile
    # Across RA 0: a tile at RA 359.8 covers RA 0.1.
    assert wise.best_tile(["3598p000_ac51", "0050p000_ac51"], 0.1, 0.0) == "3598p000_ac51"


def test_find_tile_lists_folders_around_the_position_and_wraps_at_zero(monkeypatch):
    asked = []

    def listing(settings, ra10):
        asked.append(ra10)
        return ["3598p000_ac51"] if ra10 == 3598 else []

    monkeypatch.setattr(wise, "tiles_in_folder", listing)
    assert wise.find_tile(Settings(_env_file=None), 0.1, 0.0) == "3598p000_ac51"
    assert 3598 in asked and 1 in asked and all(0 <= r < 3600 for r in asked)
    with pytest.raises(wise.NoTile):
        wise.find_tile(Settings(_env_file=None), 50.0, 0.0)


# --- reading -------------------------------------------------------------------------------


def test_patch_is_north_up_and_east_left(tmp_path):
    path = _tile_file(tmp_path / "tile.fits", star_east=20.0, star_north=10.0)
    n = 61
    image, facts = wise.read_tile_patch(path, *CENTRE, n)
    row, col = np.unravel_index(np.nanargmax(image), image.shape)
    # Row 0 is north and column 0 is east: the star is left of and above the centre.
    assert col == pytest.approx(n / 2 - 0.5 - 20.0 / wise.WISE_PIXEL_ARCSEC, abs=1)
    assert row == pytest.approx(n / 2 - 0.5 - 10.0 / wise.WISE_PIXEL_ARCSEC, abs=1)
    assert facts["date_mid"] == "2010-05-06T08:11:58.322"
    assert facts["wavelength_um"] == pytest.approx(4.618)
    assert np.isfinite(image).all()


def test_field_beyond_the_tile_edge_is_blank(tmp_path):
    path = _tile_file(tmp_path / "tile.fits", size=101)
    image, _ = wise.read_tile_patch(path, *CENTRE, 219)  # 300" field, 139" tile
    assert 0 < np.isfinite(image).mean() < 0.5


class _FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _serve(monkeypatch, path):
    """Answer range requests from a local file, and count them."""
    blob = open(path, "rb").read()
    requests = []

    def urlopen(request, timeout=None):
        start, end = (int(v) for v in request.headers["Range"].split("=")[1].split("-"))
        requests.append((start, end))
        return _FakeResponse(blob[start : end + 1])

    monkeypatch.setattr(wise.urllib.request, "urlopen", urlopen)
    return requests


def test_remote_header_and_rows_match_the_file(tmp_path, monkeypatch):
    """The header parser and the byte offsets are our own; check them against astropy."""
    from astropy.io import fits

    path = _tile_file(tmp_path / "tile.fits", size=101)
    _serve(monkeypatch, path)
    url = "https://example.invalid/tile.fits"
    header, data_start = wise.remote_header(url)
    with fits.open(path) as hdus:
        assert data_start == hdus[0]._data_offset
        assert header["MIDOBS"] == hdus[0].header["MIDOBS"] and header["NAXIS1"] == 101
        assert np.array_equal(wise.read_rows(url, data_start, 101, 40, 47), hdus[0].data[40:47])


def test_remote_patch_equals_local_patch_in_two_requests(tmp_path, monkeypatch):
    path = _tile_file(tmp_path / "tile.fits")
    local, local_facts = wise.read_tile_patch(path, *CENTRE, 61)
    requests = _serve(monkeypatch, path)
    remote, remote_facts = wise.read_tile_patch("https://example.invalid/tile.fits", *CENTRE, 61)
    assert np.array_equal(local, remote, equal_nan=True) and local_facts == remote_facts
    assert len(requests) == 2  # the header, then the rows


def test_remote_header_without_end_is_an_error(monkeypatch):
    blank = lambda request, timeout=None: _FakeResponse(b" " * 2880)  # noqa: E731
    monkeypatch.setattr(wise.urllib.request, "urlopen", blank)
    with pytest.raises(OSError):
        wise.remote_header("https://example.invalid/tile.fits")


# --- the API -------------------------------------------------------------------------------


def test_mock_wise_shape_and_png(client):
    body = client.get("/api/wise", params={"ra": 133.8189, "dec": -7.247, "size": 300}).json()
    assert body["mode"] == "mock" and body["band"] == "W2"
    assert body["pixels"] == wise.wise_pixels(300) and body["pixel_scale"] == wise.WISE_PIXEL_ARCSEC
    assert body["coverage"] == 1.0
    png = client.get(body["image_url"])
    assert png.status_code == 200 and png.headers["content-type"] == "image/png"
    assert client.get("/api/wise", params={"ra": 10, "dec": 20, "band": "W3"}).status_code == 422


@pytest.fixture
def live_api(tmp_path):
    app.dependency_overrides[get_settings] = lambda: Settings(
        mode="live", cache_dir=tmp_path / "cache", _env_file=None
    )
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_live_wise_reads_the_tile_and_caches(live_api, tmp_path, monkeypatch):
    path = _tile_file(tmp_path / "tile.fits")
    found = []
    monkeypatch.setattr(wise, "find_tile", lambda settings, ra, dec: found.append(1) or "0100p200_ac51")
    monkeypatch.setattr(wise, "tile_url", lambda settings, tile, band: path)
    params = {"ra": CENTRE[0], "dec": CENTRE[1], "size": 60, "band": "W2"}
    body = live_api.get("/api/wise", params=params).json()
    assert body["mode"] == "live" and body["tile"] == "0100p200_ac51"
    assert body["date_start"].startswith("2010-05-03")
    assert body["mjd_mid"] == pytest.approx(55322.34, abs=0.01)
    assert live_api.get(body["image_url"]).status_code == 200
    live_api.get("/api/wise", params=params)
    assert len(found) == 1  # the second request and the image came from the cache


def test_live_wise_errors(live_api, monkeypatch):
    def no_tile(settings, ra, dec):
        raise wise.NoTile("No AllWISE Atlas tile covers it.")

    monkeypatch.setattr(wise, "find_tile", no_tile)
    assert live_api.get("/api/wise", params={"ra": 1, "dec": 2}).status_code == 404

    def offline(settings, ra, dec):
        raise OSError("network down")

    monkeypatch.setattr(wise, "find_tile", offline)
    response = live_api.get("/api/wise", params={"ra": 1, "dec": 2})
    assert response.status_code == 502 and "AllWISE" in response.json()["detail"]
