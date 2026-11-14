"""Layer 2 endpoints: /api/stack (what was stacked, and how well) and /api/stack.png.

Both modes run the same stacking code (`stacking.py`); only the inputs differ:

- live: every exposure whose wavelength at the moving target is in range (the layer 1
  search, wavelength checks and patch cache, so nothing is read twice), up to
  `max_stack_frames`, each patch centred on the object's predicted position at its time;
- mock: synthetic exposures from `mock.stack_exposures`, drawn the same way.

In live mode the finished stacks are kept in the disk cache (kinds `stack` and
`stackimg`) for `search_cache_hours`, so the images of a stack are served without
recomputing it. Stacks stay on the native 6.15 arcsecond grid: the cache holds patches
already resampled to that grid, and a finer grid would mean reading every file again.
"""

import math
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
from urllib.parse import urlencode

import numpy as np

from . import live_frames, mock, stacking
from . import models as m
from .cache import make_key
from .config import PIXEL_SCALE_ARCSEC, Settings
from .live_frames import _centre_text, _safe, common_stretch, render
from .resample import sky_to_tangent
from .sampling import sample_evenly
from .targets import TARGETS, parallax_offset, position_at_mjd

# Bump when the stacking changes, so old cached stacks are not reused.
STACK_VERSION = 6

_lock = threading.Lock()


@dataclass(frozen=True)
class StackRequest:
    ra: float
    dec: float
    size: float
    wl_min: float | None
    wl_max: float | None
    pmra: float
    pmdec: float
    epoch: float
    parallax: float = 0.0  # mas; only enters the predicted positions

    def query(self) -> dict[str, str]:
        out = {"ra": repr(self.ra), "dec": repr(self.dec), "size": f"{self.size:g}"}
        if self.wl_min is not None:
            out["wl_min"] = repr(self.wl_min)
        if self.wl_max is not None:
            out["wl_max"] = repr(self.wl_max)
        if self.pmra or self.pmdec:
            out.update(pmra=repr(self.pmra), pmdec=repr(self.pmdec), epoch=repr(self.epoch))
        if self.parallax:
            out["parallax"] = repr(self.parallax)
        return out

    @property
    def has_motion(self) -> bool:
        return bool(self.pmra or self.pmdec)

    @classmethod
    def normalised(
        cls,
        ra: float,
        dec: float,
        size: float,
        wl_min: float | None,
        wl_max: float | None,
        pmra: float,
        pmdec: float,
        epoch: float,
        parallax: float = 0.0,
    ) -> "StackRequest":
        """The one form of a request that the API, the stack cache and scripts/prewarm.py
        all use, so that the same view always gives the same cache key.

        The site writes coordinates with 7 decimals and motions with 3; the pre-warm uses
        the full catalogue values. So: a request within 0.01 arcsec (and 0.01 mas/yr,
        0.01 mas) of a built-in target with the same epoch takes that target's exact
        catalogue values; anything else is rounded (positions to 1e-6 degree, 0.0036
        arcsec, as patch centres are; motions and parallax to 0.01; epoch to 0.001 year;
        wavelengths to 0.0001 micrometre; size to 0.1 arcsec). None of these roundings
        moves anything by a measurable amount."""
        cos_dec = math.cos(math.radians(dec))
        for target in TARGETS:
            near = (
                abs(dec - target.dec) * 3600.0 < 0.01
                and abs((ra - target.ra + 180.0) % 360.0 - 180.0) * cos_dec * 3600.0 < 0.01
                and abs(pmra - target.pmra) < 0.01
                and abs(pmdec - target.pmdec) < 0.01
                and abs(epoch - target.epoch) < 1e-3
            )
            if near:
                ra, dec, pmra, pmdec, epoch = target.ra, target.dec, target.pmra, target.pmdec, target.epoch
                if abs(parallax - target.parallax) < 0.01:
                    parallax = target.parallax
                break
        else:
            ra, dec = round(ra, 6), round(dec, 6)
            pmra, pmdec, epoch = round(pmra, 2), round(pmdec, 2), round(epoch, 3)
        if parallax != 0.0 and not any(parallax == t.parallax for t in TARGETS):
            parallax = round(parallax, 2)

        def wavelength(value: float | None) -> float | None:
            return None if value is None else round(value, 4)

        return cls(
            ra, dec, round(size, 1), wavelength(wl_min), wavelength(wl_max), pmra, pmdec, epoch, parallax
        )


@dataclass
class _Exposure:
    exposure_id: str
    mjd: float
    wavelength_um: float
    image: np.ndarray
    ra: float  # predicted object position at this exposure's time
    dec: float
    raw: np.ndarray | None = None  # without the bad-pixel mask, for filling holes in pictures


# --- inputs --------------------------------------------------------------------------------


def _live_inputs(settings: Settings, req: StackRequest, n: int):
    matching, notes, failed, probes_capped = live_frames.matching_exposures(
        settings, req.ra, req.dec, req.wl_min, req.wl_max, req.pmra, req.pmdec, req.epoch
    )
    picked = sample_evenly(matching, settings.max_stack_frames)
    if len(picked) < len(matching):
        notes.append(f"Stacked {len(picked)} of {len(matching)} matching exposures, spread evenly over time.")
    positions = [position_at_mjd(req.ra, req.dec, req.pmra, req.pmdec, req.epoch, e.mjd) for e, _ in picked]

    def load(i: int):
        ra_c, dec_c = (float(_centre_text(v)) for v in positions[i])
        return live_frames.get_patch(settings, picked[i][0], ra_c, dec_c, n)

    with ThreadPoolExecutor(max_workers=max(1, settings.s3_concurrency)) as pool:
        loaded = list(pool.map(_safe(load), range(len(picked))))
    out = []
    for i, (ok, patch) in enumerate(loaded):
        if not ok or patch is None:
            failed += 1
            continue
        e, wavelength = picked[i]
        out.append(_Exposure(e.exposure_id, e.mjd, wavelength, patch.image, *positions[i], raw=patch.raw))
    if failed:
        notes.append(f"{failed} exposure(s) could not be read and were skipped.")
    return out, len(matching), notes, len(picked) < len(matching) or probes_capped


def _mock_inputs(req: StackRequest, n: int):
    out = []
    for e in mock.stack_exposures(req.wl_min, req.wl_max):
        t_ra, t_dec = position_at_mjd(req.ra, req.dec, req.pmra, req.pmdec, req.epoch, e.mjd)
        image = mock.patch(e, t_ra, t_dec, req.size)
        out.append(_Exposure(e.exposure_id, e.mjd, e.wavelength_um, image, t_ra, t_dec))
    return out, len(out), [], False


# --- building -------------------------------------------------------------------------------


def _image_url(req: StackRequest, kind: str, index: int = 0) -> str:
    return "/api/stack.png?" + urlencode({**req.query(), "kind": kind, "index": index})


def _compute(settings: Settings, req: StackRequest) -> tuple[dict, dict[str, np.ndarray]]:
    n = mock.patch_pixels(req.size)
    if settings.mode == "mock":
        exposures, total, notes, capped = _mock_inputs(req, n)
    else:
        exposures, total, notes, capped = _live_inputs(settings, req, n)

    if exposures:
        mid = float(np.mean([e.mjd for e in exposures]))
        ref_ra, ref_dec = position_at_mjd(req.ra, req.dec, req.pmra, req.pmdec, req.epoch, mid)
    else:
        ref_ra, ref_dec = req.ra, req.dec
    inputs = []
    for e in exposures:
        east, north = sky_to_tangent(ref_ra, ref_dec, np.array([e.ra]), np.array([e.dec]))
        plx_east, plx_north = parallax_offset(e.ra, e.dec, req.parallax, e.mjd)
        inputs.append(
            stacking.StackInput(
                e.exposure_id,
                e.mjd,
                e.wavelength_um,
                e.image,
                float(east[0]),
                float(north[0]),
                e.raw,
                parallax_east=plx_east,
                parallax_north=plx_north,
            )
        )
    built = stacking.build(inputs, n, PIXEL_SCALE_ARCSEC, req.has_motion)

    def describe(stack: stacking.Stack | None) -> m.StackImage | None:
        if stack is None:
            return None
        members = [inputs[k] for k in stack.members]
        wavelengths = [i.wavelength_um for i in members]
        mjds = [i.mjd for i in members]
        if stack.kind == "single":
            c_ra, c_dec = exposures[stack.members[0]].ra, exposures[stack.members[0]].dec
        else:
            c_ra, c_dec = ref_ra, ref_dec
        return m.StackImage(
            kind=stack.kind,
            index=stack.index,
            n_exposures=len(members),
            exposure_ids=[i.exposure_id for i in members],
            mjd_start=min(mjds),
            mjd_end=max(mjds),
            mjd_mid=stack.mjd_mid,
            wl_min_um=round(min(wavelengths), 4),
            wl_max_um=round(max(wavelengths), 4),
            center_ra=c_ra,
            center_dec=c_dec,
            target_x=round(stack.target_x, 3),
            target_y=round(stack.target_y, 3),
            snr=None if stack.snr is None else round(stack.snr, 2),
            image_url=_image_url(req, stack.kind, stack.index),
        )

    epochs = built["epochs"]
    first = next((s for s in epochs if s.measured is not None), epochs[0] if epochs else None)
    motion = []
    for s in epochs:
        e0, n0 = first.extra["east"], first.extra["north"]
        snr = s.extra.get("measure_snr")
        point = m.MotionPoint(
            index=s.index,
            mjd_mid=s.mjd_mid,
            predicted_east_arcsec=round(s.extra["east"] - e0, 2),
            predicted_north_arcsec=round(s.extra["north"] - n0, 2),
            parallax_east_arcsec=round(s.extra["parallax_east"] - first.extra["parallax_east"], 2),
            parallax_north_arcsec=round(s.extra["parallax_north"] - first.extra["parallax_north"], 2),
            measured_east_arcsec=None,
            measured_north_arcsec=None,
            error_east_arcsec=None,
            error_north_arcsec=None,
            error_method=None,
            error_arcsec=None,
            snr=None if snr is None else round(snr, 2),
        )
        here, there = s.measured, first.measured
        if here is not None and there is not None:
            point.measured_east_arcsec = round(here.east - there.east, 2)
            point.measured_north_arcsec = round(here.north - there.north, 2)
            if s is not first:
                # Independent bootstraps of the two visits: the variances add.
                point.error_east_arcsec = round(float(np.hypot(here.err_east, there.err_east)), 2)
                point.error_north_arcsec = round(float(np.hypot(here.err_north, there.err_north)), 2)
                point.error_arcsec = max(point.error_east_arcsec, point.error_north_arcsec)
                both = {here.method, there.method}
                point.error_method = "bootstrap" if both == {"bootstrap"} else "fit"
        motion.append(point)

    if built["tracked"] is not None and built["tracked"].snr is None:
        notes.append(
            "The pixels at the target are flagged in most exposures (usually the saturated core of a "
            "bright star), so no signal-to-noise ratio is given. The pictures show their unflagged values."
        )

    result = m.StackResult(
        mode=settings.mode,
        total=total,
        returned=len(inputs),
        capped=capped,
        warnings=notes,
        ra=req.ra,
        dec=req.dec,
        size=req.size,
        pixel_scale=PIXEL_SCALE_ARCSEC,
        pixels=n,
        has_motion=req.has_motion,
        parallax=req.parallax,
        reference_ra=ref_ra,
        reference_dec=ref_dec,
        single=describe(built["single"]),
        tracked=describe(built["tracked"]),
        static=describe(built["static"]),
        epochs=[describe(s) for s in epochs],
        motion=motion,
    )

    arrays: dict[str, np.ndarray] = {}
    for stack in [built["single"], built["tracked"], built["static"], *epochs]:
        if stack is not None:
            arrays[f"{stack.kind}_{stack.index}"] = stack.display.astype(np.float32)
    main = [s.image for s in (built["tracked"], built["static"]) if s is not None]
    stretches = {
        "main": common_stretch(main) if main else None,
        "epoch": common_stretch([s.image for s in epochs]) if epochs else None,
    }
    return {"result": result.model_dump(mode="json"), "stretch": stretches}, arrays


@lru_cache(maxsize=8)
def _mock_cached(req: StackRequest) -> tuple[dict, dict[str, np.ndarray]]:
    return _compute(Settings(mode="mock", _env_file=None), req)


def _key(settings: Settings, req: StackRequest) -> str:
    return make_key(
        "stack",
        STACK_VERSION,
        sorted(req.query().items()),
        PIXEL_SCALE_ARCSEC,
        settings.max_stack_frames,
        ",".join(settings.collections),
    )


def get_stack(settings: Settings, req: StackRequest) -> tuple[dict, dict[str, np.ndarray]]:
    """The stack set for a request: from the cache if fresh, otherwise computed and cached."""
    if settings.mode == "mock":
        return _mock_cached(req)
    cache = live_frames._cache(settings)
    key = _key(settings, req)
    max_age = settings.search_cache_hours * 3600.0

    def cached():
        meta = cache.get_json("stack", key, max_age_s=max_age)
        arrays = cache.get_arrays("stackimg", key) if meta is not None else None
        return (meta, arrays) if arrays is not None else None

    found = cached()
    if found is not None:
        return found
    with _lock:  # one cold stack at a time; image requests arriving meanwhile then hit the cache
        found = cached()
        if found is not None:
            return found
        meta, arrays = _compute(settings, req)
        cache.put_arrays("stackimg", key, arrays)
        cache.put_json("stack", key, meta)
        return meta, arrays


def stack_result(settings: Settings, req: StackRequest) -> m.StackResult:
    meta, _ = get_stack(settings, req)
    return m.StackResult(**meta["result"])


def stack_png(settings: Settings, req: StackRequest, kind: str, index: int) -> bytes | None:
    """PNG of one image of the set; None if there is no such image."""
    meta, arrays = get_stack(settings, req)
    image = arrays.get(f"{kind}_{index}")
    if image is None:
        return None
    stretch = meta["stretch"]["epoch" if kind == "epoch" else "main"]
    if stretch is None:
        stretch = common_stretch([image])
    return render(image.astype(np.float64), stretch)
