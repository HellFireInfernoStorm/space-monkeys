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
  // A single exposure is just "1 exposure": its number is in the API, but a peak-of-nine
  // reading on one noisy image is easy to misread as a detection.
  if (image.kind === "single") return "1 exposure";
  return `${count} stacked${sigma ? `, ${sigma}` : ""}`;
}

/** An offset east and north in arcseconds, as text such as "3.6″ W, 0.3″ N". */
export function offsetText(east: number | null | undefined, north: number | null | undefined): string {
  if (east === null || east === undefined || north === null || north === undefined) return "too faint";
  const ew = `${Math.abs(east).toFixed(1)}″ ${east >= 0 ? "E" : "W"}`;
  const ns = `${Math.abs(north).toFixed(1)}″ ${north >= 0 ? "N" : "S"}`;
  return `${ew}, ${ns}`;
}

function axisText(value: number, error: number | null | undefined, positive: string, negative: string): string {
  const spread = error === null || error === undefined ? "" : ` ± ${error.toFixed(1)}`;
  return `${Math.abs(value).toFixed(1)}${spread}″ ${value >= 0 ? positive : negative}`;
}

/** Measured offset with its 1-sigma uncertainty per direction, for the motion table. */
export function measuredText(point: MotionPoint): string {
  const east = point.measured_east_arcsec;
  const north = point.measured_north_arcsec;
  if (east === null || east === undefined || north === null || north === undefined) return "too faint";
  return `${axisText(east, point.error_east_arcsec, "E", "W")}, ${axisText(north, point.error_north_arcsec, "N", "S")}`;
}

/** Predicted offset, with the parallax part named when there is one. */
export function predictedText(point: MotionPoint): string {
  const text = offsetText(point.predicted_east_arcsec, point.predicted_north_arcsec);
  const east = point.parallax_east_arcsec ?? 0;
  const north = point.parallax_north_arcsec ?? 0;
  if (Math.abs(east) < 0.05 && Math.abs(north) < 0.05) return text;
  return `${text} (parallax ${offsetText(east, north)})`;
}

/**
 * Measured minus predicted, and how many standard errors that is in each direction,
 * e.g. "0.5″ E (0.8σ), 0.5″ N (0.9σ)". Empty when there is nothing to compare.
 */
export function differenceText(point: MotionPoint): string {
  const { measured_east_arcsec: east, measured_north_arcsec: north } = point;
  const { error_east_arcsec: errEast, error_north_arcsec: errNorth } = point;
  if (east === null || east === undefined || north === null || north === undefined) return "";
  if (errEast === null || errEast === undefined || errNorth === null || errNorth === undefined) return "";
  const dEast = east - point.predicted_east_arcsec;
  const dNorth = north - point.predicted_north_arcsec;
  const sigma = (value: number, error: number) => (error > 0 ? ` (${(Math.abs(value) / error).toFixed(1)}σ)` : "");
  return (
    `${Math.abs(dEast).toFixed(1)}″ ${dEast >= 0 ? "E" : "W"}${sigma(dEast, errEast)}, ` +
    `${Math.abs(dNorth).toFixed(1)}″ ${dNorth >= 0 ? "N" : "S"}${sigma(dNorth, errNorth)}`
  );
}
