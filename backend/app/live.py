"""Real SPHEREx data (SM_MODE=live). Needs the `live` extra and network access.

The exposure search. Patches, stacks and photometry build on it (live_frames.py and
others); the recipe is in docs/ARCHITECTURE.md ("The live data path").

The astronomy libraries are imported inside the functions so that mock mode starts
without them.
"""

import json
import math
import re
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


def _irsa_session(settings: Settings):
    """An HTTP session for IRSA with a timeout and retries on its short outages.

    Retries: up to `irsa_retries` more tries on connection errors and on HTTP 429, 500,
    502, 503 and 504, with a pause of `irsa_backoff_s`, then twice that, and so on. A stalled
    answer counts once at most, so one search waits at most about two timeouts.
    """
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry

    timeout = (10.0, settings.irsa_timeout_s)  # (connect, wait for the next bytes)

    class _TimeoutAdapter(HTTPAdapter):
        def send(self, request, **kwargs):
            if kwargs.get("timeout") is None:
                kwargs["timeout"] = timeout
            return super().send(request, **kwargs)

    retries = max(0, settings.irsa_retries)
    retry = Retry(
        total=retries,
        connect=retries,
        read=min(1, retries),
        status=retries,
        backoff_factor=settings.irsa_backoff_s,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET", "POST"),  # searches only read, so repeating them is safe
        respect_retry_after_header=True,
        raise_on_status=False,  # after the last try, pyvo reports the archive's own error
    )
    session = requests.Session()
    adapter = _TimeoutAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


class ArchiveSearchFailed(RuntimeError):
    """The archive search request failed after its retries."""


def _rows_to_exposures(table, collections: list[str]) -> list[LiveExposure]:
    """Rows of an SIA answer as exposures. An exposure listed by two collections is kept
    once, from the collection listed first in the settings."""
    names = set(table.colnames)
    rank = {c: i for i, c in enumerate(collections)}
    best: dict[str, tuple[int, LiveExposure]] = {}
    for row in table:
        bandpass = _text(row["energy_bandpassname"]) or ""
        match = _BANDPASS.search(bandpass)
        obs_id = _text(row["obs_id"])
        t_min, t_max = _number(row["t_min"]), _number(row["t_max"])
        em_min, em_max = _number(row["em_min"]), _number(row["em_max"])
        if match is None or obs_id is None or None in (t_min, t_max, em_min, em_max):
            continue  # not a detector image we know how to use
        collection = (_text(row["obs_collection"]) if "obs_collection" in names else None) or collections[0]
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
    outages. Raises ArchiveSearchFailed when the request still fails. The second value is
    for warnings and is empty here; callers and tests also use it for partial failures.
    """
    pyvo = _require_pyvo()
    collections = list(settings.collections)
    try:
        with _irsa_session(settings) as session:
            service = pyvo.dal.SIA2Service(settings.sia_url, session=session, check_baseurl=False)
            wanted = collections if len(collections) > 1 else collections[0]
            table = service.search(pos=(ra, dec, radius), collection=wanted).to_table()
    except Exception as error:  # noqa: BLE001 - reported to the caller as one clear failure
        raise ArchiveSearchFailed(
            f"Search of {', '.join(collections)} failed: {type(error).__name__}: {error}"[:400]
        ) from error
    found = _rows_to_exposures(table, collections)
    return sorted(found, key=lambda e: e.mjd), []
