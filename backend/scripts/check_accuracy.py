"""Reproduce issue #4 live checks; results go to the ignored disk cache.

Run from backend: .venv/Scripts/python.exe scripts/check_accuracy.py
Use --only wise-0855 for stacks, --only rw-aur r-dra for saturation checks.
Use --only eps-ind-b for the isolated-source stack check.
Use --flux-star RA DEC for the H-band comparison star in the RW Aurigae field.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import live_frames, stack_service  # noqa: E402
from app.config import (
    PIXEL_SCALE_ARCSEC,  # noqa: E402
    Settings,  # noqa: E402
)
from app.resample import sky_to_tangent  # noqa: E402
from app.targets import find_target  # noqa: E402


def aperture_flux(image: np.ndarray, x: float, y: float) -> float | None:
    """Diagnostic Jy flux: radius 3 pixels, median sky from radii 5--7.5.

    Reject an incomplete source aperture rather than summing a fractional star.
    This is a validation helper, not the deferred photometry endpoint.
    """
    if min(x, y, image.shape[1] - x, image.shape[0] - y) < 7.5:
        return None
    yy, xx = np.indices(image.shape) + 0.5
    radius = np.hypot(xx - x, yy - y)
    source = image[radius <= 3]
    sky = image[(radius >= 5) & (radius <= 7.5)]
    sky = sky[np.isfinite(sky)]
    if source.size == 0 or not np.isfinite(source).all() or sky.size < 20:
        return None
    solid_angle = np.radians(PIXEL_SCALE_ARCSEC / 3600) ** 2
    return float(np.sum(source - np.median(sky)) * 1e6 * solid_angle)


def comparison_star(settings: Settings, ra: float, dec: float) -> dict:
    """Measure a supplied comparison star in the same RW Aur wavelength matches."""
    target = find_target("rw-aur")
    frames = live_frames.frame_list(
        settings,
        target.ra,
        target.dec,
        400,
        1.6,
        1.8,
        target.pmra,
        target.pmdec,
        target.epoch,
        False,
        None,
    )
    measurements = []
    for frame in frames.frames:
        exposure = live_frames.find_exposure(settings, frame.exposure_id)
        patch = live_frames.get_patch(
            settings, exposure, frame.center_ra, frame.center_dec, live_frames.patch_pixels(400)
        )
        east, north = sky_to_tangent(frame.center_ra, frame.center_dec, np.array([ra]), np.array([dec]))
        n = patch.image.shape[0]
        x, y = n / 2 - float(east[0]) / PIXEL_SCALE_ARCSEC, n / 2 - float(north[0]) / PIXEL_SCALE_ARCSEC
        measurements.append(
            {
                "exposure_id": frame.exposure_id,
                "unmasked_jy": aperture_flux(patch.raw, x, y),
                "masked_jy": aperture_flux(patch.image, x, y),
            }
        )
    result = {"ra": ra, "dec": dec, "warnings": frames.warnings, "measurements": measurements}
    print(json.dumps(result), flush=True)
    return result


def run(target_id: str, settings: Settings) -> dict:
    target = find_target(target_id)
    if target_id in ("wise-0855", "eps-ind-b"):
        results = {}
        for size in (60, 80, 120, 300) if target_id == "wise-0855" else (120,):
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
    parser.add_argument("--flux-star", nargs=2, type=float, metavar=("RA", "DEC"))
    args = parser.parse_args()
    settings = Settings(mode="live")
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    if args.flux_star:
        result = comparison_star(settings, *args.flux_star)
        path = settings.cache_dir / "accuracy-comparison-star.json"
        path.write_text(json.dumps(result, indent=2), encoding="utf-8")
        return
    for target_id in args.only:
        result = run(target_id, settings)
        path = settings.cache_dir / f"accuracy-{target_id}.json"
        path.write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(f"Saved {path}", flush=True)


if __name__ == "__main__":
    main()
