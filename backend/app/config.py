"""Settings. The only place where data release names and service addresses are written.

Every value can be overridden with an environment variable prefixed ``SM_``
(for example ``SM_MODE=live``) or in ``backend/.env``.
"""

import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Size of one SPHEREx pixel on the sky, in arcseconds (docs/SCIENCE.md, section 1).
PIXEL_SCALE_ARCSEC = 6.15


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SM_", env_file=".env", extra="ignore")

    # "mock": synthetic data, no network. "live": real SPHEREx data.
    mode: Literal["mock", "live"] = "mock"

    # IRSA Simple Image Access service.
    sia_url: str = "https://irsa.ipac.caltech.edu/SIA"

    # Collections searched together. A new data release is one more name here.
    collections: Annotated[list[str], NoDecode] = [
        "spherex_dr1",
        "spherex_qr3",
        "spherex_dr1_deep",
        "spherex_qr3_deep",
    ]

    # AllWISE Atlas images (layer 4), from IRSA's public mirror on AWS. Tiles are found by
    # listing this prefix, so IRSA's own search service is not needed.
    wise_bucket_url: str = "https://nasa-irsa-wise.s3.us-west-2.amazonaws.com"
    wise_atlas_prefix: str = "wise/allwise/images/p3am_cdd"

    search_radius_deg: float = 0.005
    # For objects with proper motion, the archive is searched at the position for this
    # date (decimal year, roughly the middle of the survey so far). Image footprints are
    # degrees wide, so one search position is enough even for the fastest stars.
    search_epoch_year: float = 2026.0
    # Most exposures returned by one request; more than this are sampled evenly in time.
    max_exposures: int = 300
    # Most frames in one /api/frames answer (live mode). More matches are sampled evenly in time.
    max_frames: int = 40
    # Most exposures added together in one /api/stack answer (live mode). Stacks use every
    # matching exposure up to this cap, not the display cap above.
    max_stack_frames: int = 150
    # Most exposures whose wavelength at the target is checked for one /api/frames request.
    # Each check reads a little of the file; more candidates than this are sampled evenly in time.
    max_probes: int = 400
    # Parallel byte-range readers against the AWS mirror (32 was measured to work).
    s3_concurrency: int = 16
    # IRSA search requests. All collections go in one request. A search took about 22 s on
    # 2026-11-15; the timeout is the longest wait for the next bytes of the answer, in seconds.
    # Retries cover IRSA's short 502 and 503 spells, with a growing pause (backoff) between tries.
    irsa_timeout_s: float = 90.0
    irsa_retries: int = 2
    irsa_backoff_s: float = 2.0
    # Search results are kept on disk this long. New data arrives at most weekly.
    search_cache_hours: float = 12.0

    # Image patches, wavelength checks and search results (live mode). Git-ignored.
    cache_dir: Path = Path(__file__).resolve().parent.parent / ".cache"
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]

    @field_validator("collections", "cors_origins", mode="before")
    @classmethod
    def _split_list(cls, value: object) -> object:
        """Accept "a,b,c" or a JSON list in environment variables."""
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                return json.loads(text)
            return [part.strip() for part in text.split(",") if part.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
