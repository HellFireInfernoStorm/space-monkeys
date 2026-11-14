"""Reproduce issue #4 live checks; results go to the ignored disk cache.

Run from backend: .venv/Scripts/python.exe scripts/check_accuracy.py
Use --only wise-0855 for stacks, --only rw-aur r-dra for saturation checks.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import live_frames, stack_service  # noqa: E402
from app.config import Settings  # noqa: E402
from app.targets import find_target  # noqa: E402


def run(target_id: str, settings: Settings) -> dict:
    target = find_target(target_id)
    if target_id == "wise-0855":
        results = {}
        for size in (120, 300):
            req = stack_service.StackRequest.normalised(
                target.ra,
                target.dec,
                size,
                4.4,
                5.0,
                target.pmra,
                target.pmdec,
                target.epoch,
                target.parallax,
            )
            result = stack_service.stack_result(settings, req).model_dump(mode="json")
            results[str(size)] = result
            print(
                json.dumps(
                    {
                        "size": size,
                        "single_snr": result["single"]["snr"] if result["single"] else None,
                        "tracked_snr": result["tracked"]["snr"] if result["tracked"] else None,
                        "static_snr": result["static"]["snr"] if result["static"] else None,
                        "exposures": result["returned"],
                        "motion": result["motion"],
                    }
                ),
                flush=True,
            )
        return results

    results = {}
    # Shortest detector interval, and the previously checked saturated interval.
    old = (1.6, 1.8) if target_id == "rw-aur" else (2.1, 2.3)
    for lo, hi in ((0.746, 1.117), old):
        frames = live_frames.frame_list(
            settings,
            target.ra,
            target.dec,
            120,
            lo,
            hi,
            target.pmra,
            target.pmdec,
            target.epoch,
            False,
            None,
        )
        complete = 0
        partial = 0
        changed = 0
        for frame in frames.frames:
            exposure = live_frames.find_exposure(settings, frame.exposure_id)
            patch = live_frames.get_patch(
                settings, exposure, frame.center_ra, frame.center_dec, live_frames.patch_pixels(120)
            )
            n = patch.image.shape[0]
            core = patch.image[n // 2 - 1 : n // 2 + 2, n // 2 - 1 : n // 2 + 2]
            complete += int(np.isfinite(core).all())
            partial += int(np.isfinite(core).any() and not np.isfinite(core).all())
            good = np.isfinite(patch.image)
            changed += int(not np.array_equal(patch.image[good], patch.raw[good]))
        report = {
            "returned": frames.returned,
            "total": frames.total,
            "complete_cores": complete,
            "partly_empty_cores": partial,
            "unmasked_pixels_changed": changed,
            "warnings": frames.warnings,
        }
        results[f"{lo}-{hi}"] = report
        print(json.dumps({"target": target_id, "range": [lo, hi], **report}), flush=True)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", nargs="+", default=["wise-0855", "rw-aur", "r-dra"])
    args = parser.parse_args()
    settings = Settings(mode="live")
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    for target_id in args.only:
        result = run(target_id, settings)
        path = settings.cache_dir / f"accuracy-{target_id}.json"
        path.write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(f"Saved {path}", flush=True)


if __name__ == "__main__":
    main()
