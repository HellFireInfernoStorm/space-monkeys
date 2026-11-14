"""Real SPHEREx data (SM_MODE=live). Needs the `live` extra and network access.

Built so far: the exposure search. Image cutouts and photometry are next; the recipe is
in docs/ARCHITECTURE.md ("The live data path").

The astronomy libraries are imported inside the functions so that mock mode starts
without them.
"""

import json
import math
import re
from concurrent.futures import ThreadPoolExecutor
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


def _search_one(sia_url: str, collection: str, ra: float, dec: float, radius: float) -> list[LiveExposure]:
    try:
        import pyvo
    except ImportError as error:
        raise LiveDependencyMissing(
            'Live mode needs extra packages. Run: python -m pip install -e ".[dev,live]"'
        ) from error

    table = pyvo.dal.SIA2Service(sia_url).search(pos=(ra, dec, radius), collection=collection).to_table()
    names = set(table.colnames)
    out: list[LiveExposure] = []
    for row in table:
        bandpass = _text(row["energy_bandpassname"]) or ""
        match = _BANDPASS.search(bandpass)
        obs_id = _text(row["obs_id"])
        t_min, t_max = _number(row["t_min"]), _number(row["t_max"])
        em_min, em_max = _number(row["em_min"]), _number(row["em_max"])
        if match is None or obs_id is None or None in (t_min, t_max, em_min, em_max):
            continue  # not a detector image we know how to use
        detector = int(match.group(1))
        out.append(
            LiveExposure(
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
        )
    return out


def search_exposures(
    settings: Settings, ra: float, dec: float, radius: float
) -> tuple[list[LiveExposure], list[str]]:
    """Exposures covering a position, across every configured collection, sorted by time.

    One query per collection, in parallel. A collection that fails is reported in the
    returned warnings and the others still count. An exposure present in two collections
    is kept once, from the collection listed first in the settings.
    """
    collections = settings.collections
    workers = max(1, min(len(collections), settings.irsa_concurrency))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {c: pool.submit(_search_one, settings.sia_url, c, ra, dec, radius) for c in collections}

    found: dict[str, LiveExposure] = {}
    warnings: list[str] = []
    for collection in collections:
        try:
            rows = futures[collection].result()
        except LiveDependencyMissing:
            raise
        except Exception as error:  # noqa: BLE001 - one bad collection must not sink the rest
            warnings.append(f"Search of {collection} failed: {type(error).__name__}: {error}"[:300])
            continue
        for exposure in rows:
            found.setdefault(exposure.exposure_id, exposure)
    return sorted(found.values(), key=lambda e: e.mjd), warnings
