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

    search_radius_deg: float = 0.005
    # For objects with proper motion, the archive is searched at the position for this
    # date (decimal year, roughly the middle of the survey so far). Image footprints are
    # degrees wide, so one search position is enough even for the fastest stars.
    search_epoch_year: float = 2026.0
    # Most exposures returned by one request; more than this are sampled evenly in time.
    max_exposures: int = 300
    # Parallel byte-range readers against the AWS mirror (measured: 32 works well).
    s3_concurrency: int = 32
    # Parallel requests to IRSA itself (it rejects about 8 or more at once).
    irsa_concurrency: int = 4

    cache_dir: Path = Path(".cache")
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
