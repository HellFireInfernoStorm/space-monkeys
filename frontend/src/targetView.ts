import type { Target } from "./api";
import type { ViewState } from "./urlState";

/**
 * Default wavelength range (micrometres) that picking a target also selects, so the frames
 * are one colour. These match the ranges scripts/prewarm.py warms, so the pre-warmed data is
 * hit. WISE 0855 is visible only at 4.4 to 5.0 micrometres (docs/SCIENCE.md). A target not
 * listed keeps the current range.
 */
export const SUGGESTED_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  barnard: [1.0, 1.2],
  "eps-ind-b": [1.1, 1.3],
  "wise-0855": [4.4, 5.0],
  "rw-aur": [2.0, 2.4],
  "r-dra": [2.0, 2.4],
};

/** The view change for picking a built-in target: position, motion, epoch, parallax, name, and range if suggested. */
export function viewForTarget(target: Target): Partial<ViewState> {
  const change: Partial<ViewState> = {
    ra: target.ra,
    dec: target.dec,
    pmra: target.pmra,
    pmdec: target.pmdec,
    epoch: target.epoch,
    plx: target.parallax,
    name: target.name,
  };
  const range = SUGGESTED_RANGES[target.id];
  if (range) {
    change.wlmin = range[0];
    change.wlmax = range[1];
  }
  return change;
}
