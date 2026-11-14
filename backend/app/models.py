"""The shapes of everything the API returns. docs/openapi.json is generated from these.

Units everywhere: degrees (ICRS) for positions, arcseconds for sizes, micrometres for
wavelengths, MJD for times, milliarcseconds per year for proper motion.
"""

from typing import Literal

from pydantic import BaseModel, Field

Mode = Literal["mock", "live"]


class Health(BaseModel):
    status: Literal["ok"] = "ok"
    mode: Mode
    collections: list[str]
    version: str


class Band(BaseModel):
    band: int = Field(description="Detector number, 1 to 6")
    wl_min_um: float
    wl_max_um: float


class BandList(BaseModel):
    bands: list[Band]


class Target(BaseModel):
    id: str
    name: str
    aliases: list[str]
    ra: float = Field(description="Degrees, ICRS, at `epoch`")
    dec: float = Field(description="Degrees, ICRS, at `epoch`")
    pmra: float = Field(description="Proper motion in RA, mas/yr, including cos(dec)")
    pmdec: float = Field(description="Proper motion in Dec, mas/yr")
    parallax: float = Field(description="mas")
    epoch: float = Field(description="Decimal year of the position")
    kind: str
    note: str
    reference: str


class TargetList(BaseModel):
    mode: Mode
    targets: list[Target]


class ResolveResult(BaseModel):
    query: str
    source: str = Field(description="Where the answer came from; 'builtin' for the test targets")
    target: Target


class Exposure(BaseModel):
    exposure_id: str = Field(description="Archive observation id plus detector, e.g. 2025W18_1B_0081_2-D6")
    obs_id: str
    collection: str
    detector: int = Field(description="1 to 6")
    bandpass: str
    mjd: float = Field(description="Middle of the exposure")
    exptime_s: float | None
    wl_min_um: float = Field(description="Shortest wavelength anywhere on this detector image")
    wl_max_um: float = Field(description="Longest wavelength anywhere on this detector image")
    wavelength_um: float | None = Field(
        description="Wavelength at the target position; null until the image has been read"
    )
    target_ra: float = Field(description="Position of the target at this exposure's date")
    target_dec: float
    access_url: str | None = Field(description="Download address at IRSA")
    cloud_url: str | None = Field(description="Address of the same file on the AWS mirror")


class ListMeta(BaseModel):
    mode: Mode
    total: int = Field(description="How many matched")
    returned: int = Field(description="How many are in this response")
    capped: bool = Field(description="True if the list was cut down to the cap")
    warnings: list[str] = Field(default_factory=list)


class ExposureList(ListMeta):
    ra: float
    dec: float
    radius: float = Field(description="Search radius, degrees")
    collections: list[str]
    exposures: list[Exposure]


class Frame(BaseModel):
    exposure_id: str
    collection: str
    detector: int
    mjd: float
    wavelength_um: float | None
    image_url: str = Field(description="Address of the PNG, relative to the API root")
    center_ra: float = Field(description="Sky position at the middle of this image")
    center_dec: float
    target_ra: float = Field(description="Position of the target at this frame's date")
    target_dec: float


class FrameList(ListMeta):
    ra: float
    dec: float
    size: float = Field(description="Width of each image on the sky, arcseconds")
    pixel_scale: float = Field(description="Arcseconds per original pixel")
    track: bool
    frames: list[Frame]


class PhotometryPoint(BaseModel):
    """Column names follow IRSA's Spectrophotometry Tool where they overlap."""

    exposure_id: str
    obs_id: str
    det_id: int
    mjd: float
    wavelength: float = Field(description="Micrometres, at the measured position")
    lambda_width: float = Field(description="Width of the bandpass, micrometres")
    flux: float = Field(description="In `flux_unit`")
    flux_err: float
    flags: int = Field(description="Bitwise OR of the pixel flags in the aperture")


class PhotometryResult(ListMeta):
    ra: float
    dec: float
    flux_unit: str
    method: str = Field(description="How the numbers were made; quick-look values are not precise")
    points: list[PhotometryPoint]
