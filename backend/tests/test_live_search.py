"""The archive search (live.search_exposures) and its HTTP session, offline."""

import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

pytest.importorskip("pyvo")
pytest.importorskip("requests")

import pyvo  # noqa: E402
import requests  # noqa: E402
from astropy.table import Table  # noqa: E402

from app import live  # noqa: E402
from app.config import Settings  # noqa: E402

COLLECTIONS = ["spherex_dr1", "spherex_qr3", "spherex_dr1_deep", "spherex_qr3_deep"]


def _row(obs_id: str, collection: str, mjd: float, detector: int = 6) -> dict:
    return {
        "obs_id": obs_id,
        "obs_collection": collection,
        "energy_bandpassname": f"SPHEREx-D{detector}",
        "t_min": mjd - 0.001,
        "t_max": mjd + 0.001,
        "t_exptime": 112.0,
        "em_min": 4.4e-6,
        "em_max": 5.0e-6,
        "access_url": f"https://example.org/{obs_id}.fits",
        "cloud_access": "",
    }


class _FakeService:
    calls: list[dict] = []
    rows: list[dict] = []
    error: Exception | None = None

    def __init__(self, baseurl, **kwargs):
        _FakeService.calls.append({"baseurl": baseurl, **kwargs})

    def search(self, pos=None, **kwargs):
        _FakeService.calls[-1]["search"] = {"pos": pos, **kwargs}
        if _FakeService.error is not None:
            raise _FakeService.error
        rows = _FakeService.rows

        class _Result:
            def to_table(self):
                return Table(rows=rows) if rows else Table(names=list(_row("x", "y", 0)), dtype=[str] * 10)

        return _Result()


@pytest.fixture
def fake_sia(monkeypatch):
    _FakeService.calls, _FakeService.rows, _FakeService.error = [], [], None
    monkeypatch.setattr(pyvo.dal, "SIA2Service", _FakeService)
    return _FakeService


def _settings(**overrides) -> Settings:
    return Settings(**{"mode": "live", "collections": COLLECTIONS, "_env_file": None, **overrides})


def test_one_request_for_every_collection_without_capabilities(fake_sia):
    fake_sia.rows = [_row("2025W02_1A_0001_1", "spherex_dr1", 60802.0)]
    live.search_exposures(_settings(), 10.0, 20.0, 0.005)
    assert len(fake_sia.calls) == 1
    call = fake_sia.calls[0]
    assert call["check_baseurl"] is False
    assert isinstance(call["session"], requests.Session)
    assert call["search"]["collection"] == COLLECTIONS
    assert call["search"]["pos"] == (10.0, 20.0, 0.005)


def test_rows_sorted_by_time_and_duplicates_kept_from_the_first_collection(fake_sia):
    fake_sia.rows = [
        _row("2025W03_1A_0001_1", "spherex_qr3", 60803.0),
        _row("2025W01_1A_0001_1", "spherex_qr3", 60801.0),
        _row("2025W01_1A_0001_1", "spherex_dr1", 60801.0),  # same exposure in two collections
        _row("2025W02_1A_0001_1", "spherex_dr1_deep", 60802.0),
    ]
    found, warnings = live.search_exposures(_settings(), 10.0, 20.0, 0.005)
    assert warnings == []
    assert [e.exposure_id for e in found] == [
        "2025W01_1A_0001_1-D6",
        "2025W02_1A_0001_1-D6",
        "2025W03_1A_0001_1-D6",
    ]
    assert [e.collection for e in found] == ["spherex_dr1", "spherex_dr1_deep", "spherex_qr3"]
    assert found[0].wl_min_um == pytest.approx(4.4)


def test_failed_search_raises_one_clear_error(fake_sia):
    fake_sia.error = pyvo.dal.DALServiceError("502 Server Error: Proxy Error")
    with pytest.raises(live.ArchiveSearchFailed) as raised:
        live.search_exposures(_settings(), 10.0, 20.0, 0.005)
    message = str(raised.value)
    assert message.startswith("Search of spherex_dr1, spherex_qr3")
    assert "failed:" in message and "502" in message


def test_single_collection_is_sent_as_a_name(fake_sia):
    live.search_exposures(_settings(collections=["spherex_dr1"]), 10.0, 20.0, 0.005)
    assert fake_sia.calls[0]["search"]["collection"] == "spherex_dr1"


# --- the HTTP session: retries and timeout, against a local server ------------------------


class _Server:
    def __init__(self, plan):
        self.hits = 0
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802 - name required by http.server
                outer.hits += 1
                status, delay = plan(outer.hits)
                time.sleep(delay)
                body = b"ok"
                self.send_response(status)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}/SIA"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


def test_session_retries_a_502_then_succeeds():
    server = _Server(lambda hit: (502, 0) if hit == 1 else (200, 0))
    try:
        with live._irsa_session(_settings(irsa_backoff_s=0.0)) as session:
            response = session.get(server.url)
        assert response.status_code == 200
        assert server.hits == 2
    finally:
        server.close()


def test_session_gives_up_after_its_retries():
    server = _Server(lambda hit: (502, 0))
    try:
        with live._irsa_session(_settings(irsa_backoff_s=0.0, irsa_retries=2)) as session:
            response = session.get(server.url)
        assert response.status_code == 502  # the archive's own answer, for pyvo to report
        assert server.hits == 3
    finally:
        server.close()


def test_session_times_out_a_stalled_answer():
    server = _Server(lambda hit: (200, 2.0))
    try:
        started = time.monotonic()
        with live._irsa_session(_settings(irsa_timeout_s=0.2, irsa_retries=0)) as session:
            with pytest.raises(requests.exceptions.RequestException):
                session.get(server.url)
        assert time.monotonic() - started < 1.5
    finally:
        server.close()
