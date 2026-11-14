"""Live frames without the network: a small synthetic SPHEREx-like file stands in for the archive.

The file has a rotated and mirrored sky coordinate system (as real detector images do),
a star at a known position, two neighbours 30 arcseconds north and east of it, a flags
image, and a `WCS-WAVE` wavelength table that changes differently along x and y, so a
mix-up of the two axes would show.
"""

import math
import warnings

import numpy as np
import pytest

astropy = pytest.importorskip("astropy")
from astropy.io import fits  # noqa: E402
from astropy.wcs import WCS  # noqa: E402

from app import live, live_frames  # noqa: E402
from app import models as m  # noqa: E402
from app.cache import Cache  # noqa: E402
from app.config import PIXEL_SCALE_ARCSEC, Settings, get_settings  # noqa: E402
from app.live import LiveExposure  # noqa: E402
from app.main import app  # noqa: E402
from app.pixels import probe, read_patch  # noqa: E402
from app.resample import bilinear, grid_offsets, sky_to_tangent, tangent_to_sky, wavelength_at  # noqa: E402

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
SIZE = 200  # detector pixels on a side
STAR_RA, STAR_DEC = 150.0, 20.0
ROTATION_DEG = 30.0
TABLE_NODES = np.arange(9) * 25 + 1  # 1-based pixel positions of the table nodes


def _table_wavelength(fits_x, fits_y):
    """Wavelength in the synthetic table, by 1-based pixel position: changes faster along x."""
    return 4.0 + 0.004 * fits_x + 0.001 * fits_y


def _header() -> fits.Header:
    scale = PIXEL_SCALE_ARCSEC / 3600.0
    c, s = math.cos(math.radians(ROTATION_DEG)), math.sin(math.radians(ROTATION_DEG))
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [STAR_RA + 0.01, STAR_DEC - 0.01]  # star is off the reference point
    w.wcs.crpix = [SIZE / 2 + 0.5, SIZE / 2 + 0.5]
    # Rotated by 30 degrees, and with x running east (mirrored compared with the sky view).
    w.wcs.cd = np.array([[c, -s], [s, c]]) @ np.diag([scale, scale])
    header = w.to_header()
    header["EXTNAME"] = "IMAGE"
    header["BUNIT"] = "MJy / sr"
    # The spectral coordinate system, as in real files (alternate key W, lookup table).
    for key, value in {
        "WCSAXESW": 2,
        "CTYPE1W": "WAVE-TAB",
        "CTYPE2W": "WAVE-TAB",
        "CUNIT1W": "um",
        "CUNIT2W": "um",
        "CRPIX1W": 1,
        "CRPIX2W": 1,
        "CDELT1W": 1,
        "CDELT2W": 1,
        "CRVAL1W": 1,
        "CRVAL2W": 1,
        "PV1_3W": 1,
        "PV2_3W": 2,
        "PS1_0W": "WCS-WAVE",
        "PS2_0W": "WCS-WAVE",
        "PS1_1W": "VALUES",
        "PS2_1W": "VALUES",
        "PS1_2W": "X",
        "PS2_2W": "Y",
    }.items():
        header[key] = value
    return header


def _gaussian(x0: float, y0: float, peak: float) -> np.ndarray:
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    return peak * np.exp(-((xx - x0) ** 2 + (yy - y0) ** 2) / (2 * 0.8**2))


def make_fits(path) -> dict:
    """Write the synthetic file; returns facts the tests check against."""
    header = _header()
    wcs = WCS(header)
    cos_dec = math.cos(math.radians(STAR_DEC))
    stars = {
        "centre": (STAR_RA, STAR_DEC, 100.0),
        "north": (STAR_RA, STAR_DEC + 30.0 / 3600.0, 50.0),
        "east": (STAR_RA + 30.0 / 3600.0 / cos_dec, STAR_DEC, 25.0),
    }
    image = np.full((SIZE, SIZE), 3.0)  # a flat "zodiacal light" level
    flags = np.zeros((SIZE, SIZE), dtype=np.int32)
    pixels = {}
    for name, (ra, dec, peak) in stars.items():
        x, y = (float(v) for v in wcs.all_world2pix(ra, dec, 0))
        pixels[name] = (x, y)
        image += _gaussian(x, y, peak)
        flags[round(y) - 1 : round(y) + 2, round(x) - 1 : round(x) + 2] |= 1 << 21  # SOURCE: keep
    # A hot pixel (bit 10, HOT) 4 pixels from the star: must be masked.
    sx, sy = pixels["centre"]
    hot = (round(sy) + 4, round(sx) - 4)
    image[hot] = 1.0e6
    flags[hot] |= 1 << 10

    yy, xx = np.meshgrid(TABLE_NODES, TABLE_NODES, indexing="ij")
    values = np.stack([_table_wavelength(xx, yy), 0.03 + 0 * xx], axis=-1).astype(np.float32)  # (y, x, 2)
    table = fits.BinTableHDU.from_columns(
        [
            fits.Column(name="X", format="9J", dim="(9)", array=TABLE_NODES[None, :]),
            fits.Column(name="Y", format="9J", dim="(9)", array=TABLE_NODES[None, :]),
            fits.Column(name="VALUES", format="162E", dim="(2,9,9)", array=values[None]),
        ],
        name="WCS-WAVE",
    )
    hdus = fits.HDUList(
        [
            fits.PrimaryHDU(),
            fits.ImageHDU(image.astype(np.float32), header=header, name="IMAGE"),
            fits.CompImageHDU(flags, name="FLAGS"),
            table,
        ]
    )
    hdus.writeto(path, overwrite=True)
    return {"pixels": pixels, "hot": hot, "path": str(path)}


@pytest.fixture
def synthetic(tmp_path):
    return make_fits(tmp_path / "synthetic.fits")


# --- geometry ---------------------------------------------------------------------------


def test_tangent_plane_round_trip():
    east, north = np.array([0.0, 100.0, -50.0]), np.array([0.0, 30.0, 400.0])
    ra, dec = tangent_to_sky(150.0, 20.0, east, north)
    back_e, back_n = sky_to_tangent(150.0, 20.0, ra, dec)
    assert np.allclose(back_e, east, atol=1e-6) and np.allclose(back_n, north, atol=1e-6)
    assert ra[1] > 150.0  # east is larger right ascension
    assert dec[2] > 20.0


def test_grid_is_north_up_east_left():
    east, north = grid_offsets(4, 1.0)
    assert east[0, 0] > 0 and east[0, -1] < 0  # column 0 is east
    assert north[0, 0] > 0 and north[-1, 0] < 0  # row 0 is north


def test_bilinear_skips_masked_pixels():
    image = np.array([[1.0, 1.0], [1.0, np.nan]])
    assert bilinear(image, np.array([0.5]), np.array([0.5]))[0] == pytest.approx(1.0)
    assert np.isnan(bilinear(image, np.array([5.0]), np.array([5.0]))[0])


# --- reading the synthetic file -----------------------------------------------------------


def test_resampled_star_is_centred_north_up_east_left(synthetic):
    n = 21  # odd, so the centre position is the middle of pixel (10, 10)
    patch = read_patch(synthetic["path"], STAR_RA, STAR_DEC, n, PIXEL_SCALE_ARCSEC)
    assert patch is not None
    image = patch.image
    assert np.unravel_index(np.nanargmax(image), image.shape) == (10, 10)
    offset = 30.0 / PIXEL_SCALE_ARCSEC  # 4.9 pixels
    north = image[: 10 - 2, 8:13]
    row, col = np.unravel_index(np.nanargmax(north), north.shape)
    assert (row, col + 8) == (round(10 - offset), 10)  # above the star
    east = image[8:13, : 10 - 2]
    row, col = np.unravel_index(np.nanargmax(east), east.shape)
    assert (row + 8, col) == (10, round(10 - offset))  # left of the star


def test_mask_drops_bad_pixels_but_keeps_known_sources(synthetic):
    patch = read_patch(synthetic["path"], STAR_RA, STAR_DEC, 21, PIXEL_SCALE_ARCSEC)
    assert np.isfinite(patch.image[10, 10])  # bit 21 (known source) is not masked
    assert np.nanmax(patch.image) < 1000  # the hot pixel never leaks into the image
    assert np.nanmax(patch.raw) > 1000  # it is still there without the mask
    assert (patch.flags & (1 << 21)).any()


def test_patch_off_the_detector_is_none(synthetic):
    assert read_patch(synthetic["path"], STAR_RA + 5, STAR_DEC, 21, PIXEL_SCALE_ARCSEC) is None
    assert probe(synthetic["path"], STAR_RA + 5, STAR_DEC) is None


def test_wavelength_lookup_matches_astropy(synthetic):
    x, y = synthetic["pixels"]["centre"]
    expected_table = _table_wavelength(x + 1, y + 1)  # linear, so interpolation is exact
    assert probe(synthetic["path"], STAR_RA, STAR_DEC) == pytest.approx(expected_table, abs=1e-4)

    # The same answer as astropy's own lookup-table coordinate system (IRSA tutorial method).
    with fits.open(synthetic["path"]) as hdus, warnings.catch_warnings():
        warnings.simplefilter("ignore")
        spectral = WCS(header=hdus["IMAGE"].header, fobj=hdus, key="W")
        spectral.sip = None
        for px, py in [(x, y), (10.0, 150.0), (150.0, 10.0)]:
            wavelength, _ = spectral.pixel_to_world(px, py)
            table = hdus["WCS-WAVE"].data
            ours, _ = wavelength_at(table["X"][0], table["Y"][0], table["VALUES"][0], px, py)
            assert ours == pytest.approx(wavelength.to_value("um"), abs=1e-5)


# --- cache ------------------------------------------------------------------------------


def _exposure(path, exposure_id="2025W01_1A_0001_1-D6", mjd=60800.0) -> LiveExposure:
    return LiveExposure(
        exposure_id=exposure_id,
        obs_id=exposure_id.split("-")[0],
        collection="test_collection",
        detector=6,
        bandpass="SPHEREx-D6",
        mjd=mjd,
        exptime_s=113.6,
        wl_min_um=4.0,
        wl_max_um=5.2,
        access_url=None,
        cloud_url=path,
    )


def test_cache_round_trip(tmp_path):
    cache = Cache(tmp_path)
    cache.put_arrays("patch", "k", {"image": np.arange(4.0).reshape(2, 2)})
    cache.put_json("probe", "k", {"wavelength": 4.5})
    fresh = Cache(tmp_path)  # a new process: nothing in memory
    assert fresh.get_arrays("patch", "k")["image"][1, 1] == 3.0
    assert fresh.get_json("probe", "k") == {"wavelength": 4.5}
    assert fresh.get_json("probe", "k", max_age_s=-1) is None
    assert fresh.get_json("probe", "missing") is None


def test_patch_is_read_once(synthetic, tmp_path, monkeypatch):
    settings = Settings(mode="live", cache_dir=tmp_path / "cache", _env_file=None)
    calls = []
    real = live_frames.read_patch

    def counting(*args):
        calls.append(args)
        return real(*args)

    monkeypatch.setattr(live_frames, "read_patch", counting)
    exposure = _exposure(synthetic["path"])
    first = live_frames.get_patch(settings, exposure, STAR_RA, STAR_DEC, 21)
    live_frames._cache(settings).clear_memory()  # force the disk copy
    second = live_frames.get_patch(settings, exposure, STAR_RA, STAR_DEC, 21)
    assert len(calls) == 1
    assert np.array_equal(first.image, second.image, equal_nan=True)


# --- the endpoints, offline -------------------------------------------------------------


@pytest.fixture
def offline_live(synthetic, tmp_path, monkeypatch):
    """The API in live mode, with the archive search answered by three synthetic exposures."""
    settings = Settings(mode="live", cache_dir=tmp_path / "cache", max_frames=40, _env_file=None)
    exposures = [_exposure(synthetic["path"], f"2025W0{i}_1A_0001_1-D6", 60800.0 + 30 * i) for i in (1, 2, 3)]
    searches = []

    def fake_search(_settings, ra, dec, radius):
        searches.append((ra, dec))
        return list(exposures), []

    reads = []
    real_read = live_frames.read_patch

    def counting_read(*args):
        reads.append(args)
        return real_read(*args)

    monkeypatch.setattr(live, "search_exposures", fake_search)
    monkeypatch.setattr(live_frames, "read_patch", counting_read)
    app.dependency_overrides[get_settings] = lambda: settings
    from fastapi.testclient import TestClient

    try:
        yield TestClient(app), settings, searches, reads
    finally:
        app.dependency_overrides.clear()


def test_live_frames_have_the_mock_shape_and_work(offline_live):
    live_client, _settings, _searches, reads = offline_live
    params = {"ra": STAR_RA, "dec": STAR_DEC, "size": 120, "wl_min": 4.0, "wl_max": 5.0}
    body = live_client.get("/api/frames", params=params).json()
    assert body["mode"] == "live"
    assert set(body) == set(m.FrameList.model_fields)
    assert set(body["frames"][0]) == set(m.Frame.model_fields)
    assert body["returned"] == 3 and body["capped"] is False
    for frame in body["frames"]:
        assert 4.0 <= frame["wavelength_um"] <= 5.0
        png = live_client.get(frame["image_url"])
        assert png.status_code == 200 and png.content.startswith(PNG_SIGNATURE)
    diff_url = body["frames"][1]["image_url"] + "&diff_ref=" + body["frames"][0]["exposure_id"]
    assert live_client.get(diff_url).content.startswith(PNG_SIGNATURE)
    assert len(reads) == 3  # the difference reused the cached patches

    # A second identical request reads no pixels.
    live_frames._cache(_settings).clear_memory()
    again = live_client.get("/api/frames", params=params).json()
    assert again == body
    for frame in again["frames"]:
        assert live_client.get(frame["image_url"]).status_code == 200
    assert len(reads) == 3


def test_live_frames_filter_by_wavelength_at_the_target(offline_live, synthetic):
    live_client, *_ = offline_live
    x, y = synthetic["pixels"]["centre"]
    at_star = _table_wavelength(x + 1, y + 1)
    params = {"ra": STAR_RA, "dec": STAR_DEC, "wl_min": at_star + 0.01, "wl_max": 5.0}
    body = live_client.get("/api/frames", params=params).json()
    assert body["total"] == 0 and body["frames"] == []  # empty, well formed, not an error
    params["wl_min"] = at_star - 0.01
    assert live_client.get("/api/frames", params=params).json()["total"] == 3


def test_live_frames_cap_and_tracking(offline_live, monkeypatch):
    live_client, settings, *_ = offline_live
    monkeypatch.setattr(settings, "max_frames", 2)
    params = {"ra": STAR_RA, "dec": STAR_DEC, "pmra": 1000.0, "pmdec": 1000.0, "epoch": 2025.3}
    body = live_client.get("/api/frames", params=params).json()
    assert body["returned"] == 2 and body["total"] == 3 and body["capped"] is True
    assert len({(f["center_ra"], f["center_dec"]) for f in body["frames"]}) == 1
    tracked = live_client.get("/api/frames", params={**params, "track": "true"}).json()["frames"]
    assert len({(f["center_ra"], f["center_dec"]) for f in tracked}) == 2


def test_unreadable_exposure_is_skipped(offline_live, tmp_path, monkeypatch):
    live_client, *_ = offline_live
    broken = _exposure(str(tmp_path / "missing.fits"), "2025W09_1A_0001_1-D6", 60900.0)
    original = live.search_exposures

    def with_broken(*args):
        found, warnings = original(*args)
        return [*found, broken], warnings

    monkeypatch.setattr(live, "search_exposures", with_broken)
    body = live_client.get("/api/frames", params={"ra": STAR_RA, "dec": STAR_DEC}).json()
    assert body["returned"] == 3
    assert any("could not be read" in w for w in body["warnings"])


def test_search_failure_is_a_clear_error(offline_live, monkeypatch):
    live_client, settings, *_ = offline_live

    def failing(_settings, ra, dec, radius):
        return [], [f"Search of {c} failed: ConnectionError" for c in settings.collections]

    monkeypatch.setattr(live, "search_exposures", failing)
    response = live_client.get("/api/frames", params={"ra": 10, "dec": 20})
    assert response.status_code == 502
    assert "search failed" in response.json()["detail"]


def test_unknown_exposure_in_live_mode(offline_live):
    live_client, *_ = offline_live
    params = {"exposure_id": "nope", "ra": 10, "dec": 20}
    assert live_client.get("/api/frame.png", params=params).status_code == 404
