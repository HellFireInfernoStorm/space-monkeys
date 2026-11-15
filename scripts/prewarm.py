"""Fill the live-mode cache for the built-in targets, so the demo does not wait on the network.

Run from the repository root with the back end's virtual environment:

    backend/.venv/bin/python scripts/prewarm.py            (macOS, Linux)
    backend\\.venv\\Scripts\\python.exe scripts/prewarm.py   (Windows)

Options:
    --only barnard wise-0855    warm only these target ids
    --size 120                  image width in arcseconds (the site's default is 120)
    --no-diff                   skip difference images

It runs the same code as the API (/api/frames, then every /api/frame.png, plain and
difference; then /api/stack and every /api/stack.png for the targets in STACKS; then
/api/photometry for the targets in PHOTOMETRY), in live mode, writing to the cache folder
in `SM_CACHE_DIR` or the default `backend/.cache`. Run it again at any time: what is cached
already is not fetched again.
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app import live_frames, stack_service  # noqa: E402
from app import photometry as phot  # noqa: E402
from app.config import Settings  # noqa: E402
from app.targets import TARGETS  # noqa: E402

# Wavelength range (micrometres) and tracking per target. WISE 0855 is only visible at
# 4.4 to 5.0 micrometres and needs tracking (docs/SCIENCE.md). The other ranges are
# narrow slices where each star is bright; change them freely.
PLANS: dict[str, list[tuple[float, float, bool]]] = {
    "barnard": [(1.0, 1.2, False)],
    "eps-ind-b": [(1.1, 1.3, False)],
    "wise-0855": [(4.4, 5.0, True), (4.4, 5.0, False)],
    "rw-aur": [(2.0, 2.4, False)],
    "r-dra": [(2.0, 2.4, False)],
}

# Stacks (layer 2) to warm, per target: wavelength ranges in micrometres.
STACKS: dict[str, list[tuple[float, float]]] = {
    "wise-0855": [(4.4, 5.0)],
    "barnard": [(1.0, 1.2)],
}

# Spectrum and light curve (layer 3) to warm, per target: wavelength ranges in micrometres.
# The site's target buttons select the ranges in PLANS; the RW Aurigae light curve needs
# 0.746 to 1.117 micrometres, the only range where its core is not saturated (issue #7).
PHOTOMETRY: dict[str, list[tuple[float, float]]] = {
    "wise-0855": [(4.4, 5.0)],
    "rw-aur": [(0.746, 1.117), (2.0, 2.4)],
    "barnard": [(1.0, 1.2)],
}


def warm(settings: Settings, target, wl_min: float, wl_max: float, track: bool, size: float, diff: bool):
    started = time.time()
    frames = live_frames.frame_list(
        settings,
        target.ra,
        target.dec,
        size,
        wl_min,
        wl_max,
        target.pmra,
        target.pmdec,
        target.epoch,
        track,
        None,
    )
    listed = time.time() - started
    images = 0
    for frame in frames.frames:
        query = dict(part.split("=", 1) for part in frame.image_url.split("?", 1)[1].split("&"))
        ra, dec = float(query["ra"]), float(query["dec"])
        references = [None]
        if diff and frames.frames:
            references.append(frames.frames[0].exposure_id)
        for reference in references:
            try:
                live_frames.frame_png(settings, frame.exposure_id, ra, dec, size, reference)
                images += 1
            except Exception as error:  # noqa: BLE001 - report and carry on
                print(f"    {frame.exposure_id}: {type(error).__name__}: {error}")
    print(
        f"{target.name}: {wl_min}-{wl_max} um{' tracked' if track else ''}: "
        f"{frames.returned} of {frames.total} frames, {images} images, "
        f"list {listed:.0f} s, total {time.time() - started:.0f} s"
    )
    for warning in frames.warnings:
        print(f"    warning: {warning}")


def warm_stack(settings: Settings, target, wl_min: float, wl_max: float, size: float):
    """The stack set (/api/stack) and every one of its images (/api/stack.png)."""
    started = time.time()
    # The same normalised request the site's /api/stack call becomes, so the site hits this cache.
    request = stack_service.StackRequest.normalised(
        target.ra, target.dec, size, wl_min, wl_max, target.pmra, target.pmdec, target.epoch, target.parallax
    )
    result = stack_service.stack_result(settings, request)
    images = [result.single, result.tracked, result.static, *result.epochs]
    for image in images:
        if image is not None:
            stack_service.stack_png(settings, request, image.kind, image.index)
    tracked = result.tracked
    print(
        f"{target.name}: {wl_min}-{wl_max} um stack: {result.returned} of {result.total} exposures, "
        f"tracked S/N {tracked.snr if tracked else None}, {len(result.epochs)} epoch stacks, "
        f"{time.time() - started:.0f} s"
    )
    for warning in result.warnings:
        print(f"    warning: {warning}")


def warm_photometry(settings: Settings, target, wl_min: float, wl_max: float):
    """/api/photometry for the target itself, followed along its motion, as the site asks for it."""
    started = time.time()
    result = phot.live_photometry(
        settings, target.ra, target.dec, target.pmra, target.pmdec, target.epoch, target.parallax,
        wl_min, wl_max, None,
    )
    measured = sum(1 for p in result.points if p.flux is not None)
    print(
        f"{target.name}: {wl_min}-{wl_max} um photometry: {measured} of {result.returned} measured, "
        f"{time.time() - started:.0f} s"
    )
    for warning in result.warnings:
        print(f"    warning: {warning}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--only", nargs="*", help="target ids to warm (default: all)")
    parser.add_argument("--size", type=float, default=120.0, help="image width, arcseconds")
    parser.add_argument("--no-diff", action="store_true", help="skip difference images")
    args = parser.parse_args()

    settings = Settings(mode="live")
    print(f"Cache folder: {settings.cache_dir}")
    wanted = set(args.only) if args.only else set(PLANS)
    for target in TARGETS:
        if target.id not in wanted:
            continue
        for wl_min, wl_max, track in PLANS.get(target.id, []):
            try:
                warm(settings, target, wl_min, wl_max, track, args.size, not args.no_diff)
            except Exception as error:  # noqa: BLE001 - one target must not stop the rest
                print(f"{target.name}: failed: {type(error).__name__}: {error}")
        for wl_min, wl_max in STACKS.get(target.id, []):
            try:
                warm_stack(settings, target, wl_min, wl_max, args.size)
            except Exception as error:  # noqa: BLE001 - one target must not stop the rest
                print(f"{target.name}: stack failed: {type(error).__name__}: {error}")
        for wl_min, wl_max in PHOTOMETRY.get(target.id, []):
            try:
                warm_photometry(settings, target, wl_min, wl_max)
            except Exception as error:  # noqa: BLE001 - one target must not stop the rest
                print(f"{target.name}: photometry failed: {type(error).__name__}: {error}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
