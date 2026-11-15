"""Real SPHEREx data (SM_MODE=live). Needs the `live` extra and network access.

The exposure search. Patches, stacks and photometry build on it (live_frames.py and
others); the recipe is in docs/ARCHITECTURE.md ("The live data path").

The astronomy libraries are imported inside the functions so that mock mode starts
without them.
"""

import json
import math
import re
import threading
import time
from dataclasses import dataclass

from .config import Settings

_BANDPASS = re.compile(r"D([1-6])$")


class LiveDependencyMissing(RuntimeError):
    """The `live` extra is not installed."""


@dataclass(frozen=True)
class LiveExposure:
    exposure_id: str
    obs_id: str
    collection: str
    detector: int
    bandpass: str
    mjd: float
    exptime_s: float | None
    wl_min_um: float
    wl_max_um: float
    access_url: str | None
    cloud_url: str | None


def _number(value: object) -> float | None:
    """A plain float, or None for missing (masked or not-a-number) table values."""
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text and text not in {"--", "None", "nan"} else None


def cloud_url(cloud_access: str | None) -> str | None:
    """Address of a file on the AWS mirror, from the archive's `cloud_access` field."""
    if not cloud_access:
        return None
    try:
        aws = json.loads(cloud_access)["aws"]
        return f"https://{aws['bucket_name']}.s3.{aws['region']}.amazonaws.com/{aws['key']}"
    except (ValueError, KeyError, TypeError):
        return None


def _require_pyvo():
    try:
        import pyvo
    except ImportError as error:
        raise LiveDependencyMissing(
            'Live mode needs extra packages. Run: python -m pip install -e ".[dev,live]"'
        ) from error
    return pyvo


_sessions: dict[tuple[float, int, float], object] = {}
_sessions_lock = threading.Lock()


def _irsa_session(settings: Settings):
    """The shared HTTP session for IRSA: PyVO's user agent, a timeout, and retries on short outages.

    Retries: up to `irsa_retries` more tries on connection errors and on HTTP 429, 500,
    502, 503 and 504, with a pause of `irsa_backoff_s`, then twice that (at most 30 s). A
    stalled answer counts once at most, so one search waits at most about two timeouts.
    The archive's Retry-After header is ignored: it may ask for hours, and the caller holds
    a lock meanwhile. One session per setting combination is kept and reused (connection
    reuse); requests sessions can be shared between threads for these reads.
    """
    import pyvo.utils.http
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry

    retries = max(0, settings.irsa_retries)
    config = (float(settings.irsa_timeout_s), retries, float(settings.irsa_backoff_s))
    with _sessions_lock:
        session = _sessions.get(config)
        if session is not None:
            return session

        timeout = (10.0, config[0])  # (connect, wait for the next bytes)

        class _TimeoutAdapter(HTTPAdapter):
            def send(self, request, **kwargs):
                if kwargs.get("timeout") is None:
                    kwargs["timeout"] = timeout
                return super().send(request, **kwargs)

        retry = Retry(
            total=retries,
            connect=retries,
            read=min(1, retries),
            status=retries,
            backoff_factor=config[2],
            backoff_max=30.0,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=("GET", "POST"),  # searches only read, so repeating them is safe
            respect_retry_after_header=False,
            raise_on_status=False,  # after the last try, pyvo reports the archive's own error
        )
        session = pyvo.utils.http.create_session()  # keeps PyVO's User-Agent
        adapter = _TimeoutAdapter(max_retries=retry)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        _sessions[config] = session
        return session


class ArchiveSearchFailed(RuntimeError):
    """The archive search request failed after its retries, or IRSA is in its cooldown."""


# After an outage-like failure, searches fail at once until this time (time.monotonic()).
_down_until = 0.0
_down_lock = threading.Lock()


def reset_cooldown() -> None:
    global _down_until
    with _down_lock:
        _down_until = 0.0


def _status_code(error: BaseException) -> int | None:
    code = getattr(error, "code", None)
    if isinstance(code, int):
        return code
    response = getattr(error, "response", None)
    status = getattr(response, "status_code", None)
    return status if isinstance(status, int) else None


def is_outage(error: BaseException) -> bool:
    """True if the failure says IRSA is down or overloaded (no answer, HTTP 429 or 5xx),
    not that our request was wrong (other 4xx answers)."""
    import requests

    seen: BaseException | None = error
    while seen is not None:
        status = _status_code(seen)
        if status is not None:
            return status == 429 or status >= 500
        if isinstance(seen, (requests.exceptions.RequestException, TimeoutError, ConnectionError)):
            return True
        seen = seen.__cause__ or seen.__context__
    return False


def _rows_to_exposures(table, collections: list[str]) -> list[LiveExposure]:
    """Rows of an SIA answer as exposures. An exposure listed by two collections is kept
    once, from the collection listed first in the settings."""
    names = set(table.colnames)
    rank = {c: i for i, c in enumerate(collections)}
    by_lower = {c.lower(): c for c in collections}
    best: dict[str, tuple[int, LiveExposure]] = {}
    for row in table:
        bandpass = _text(row["energy_bandpassname"]) or ""
        match = _BANDPASS.search(bandpass)
        obs_id = _text(row["obs_id"])
        t_min, t_max = _number(row["t_min"]), _number(row["t_max"])
        em_min, em_max = _number(row["em_min"]), _number(row["em_max"])
        if match is None or obs_id is None or None in (t_min, t_max, em_min, em_max):
            continue  # not a detector image we know how to use
        # The archive labels rows with the collection names it was asked for (checked on
        # 2026-11-15); compare without case to be safe. Unknown labels rank last.
        label = _text(row["obs_collection"]) if "obs_collection" in names else None
        collection = by_lower.get(label.lower(), label) if label else collections[0]
        detector = int(match.group(1))
        exposure = LiveExposure(
            exposure_id=f"{obs_id}-D{detector}",
            obs_id=obs_id,
            collection=collection,
            detector=detector,
            bandpass=bandpass,
            mjd=(t_min + t_max) / 2.0,
            exptime_s=_number(row["t_exptime"]) if "t_exptime" in names else None,
            wl_min_um=em_min * 1e6,  # the archive gives metres
            wl_max_um=em_max * 1e6,
            access_url=_text(row["access_url"]) if "access_url" in names else None,
            cloud_url=cloud_url(_text(row["cloud_access"])) if "cloud_access" in names else None,
        )
        priority = rank.get(collection, len(collections))
        kept = best.get(exposure.exposure_id)
        if kept is None or priority < kept[0]:
            best[exposure.exposure_id] = (priority, exposure)
    return [exposure for _, exposure in best.values()]


def search_exposures(
    settings: Settings, ra: float, dec: float, radius: float
) -> tuple[list[LiveExposure], list[str]]:
    """Exposures covering a position, across every configured collection, sorted by time.

    One SIA request names every collection (measured on 2026-11-15: the same rows as one
    request per collection, in the same time). The service's capabilities are not fetched
    first (`check_baseurl=False`), so a search is one request, retried on IRSA's short
    outages. Raises ArchiveSearchFailed when the request still fails; after an outage-like
    failure, searches fail at once for `irsa_cooldown_s` seconds. The second value is
    for warnings and is empty here; callers and tests also use it for partial failures.
    """
    global _down_until
    pyvo = _require_pyvo()
    collections = list(settings.collections)
    wait = _down_until - time.monotonic()
    if wait > 0:
        raise ArchiveSearchFailed(
            f"Search of {', '.join(collections)} failed: IRSA did not answer a search in the last "
            f"{settings.irsa_cooldown_s:.0f} s, so it is not asked again for {wait:.0f} s."
        )
    try:
        service = pyvo.dal.SIA2Service(settings.sia_url, session=_irsa_session(settings), check_baseurl=False)
        wanted = collections if len(collections) > 1 else collections[0]
        table = service.search(pos=(ra, dec, radius), collection=wanted).to_table()
        found = _rows_to_exposures(table, collections)  # inside: a malformed answer is a failure too
    except Exception as error:  # noqa: BLE001 - reported to the caller as one clear failure
        if settings.irsa_cooldown_s > 0 and is_outage(error):
            with _down_lock:
                _down_until = time.monotonic() + settings.irsa_cooldown_s
        raise ArchiveSearchFailed(
            f"Search of {', '.join(collections)} failed: {type(error).__name__}: {error}"[:400]
        ) from error
    reset_cooldown()
    return sorted(found, key=lambda e: e.mjd), []
