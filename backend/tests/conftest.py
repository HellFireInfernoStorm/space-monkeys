import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import app


def _client(mode: str):
    app.dependency_overrides[get_settings] = lambda: Settings(mode=mode, _env_file=None)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def client():
    """The API in mock mode, whatever the developer's own .env says."""
    yield from _client("mock")


@pytest.fixture
def live_client():
    """The API in live mode. Tests using it must not need the network unless marked."""
    yield from _client("live")
