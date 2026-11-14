// Small pure helpers for the Stack view, kept apart from the component so they can be tested.

import type { MotionPoint, StackImage } from "./api";

const MJD_OF_UNIX_EPOCH = 40587;

/** Calendar date (UTC) of a Modified Julian Date, as YYYY-MM-DD. */
export function dayOf(mjd: number): string {
  return new Date((mjd - MJD_OF_UNIX_EPOCH) * 86_400_000).toISOString().slice(0, 10);
}

/** Where a point given in stack pixels sits, as percentages from the top-left corner. */
export function spotPercent(x: number, y: number, pixels: number): { left: string; top: string } {
  return { left: `${(x / pixels) * 100}%`, top: `${(y / pixels) * 100}%` };
}

/** "about 19 sigma", or "" when there is no number. */
export function sigmaText(snr: number | null | undefined): string {
  if (snr === null || snr === undefined || !Number.isFinite(snr)) return "";
  return `about ${snr < 10 ? snr.toFixed(1) : Math.round(snr)} sigma`;
}

/** The label under the tracked stack. */
export function stackLabel(image: StackImage): string {
  const sigma = sigmaText(image.snr);
  const count = `${image.n_exposures} exposure${image.n_exposures === 1 ? "" : "s"}`;
  if (image.kind === "single") return sigma ? `1 exposure, ${sigma}` : "1 exposure";
  return `${count} stacked${sigma ? `, ${sigma}` : ""}`;
}

/** An offset east and north in arcseconds, as text such as "3.6″ W, 0.3″ N". */
export function offsetText(east: number | null | undefined, north: number | null | undefined): string {
  if (east === null || east === undefined || north === null || north === undefined) return "too faint";
  const ew = `${Math.abs(east).toFixed(1)}″ ${east >= 0 ? "E" : "W"}`;
  const ns = `${Math.abs(north).toFixed(1)}″ ${north >= 0 ? "N" : "S"}`;
  return `${ew}, ${ns}`;
}

/** Measured offset with its rough uncertainty, for the motion table. */
export function measuredText(point: MotionPoint): string {
  const text = offsetText(point.measured_east_arcsec, point.measured_north_arcsec);
  if (point.measured_east_arcsec === null || point.error_arcsec === null) return text;
  return `${text} (± ${point.error_arcsec.toFixed(1)}″)`;
}
