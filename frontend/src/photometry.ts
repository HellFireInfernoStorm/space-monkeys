// Layer 3: pure helpers for the spectrum and light-curve panel. No React, so they are easy to test.

import type { PhotometryPoint } from "./api";

/** One point ready to plot, flux in millijansky. A null flux means "could not be measured". */
export interface PlotPoint {
  x: number;
  y: number | null;
  err: number | null;
}

const TO_MILLIJANSKY: Record<string, number> = { Jy: 1e3, mJy: 1, uJy: 1e-3, µJy: 1e-3 };

/** Factor that turns a flux in `unit` into millijansky. Throws on a unit we do not know. */
export function milliJanskyFactor(unit: string): number {
  const factor = TO_MILLIJANSKY[unit];
  if (factor === undefined) throw new Error(`Unknown flux unit '${unit}'`);
  return factor;
}

export function toPlotPoints(
  points: PhotometryPoint[],
  unit: string,
  x: (point: PhotometryPoint) => number,
): PlotPoint[] {
  const factor = milliJanskyFactor(unit);
  return points.map((p) => ({
    x: x(p),
    y: p.flux === null || p.flux === undefined ? null : p.flux * factor,
    err: p.flux_err === null || p.flux_err === undefined ? null : p.flux_err * factor,
  }));
}

/**
 * Weighted average of the measured points in `bins` equal-width wavelength bins.
 * Weights are 1 / error², so the result's error is 1 / sqrt(sum of weights). Points without
 * a flux or with no positive error are left out; empty bins are left out of the result.
 */
export function binPoints(points: PlotPoint[], bins: number): PlotPoint[] {
  const usable = points.filter((p): p is PlotPoint & { y: number; err: number } => p.y !== null && p.err !== null && p.err > 0);
  if (usable.length === 0 || bins < 1) return [];
  const lo = Math.min(...usable.map((p) => p.x));
  const hi = Math.max(...usable.map((p) => p.x));
  const width = (hi - lo) / bins || 1;
  const sums = Array.from({ length: bins }, () => ({ w: 0, wy: 0, wx: 0 }));
  for (const p of usable) {
    const i = Math.min(bins - 1, Math.floor((p.x - lo) / width));
    const w = 1 / (p.err * p.err);
    sums[i].w += w;
    sums[i].wy += w * p.y;
    sums[i].wx += w * p.x;
  }
  return sums.filter((s) => s.w > 0).map((s) => ({ x: s.wx / s.w, y: s.wy / s.w, err: 1 / Math.sqrt(s.w) }));
}

/** Number of wavelength bins for a binned spectrum: about four points per bin, 3 to 16 bins. */
export function binCount(measured: number): number {
  return Math.max(3, Math.min(16, Math.round(measured / 4)));
}

/**
 * Sky position of a click on an image drawn north up, east left, centred on (raC, decC)
 * and `extentArcsec` wide. `fx` and `fy` are the click as fractions of the image width
 * and height from the top-left corner.
 */
export function clickToSky(
  fx: number,
  fy: number,
  raC: number,
  decC: number,
  extentArcsec: number,
): { ra: number; dec: number } {
  const east = (0.5 - fx) * extentArcsec;
  const north = (0.5 - fy) * extentArcsec;
  const dec = decC + north / 3600;
  const ra = raC + east / 3600 / Math.cos((decC * Math.PI) / 180);
  return { ra: ((ra % 360) + 360) % 360, dec: Math.max(-90, Math.min(90, dec)) };
}

/** Axis range with a little padding, including error bars. Falls back to [0, 1] with no data. */
export function extent(values: number[]): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return [0, 1];
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (lo === hi) {
    lo -= Math.abs(lo) * 0.1 || 1;
    hi += Math.abs(hi) * 0.1 || 1;
  }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

/** About five round tick values covering [lo, hi]. */
export function ticks(lo: number, hi: number, count = 5): number[] {
  const raw = (hi - lo) / count;
  const step0 = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * step0).find((s) => s >= raw) ?? step0 * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

const MJD_OF_UNIX_EPOCH = 40587;

/** MJD to a calendar day, "2025-05-14". */
export function mjdToDay(mjd: number): string {
  return new Date((mjd - MJD_OF_UNIX_EPOCH) * 86_400_000).toISOString().slice(0, 10);
}
