// Layer 3: pure helpers for the spectrum and light-curve panel. No React, so they are easy to test.

import type { PhotometryPoint } from "./api";

/** One point ready to plot, flux in millijansky. A null flux means "could not be measured". */
export interface PlotPoint {
  x: number;
  y: number | null;
  err: number | null;
  /** Half-width of a horizontal bar, in x units (the bandpass on a spectrum). */
  xerr?: number;
  /** Wavelength in micrometres, for colouring a light curve. */
  wavelength?: number;
  /** Hover text. */
  label?: string;
}

const TO_MILLIJANSKY: Record<string, number> = { Jy: 1e3, mJy: 1, uJy: 1e-3, µJy: 1e-3 };

/** Factor that turns a flux in `unit` into millijansky. Throws on a unit we do not know. */
export function milliJanskyFactor(unit: string): number {
  const factor = TO_MILLIJANSKY[unit];
  if (factor === undefined) throw new Error(`Unknown flux unit '${unit}'`);
  return factor;
}

/** A point is measured only if the server says so and gave a number. */
export function isUsable(p: PhotometryPoint): boolean {
  return p.usable !== false && p.flux !== null && p.flux !== undefined;
}

/** Hover text for one point: date, wavelength and bandpass, flux, or why it was not measured. */
export function pointLabel(p: PhotometryPoint, factor: number): string {
  const lines = [
    `${mjdToDay(p.mjd)} (MJD ${p.mjd.toFixed(2)}), detector ${p.det_id}`,
    `${p.wavelength.toFixed(3)} ± ${(p.lambda_width / 2).toFixed(3)} µm`,
  ];
  if (isUsable(p)) {
    lines.push(`${((p.flux as number) * factor).toPrecision(3)} ± ${((p.flux_err ?? 0) * factor).toPrecision(2)} mJy`);
  } else {
    lines.push(`Not measured: ${p.reason ?? "flagged or missing pixels in the aperture"}`);
  }
  lines.push(p.exposure_id);
  return lines.join("\n");
}

export function toPlotPoints(
  points: PhotometryPoint[],
  unit: string,
  x: (point: PhotometryPoint) => number,
  options: { bandpass?: boolean } = {},
): PlotPoint[] {
  const factor = milliJanskyFactor(unit);
  return points.map((p) => {
    const usable = isUsable(p);
    return {
      x: x(p),
      y: usable ? (p.flux as number) * factor : null,
      err: usable && p.flux_err !== null && p.flux_err !== undefined ? p.flux_err * factor : null,
      xerr: options.bandpass ? p.lambda_width / 2 : undefined,
      wavelength: p.wavelength,
      label: pointLabel(p, factor),
    };
  });
}

// One blue hue, light (shortest wavelength) to dark (longest): the reference sequential
// ramp, steps 100, 250, 400 and 500, checked for contrast against the page background.
const WAVELENGTH_RAMP = ["#cde2fb", "#86b6ef", "#3987e5", "#256abf"];

/** Colour for a wavelength within [lo, hi]: light blue at lo, dark blue at hi. */
export function wavelengthColour(wavelength: number, lo: number, hi: number): string {
  const t = hi > lo ? Math.min(1, Math.max(0, (wavelength - lo) / (hi - lo))) : 0;
  const scaled = t * (WAVELENGTH_RAMP.length - 1);
  const i = Math.min(WAVELENGTH_RAMP.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const a = WAVELENGTH_RAMP[i];
  const b = WAVELENGTH_RAMP[i + 1];
  const channel = (k: number) =>
    Math.round(parseInt(a.slice(1 + 2 * k, 3 + 2 * k), 16) * (1 - f) + parseInt(b.slice(1 + 2 * k, 3 + 2 * k), 16) * f);
  return "#" + [0, 1, 2].map((k) => channel(k).toString(16).padStart(2, "0")).join("");
}

export const WAVELENGTH_GRADIENT = `linear-gradient(to right, ${WAVELENGTH_RAMP.join(", ")})`;

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
