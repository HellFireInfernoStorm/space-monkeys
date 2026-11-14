import type { Target } from "./api";
import { DEFAULT_VIEW, type ViewState } from "./urlState";

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

/**
 * The view change for a position typed by hand. If it is not the current position, the motion,
 * parallax, epoch, name and "follow the object" setting of the picked target no longer apply,
 * so they go back to their defaults. `typed` holds motion fields the user edited by hand.
 */
export function viewForTypedPosition(
  view: ViewState,
  ra: number,
  dec: number,
  typed: Partial<Pick<ViewState, "pmra" | "pmdec" | "plx" | "epoch">> = {},
): Partial<ViewState> {
  if (ra === view.ra && dec === view.dec) return { ra, dec, ...typed };
  return {
    ra,
    dec,
    pmra: typed.pmra ?? DEFAULT_VIEW.pmra,
    pmdec: typed.pmdec ?? DEFAULT_VIEW.pmdec,
    plx: typed.plx ?? DEFAULT_VIEW.plx,
    epoch: typed.epoch ?? DEFAULT_VIEW.epoch,
    name: "",
    track: false,
  };
}
