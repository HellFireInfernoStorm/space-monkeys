"""Fill the live-mode cache for the built-in targets, so the demo does not wait on the network.

Run from the repository root with the back end's virtual environment:

    backend/.venv/bin/python scripts/prewarm.py            (macOS, Linux)
    backend\\.venv\\Scripts\\python.exe scripts/prewarm.py   (Windows)

Options:
    --only barnard wise-0855    warm only these target ids
    --size 120                  image width in arcseconds (the site's default is 120)
    --no-diff                   skip difference images

It runs the same code as the API (/api/frames, then every /api/frame.png, plain and
difference), in live mode, writing to the cache folder in `SM_CACHE_DIR` or the default
`backend/.cache`. Run it again at any time: what is cached already is not fetched again.
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app import live_frames  # noqa: E402
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
