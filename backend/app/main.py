"""The API. Routes only; the work is in mock.py (synthetic) and live.py (real data).

Run from the backend folder:  python -m uvicorn app.main:app --reload --port 8000
Interactive documentation:    http://localhost:8000/docs
"""

from dataclasses import asdict
from typing import Annotated, Literal
from urllib.parse import urlencode

from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware

from . import __version__, astrometry, live, live_frames, mock, stack_service, wise
from . import models as m
from . import photometry as phot
from .bands import BANDS
from .config import PIXEL_SCALE_ARCSEC, Settings, get_settings
from .sampling import sample_evenly
from .targets import TARGETS, find_target, position_at_mjd, propagate

app = FastAPI(
    title="space-monkeys API",
    version=__version__,
    description=(
        "SPHEREx sky images over time for a position on the sky. "
        "Units: degrees (ICRS), arcseconds, micrometres, MJD, milliarcseconds per year. "
        "The `mode` field of every response says whether the data is real (`live`) or synthetic (`mock`)."
    ),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["GET"],
    allow_headers=["*"],
)

SettingsDep = Annotated[Settings, Depends(get_settings)]
Ra = Annotated[float, Query(ge=0, le=360, description="Right Ascension, degrees, ICRS, at `epoch`")]
Dec = Annotated[float, Query(ge=-90, le=90, description="Declination, degrees, ICRS, at `epoch`")]
PmRa = Annotated[float, Query(description="Proper motion in RA, mas/yr, including cos(dec)")]
PmDec = Annotated[float, Query(description="Proper motion in Dec, mas/yr")]
Epoch = Annotated[float, Query(ge=1900, le=2100, description="Decimal year of the given position")]
Parallax = Annotated[
    float,
    Query(ge=0, le=1000, description="Parallax, mas. Used only for the predicted positions in `motion`"),
]
Size = Annotated[float, Query(ge=30, le=600, description="Width of the image on the sky, arcseconds")]
WlMin = Annotated[float | None, Query(ge=0, description="Shortest wavelength to include, micrometres")]
WlMax = Annotated[float | None, Query(ge=0, description="Longest wavelength to include, micrometres")]
MaxItems = Annotated[
    int | None,
    Query(alias="max", ge=1, le=2000, description="Most items to return; server default if empty"),
]

NOT_BUILT = "Not built yet for live data. Run the back end with SM_MODE=mock to work on the interface."


def _not_built() -> HTTPException:
    return HTTPException(status_code=501, detail=NOT_BUILT)


def _missing_extra(error: Exception) -> str:
    if isinstance(error, live.LiveDependencyMissing):
        return str(error)
    return f'Live mode needs extra packages ({error}). Run: python -m pip install -e ".[dev,live]"'


def _target_model(target) -> m.Target:
    data = asdict(target)
    data["aliases"] = list(target.aliases)
    return m.Target(**data)


def _in_range(wavelength: float, wl_min: float | None, wl_max: float | None) -> bool:
    return (wl_min is None or wavelength >= wl_min) and (wl_max is None or wavelength <= wl_max)


@app.get("/api/health", response_model=m.Health, tags=["status"])
def health(settings: SettingsDep) -> m.Health:
    """Is the service up, and is it serving real or synthetic data?"""
    return m.Health(mode=settings.mode, collections=settings.collections, version=__version__)


@app.get("/api/bands", response_model=m.BandList, tags=["status"])
def bands() -> m.BandList:
    """The six detector bands and their wavelength ranges."""
    return m.BandList(bands=[m.Band(band=b, wl_min_um=lo, wl_max_um=hi) for b, (lo, hi) in BANDS.items()])


@app.get("/api/alignment", response_model=m.AlignmentResult, tags=["data"])
async def alignment(
    settings: SettingsDep,
    exposure_id: Annotated[str, Query(min_length=1, max_length=160)],
    ra: Ra,
    dec: Dec,
    target_ra: Ra,
    target_dec: Dec,
) -> m.AlignmentResult:
    """Independent star-match verification of one exposure; does not alter science data.

    ra/dec are the displayed frame centre. target_ra/target_dec are the science
    target at the observation date, excluded with nearby blends from the fit.
    Work is capped at two readers and the configured deadline; failures retain WCS.
    """
    try:
        return await astrometry.check(settings, exposure_id, ra, dec, target_ra, target_dec)
    except live_frames.UnknownExposure as error:
        raise HTTPException(status_code=404, detail="Unknown exposure; load its frame list first.") from error


@app.get("/api/targets", response_model=m.TargetList, tags=["targets"])
def targets(settings: SettingsDep) -> m.TargetList:
    """The five test targets from the challenge, with catalogue positions and motions."""
    return m.TargetList(mode=settings.mode, targets=[_target_model(t) for t in TARGETS])


@app.get("/api/resolve", response_model=m.ResolveResult, tags=["targets"])
def resolve(name: Annotated[str, Query(min_length=1, max_length=80)]) -> m.ResolveResult:
    """Name to coordinates. Knows only the built-in test targets for now."""
    target = find_target(name)
    if target is None:
        raise HTTPException(
            status_code=404,
            detail=f"'{name}' is not one of the built-in targets. Enter coordinates instead.",
        )
    return m.ResolveResult(query=name, source="builtin", target=_target_model(target))


@app.get("/api/exposures", response_model=m.ExposureList, tags=["data"])
def exposures(
    settings: SettingsDep,
    ra: Ra,
    dec: Dec,
    radius: Annotated[float | None, Query(gt=0, le=0.5, description="Search radius, degrees")] = None,
    pmra: PmRa = 0.0,
    pmdec: PmDec = 0.0,
    epoch: Epoch = 2000.0,
    max_items: MaxItems = None,
) -> m.ExposureList:
    """Exposures that cover a position, across all configured collections, oldest first."""
    radius = radius if radius is not None else settings.search_radius_deg
    cap = max_items if max_items is not None else settings.max_exposures

    def where(mjd: float) -> tuple[float, float]:
        return position_at_mjd(ra, dec, pmra, pmdec, epoch, mjd)

    if settings.mode == "mock":
        everything = list(mock.all_exposures())
        picked = sample_evenly(everything, cap)
        items = []
        for e in picked:
            t_ra, t_dec = where(e.mjd)
            lo, hi = BANDS[e.detector]
            items.append(
                m.Exposure(
                    exposure_id=e.exposure_id,
                    obs_id=e.obs_id,
                    collection=mock.COLLECTION,
                    detector=e.detector,
                    bandpass=f"mock-D{e.detector}",
                    mjd=e.mjd,
                    exptime_s=e.exptime_s,
                    wl_min_um=lo,
                    wl_max_um=hi,
                    wavelength_um=e.wavelength_um,
                    target_ra=t_ra,
                    target_dec=t_dec,
                    access_url=None,
                    cloud_url=None,
                )
            )
        return m.ExposureList(
            mode="mock",
            total=len(everything),
            returned=len(items),
            capped=len(items) < len(everything),
            ra=ra,
            dec=dec,
            radius=radius,
            collections=[mock.COLLECTION],
            exposures=items,
        )

    # Search where the object is during the survey, not where the catalogue put it years ago.
    search_ra, search_dec = ra, dec
    if pmra or pmdec:
        search_ra, search_dec = propagate(ra, dec, pmra, pmdec, epoch, settings.search_epoch_year)
    try:
        found, warnings = live_frames.search(settings, search_ra, search_dec, radius)
    except live.LiveDependencyMissing as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except live_frames.SearchFailed as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    picked_live = sample_evenly(found, cap)
    items = []
    for e in picked_live:
        t_ra, t_dec = where(e.mjd)
        items.append(m.Exposure(**asdict(e), wavelength_um=None, target_ra=t_ra, target_dec=t_dec))
    return m.ExposureList(
        mode="live",
        total=len(found),
        returned=len(items),
        capped=len(items) < len(found),
        warnings=warnings,
        ra=ra,
        dec=dec,
        radius=radius,
        collections=settings.collections,
        exposures=items,
    )


@app.get("/api/frames", response_model=m.FrameList, tags=["data"])
def frames(
    settings: SettingsDep,
    ra: Ra,
    dec: Dec,
    size: Size = 120.0,
    wl_min: WlMin = None,
    wl_max: WlMax = None,
    pmra: PmRa = 0.0,
    pmdec: PmDec = 0.0,
    epoch: Epoch = 2000.0,
    track: Annotated[
        bool, Query(description="Re-centre every frame on the moving object (it stays still)")
    ] = False,
    max_items: MaxItems = None,
) -> m.FrameList:
    """The frame list for the blink player: exposures in a wavelength range, each with an image address.

    Without `track`, every frame is centred on the same sky position (where the object is
    at the middle frame), so a moving object visibly moves.
    """
    if settings.mode != "mock":
        try:
            return live_frames.frame_list(
                settings, ra, dec, size, wl_min, wl_max, pmra, pmdec, epoch, track, max_items
            )
        except (live.LiveDependencyMissing, ImportError) as error:
            raise HTTPException(status_code=503, detail=_missing_extra(error)) from error
        except live_frames.SearchFailed as error:
            raise HTTPException(status_code=502, detail=str(error)) from error
    cap = max_items if max_items is not None else settings.max_exposures

    matching = [e for e in mock.all_exposures() if _in_range(e.wavelength_um, wl_min, wl_max)]
    picked = sample_evenly(matching, cap)
    positions = [position_at_mjd(ra, dec, pmra, pmdec, epoch, e.mjd) for e in picked]
    fixed_centre = positions[len(positions) // 2] if positions else (ra, dec)

    items = []
    for e, (t_ra, t_dec) in zip(picked, positions, strict=True):
        c_ra, c_dec = (t_ra, t_dec) if track else fixed_centre
        query = urlencode(
            {"exposure_id": e.exposure_id, "ra": f"{c_ra:.6f}", "dec": f"{c_dec:.6f}", "size": f"{size:g}"}
        )
        items.append(
            m.Frame(
                exposure_id=e.exposure_id,
                collection=mock.COLLECTION,
                detector=e.detector,
                mjd=e.mjd,
                wavelength_um=e.wavelength_um,
                image_url=f"/api/frame.png?{query}",
                center_ra=c_ra,
                center_dec=c_dec,
                target_ra=t_ra,
                target_dec=t_dec,
            )
        )
    return m.FrameList(
        mode="mock",
        total=len(matching),
        returned=len(items),
        capped=len(items) < len(matching),
        ra=ra,
        dec=dec,
        size=size,
        pixel_scale=PIXEL_SCALE_ARCSEC,
        track=track,
        frames=items,
    )


@app.get(
    "/api/frame.png",
    tags=["data"],
    response_class=Response,
    responses={200: {"content": {"image/png": {}}, "description": "Greyscale PNG, north up, east left"}},
)
def frame_png(
    settings: SettingsDep,
    exposure_id: Annotated[str, Query(min_length=1, max_length=120)],
    ra: Annotated[float, Query(ge=0, le=360, description="Centre of the image, degrees")],
    dec: Annotated[float, Query(ge=-90, le=90, description="Centre of the image, degrees")],
    size: Size = 120.0,
    diff_ref: Annotated[
        str | None,
        Query(max_length=120, description="Exposure to subtract; gives a difference image (grey: no change)"),
    ] = None,
) -> Response:
    """One image patch as a PNG. Use the addresses given by `/api/frames`."""
    if settings.mode != "mock":
        try:
            png = live_frames.frame_png(settings, exposure_id, ra, dec, size, diff_ref)
        except live_frames.UnknownExposure as error:
            raise HTTPException(
                status_code=404,
                detail=f"Unknown exposure_id '{error.args[0]}'. Use the addresses given by /api/frames.",
            ) from error
        except (live.LiveDependencyMissing, ImportError) as error:
            raise HTTPException(status_code=503, detail=_missing_extra(error)) from error
        except Exception as error:  # noqa: BLE001 - reading the archive failed
            raise HTTPException(
                status_code=502, detail=f"Could not read the image from the archive: {type(error).__name__}"
            ) from error
        if png is None:
            raise HTTPException(status_code=404, detail="This position is not on that exposure's detector.")
        return Response(content=png, media_type="image/png", headers={"Cache-Control": "public, max-age=300"})
    exposure = mock.get_exposure(exposure_id)
    if exposure is None:
        raise HTTPException(status_code=404, detail=f"Unknown exposure_id '{exposure_id}'")
    reference = None
    if diff_ref is not None:
        reference = mock.get_exposure(diff_ref)
        if reference is None:
            raise HTTPException(status_code=404, detail=f"Unknown diff_ref '{diff_ref}'")
    png = mock.frame_png(exposure, ra, dec, size, reference)
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "public, max-age=300"})


def _stack_request(ra, dec, size, wl_min, wl_max, pmra, pmdec, epoch, parallax) -> stack_service.StackRequest:
    return stack_service.StackRequest.normalised(ra, dec, size, wl_min, wl_max, pmra, pmdec, epoch, parallax)


def _live_stack_call(function, *args):
    try:
        return function(*args)
    except (live.LiveDependencyMissing, ImportError) as error:
        raise HTTPException(status_code=503, detail=_missing_extra(error)) from error
    except live_frames.SearchFailed as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/stack", response_model=m.StackResult, tags=["data"])
def stack(
    settings: SettingsDep,
    ra: Ra,
    dec: Dec,
    size: Size = 120.0,
    wl_min: WlMin = None,
    wl_max: WlMax = None,
    pmra: PmRa = 0.0,
    pmdec: PmDec = 0.0,
    epoch: Epoch = 2000.0,
    parallax: Parallax = 0.0,
) -> m.StackResult:
    """Many exposures added together, so that faint objects appear.

    Uses every exposure in the wavelength range (up to the server's stack cap, not the
    blink player's cap). Returns one typical single exposure, the `tracked` stack (each
    exposure centred on the object's predicted position), the `static` stack (one fixed
    sky grid; null without proper motion), one stack per visit (`epochs`, same fixed
    grid), and the object's measured and predicted motion between visits. A first
    request for a position can take about a minute in live mode; then it is cached.
    """
    req = _stack_request(ra, dec, size, wl_min, wl_max, pmra, pmdec, epoch, parallax)
    return _live_stack_call(stack_service.stack_result, settings, req)


@app.get(
    "/api/stack.png",
    tags=["data"],
    response_class=Response,
    responses={200: {"content": {"image/png": {}}, "description": "Greyscale PNG, north up, east left"}},
)
def stack_png(
    settings: SettingsDep,
    ra: Ra,
    dec: Dec,
    size: Size = 120.0,
    wl_min: WlMin = None,
    wl_max: WlMax = None,
    pmra: PmRa = 0.0,
    pmdec: PmDec = 0.0,
    epoch: Epoch = 2000.0,
    parallax: Parallax = 0.0,
    kind: Annotated[m.StackKind, Query(description="Which image of the stack set")] = "tracked",
    index: Annotated[int, Query(ge=0, le=100, description="Epoch number, for kind `epoch`")] = 0,
) -> Response:
    """One image of a stack set as a PNG. Use the addresses given by `/api/stack`."""
    req = _stack_request(ra, dec, size, wl_min, wl_max, pmra, pmdec, epoch, parallax)
    png = _live_stack_call(stack_service.stack_png, settings, req, kind, index)
    if png is None:
        raise HTTPException(status_code=404, detail=f"This stack set has no '{kind}' image number {index}.")
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "public, max-age=300"})


WiseBand = Annotated[Literal["W1", "W2"], Query(description="WISE band: W1 (3.4 micrometres) or W2 (4.6)")]


def _wise_call(settings: Settings, ra: float, dec: float, size: float, band: str) -> wise.WiseImage:
    try:
        return wise.wise_image(settings, ra, dec, size, band)
    except (live.LiveDependencyMissing, ImportError) as error:
        raise HTTPException(status_code=503, detail=_missing_extra(error)) from error
    except wise.NoTile as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (OSError, KeyError) as error:
        raise HTTPException(
            status_code=502,
            detail=f"Could not read the AllWISE image from the archive mirror ({type(error).__name__}).",
        ) from error


@app.get("/api/wise", response_model=m.WiseImage, tags=["data"])
def wise_meta(
    settings: SettingsDep, ra: Ra, dec: Dec, size: Size = 120.0, band: WiseBand = "W2"
) -> m.WiseImage:
    """Layer 4: an AllWISE image (2010) of the same field as the SPHEREx view, with its dates.

    Same centre and width as the SPHEREx image, north up and east left, at the WISE pixel
    scale (1.375 arcseconds), so field stars line up and anything that moved since 2010 is
    in a different place. A first request for a field reads the image from the archive's
    AWS mirror (a few seconds); then it is cached.
    """
    return _wise_call(settings, ra, dec, size, band).meta


@app.get(
    "/api/wise.png",
    tags=["data"],
    response_class=Response,
    responses={200: {"content": {"image/png": {}}, "description": "Greyscale PNG"}},
)
def wise_png(settings: SettingsDep, ra: Ra, dec: Dec, size: Size = 120.0, band: WiseBand = "W2") -> Response:
    """The image of `/api/wise` as a PNG."""
    result = _wise_call(settings, ra, dec, size, band)
    return Response(
        content=wise.wise_png(result.image),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.get("/api/photometry", response_model=m.PhotometryResult, tags=["data"])
def photometry(
    settings: SettingsDep,
    ra: Ra,
    dec: Dec,
    pmra: PmRa = 0.0,
    pmdec: PmDec = 0.0,
    epoch: Epoch = 2000.0,
    parallax: Annotated[
        float, Query(ge=0, le=1000, description="Parallax, mas. Moves the aperture with the object (live)")
    ] = 0.0,
    wl_min: WlMin = None,
    wl_max: WlMax = None,
    max_items: MaxItems = None,
) -> m.PhotometryResult:
    """Quick-look brightness at a point in every exposure: plot against wavelength for a
    spectrum, or against time for a light curve.

    For a moving object, give its proper motion: each exposure is measured where the object
    was on that date. Points whose aperture holds flagged or missing pixels have a null
    `flux`. A first request for a position can take about a minute in live mode; then it
    is cached.
    """
    if settings.mode != "mock":
        try:
            return phot.live_photometry(
                settings, ra, dec, pmra, pmdec, epoch, parallax, wl_min, wl_max, max_items
            )
        except (live.LiveDependencyMissing, ImportError) as error:
            raise HTTPException(status_code=503, detail=_missing_extra(error)) from error
        except live_frames.SearchFailed as error:
            raise HTTPException(status_code=502, detail=str(error)) from error
    cap = max_items if max_items is not None else settings.max_exposures

    matching = [e for e in mock.all_exposures() if _in_range(e.wavelength_um, wl_min, wl_max)]
    picked = sample_evenly(matching, cap)
    points = []
    for e in picked:
        p_ra, p_dec = position_at_mjd(ra, dec, pmra, pmdec, epoch, e.mjd)
        flux, flux_err, lambda_width, flags = mock.photometry(e, p_ra, p_dec)
        points.append(
            m.PhotometryPoint(
                exposure_id=e.exposure_id,
                obs_id=e.obs_id,
                det_id=e.detector,
                mjd=e.mjd,
                wavelength=e.wavelength_um,
                lambda_width=lambda_width,
                flux=flux,
                flux_err=flux_err,
                flags=flags,
            )
        )
    return m.PhotometryResult(
        mode="mock",
        total=len(matching),
        returned=len(points),
        capped=len(points) < len(matching),
        ra=ra,
        dec=dec,
        flux_unit="uJy",
        method="mock: synthetic values, not measurements",
        points=points,
    )
