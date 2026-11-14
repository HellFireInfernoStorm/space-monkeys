import type { Target } from "./api";
import type { ViewState } from "./urlState";

/**
 * Wavelength ranges (micrometres) that picking a target also selects, for targets that
 * cannot be seen elsewhere. WISE 0855 is visible only at 4.4 to 5.0 micrometres
 * (docs/SCIENCE.md). Targets not listed keep the current range.
 */
export const SUGGESTED_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  "wise-0855": [4.4, 5.0],
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
