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


StackKind = Literal["single", "tracked", "static", "epoch"]


class StackImage(BaseModel):
    """One stacked image (or, for kind `single`, one exposure on its own)."""

    kind: StackKind = Field(
        description="`single`: one typical exposure; `tracked`: all exposures centred on the moving "
        "object; `static`: all exposures on one fixed sky grid; `epoch`: one visit on that fixed grid"
    )
    index: int = Field(description="Epoch number, from 0; 0 for the other kinds")
    n_exposures: int
    exposure_ids: list[str] = Field(description="The exposures added together")
    mjd_start: float
    mjd_end: float
    mjd_mid: float = Field(description="Mean time of the exposures used")
    wl_min_um: float = Field(description="Shortest wavelength at the target among the exposures used")
    wl_max_um: float = Field(description="Longest wavelength at the target among the exposures used")
    center_ra: float = Field(description="Sky position of the image centre (for `tracked`, at `mjd_mid`)")
    center_dec: float
    target_x: float = Field(description="Predicted object position, pixels from the left (east) edge")
    target_y: float = Field(description="Predicted object position, pixels from the top (north) edge")
    snr: float | None = Field(
        description="Signal-to-noise ratio at the predicted position: peak of a 3 by 3 pixel box "
        "divided by the robust noise of the image away from it. Empty positions read about 1 to 2. "
        "Null when `saturated`, or when the image has too few usable pixels"
    )
    saturated: bool = Field(
        description="True when pixels at the predicted position are flagged in most exposures, as in the "
        "saturated core of a bright star. Then there is no S/N: `snr` is null by design, not missing"
    )
    image_url: str = Field(description="Address of the PNG, relative to the API root")


class MotionPoint(BaseModel):
    """Measured and predicted position of the object in one epoch stack, as offsets from
    the first epoch where it was measured. Offsets in arcseconds; east is positive."""

    index: int = Field(description="Epoch number, as in `epochs`")
    mjd_mid: float
    predicted_east_arcsec: float = Field(description="Proper motion plus parallax (when `parallax` is given)")
    predicted_north_arcsec: float
    parallax_east_arcsec: float = Field(
        description="The part of the predicted offset that is parallax (0 without `parallax`)"
    )
    parallax_north_arcsec: float
    measured_east_arcsec: float | None = Field(
        description="Gaussian fit in the object-centred stack of this visit. Null when too faint to measure"
    )
    measured_north_arcsec: float | None
    error_east_arcsec: float | None = Field(
        description="1-sigma uncertainty of the measured offset (both visits combined); null for the "
        "first visit, whose offset is zero by definition"
    )
    error_north_arcsec: float | None
    error_method: Literal["bootstrap", "fit"] | None = Field(
        description="`bootstrap`: spread of the fitted position when the visit is re-stacked from its "
        "exposures drawn with replacement; `fit`: the fit's own covariance (too few bootstrap fits)"
    )
    error_arcsec: float | None = Field(
        description="The larger of `error_east_arcsec` and `error_north_arcsec`"
    )
    snr: float | None = Field(
        description="S/N at the predicted position in the object-centred stack of this visit"
    )
    saturated: bool = Field(
        description="The object's core is flagged in this visit (a saturated star): no S/N, and the "
        "position is fitted to the wings, so its error is statistical only"
    )


class StackResult(ListMeta):
    """`total` is the number of exposures in the wavelength range, `returned` the number stacked."""

    ra: float
    dec: float
    size: float = Field(description="Width of each image on the sky, arcseconds")
    pixel_scale: float = Field(description="Arcseconds per stack pixel")
    pixels: int = Field(description="Width of each stack image in pixels")
    has_motion: bool = Field(
        description="False without proper motion: then `tracked` is also the static stack"
    )
    parallax: float = Field(description="Parallax used in the predicted positions, mas (0: ignored)")
    reference_ra: float = Field(description="Centre of the fixed grid used by `static` and `epochs`")
    reference_dec: float
    single: StackImage | None
    tracked: StackImage | None
    static: StackImage | None
    epochs: list[StackImage]
    motion: list[MotionPoint]


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
