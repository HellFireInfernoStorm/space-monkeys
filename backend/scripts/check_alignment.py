"""Reproducible real-data check, never part of the offline test suite.

Run from backend/: python scripts/check_alignment.py --target barnard --output .cache/alignment.json
Results include rejections; an insufficient-reference result is not a detection.
"""

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import astrometry, live_frames  # noqa: E402
from app.config import Settings  # noqa: E402
from app.targets import find_target, position_at_mjd  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["barnard", "wise-0855"], required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    settings = Settings(mode="live", max_probes=20, _env_file=None)
    target = find_target(args.target)
    assert target is not None
    lo, hi = (4.4, 5.0) if args.target == "wise-0855" else (1.0, 1.1)
    rows, notes, failed, capped = live_frames.matching_exposures(
        settings, target.ra, target.dec, lo, hi, target.pmra, target.pmdec, target.epoch,
    )
    output = {"target": args.target, "wavelength_um": [lo, hi], "notes": notes,
              "failed_probes": failed, "probe_capped": capped, "results": []}
    for exposure, wavelength in rows[:2]:
        ra, dec = position_at_mjd(
            target.ra, target.dec, target.pmra, target.pmdec, target.epoch, exposure.mjd,
        )
        for run in ("cold", "warm"):
            start = time.monotonic()
            result = astrometry.solve(settings, exposure.exposure_id, ra, dec, ra, dec)
            output["results"].append({"run": run, "wall_s": time.monotonic()-start,
                                      "wavelength_um": wavelength, **result.model_dump()})
        print(json.dumps(output["results"][-2:], indent=2))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2)+"\n", encoding="utf-8")
    if not rows:
        print("No matching exposures available; no verification claimed.")


if __name__ == "__main__":
    main()
