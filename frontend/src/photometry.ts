// Layer 3: pure helpers for the spectrum and light-curve panel. No React, so they are easy to test.

import type { Band, PhotometryPoint } from "./api";

/** One point ready to plot, in mJy or AB magnitude. Null means no value in the chosen unit. */
export interface PlotPoint {
  id?: string;
  mjd?: number;
  detector?: number;
  reason?: string | null;
  details?: PointDetails;
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

export interface PointDetails {
  date?: string;
  wavelength: string;
  value: string;
  detector?: string;
  exposure?: string;
}

/** One formatting path for cards, accessible labels and binned points. */
export function pointDetails(p: PlotPoint): PointDetails {
  return p.details ?? {
    wavelength: `${p.x.toFixed(3)} µm`,
    value: p.y === null ? `Not measured: ${p.reason ?? "flagged or missing pixels in the aperture"}`
      : `${p.y.toPrecision(3)} ± ${(p.err ?? 0).toPrecision(2)} mJy`,
  };
}

function measurementDetails(p: PhotometryPoint, factor: number): PointDetails {
  return {
    date: `${mjdToDay(p.mjd)} (MJD ${p.mjd.toFixed(2)})`,
    wavelength: `${p.wavelength.toFixed(3)} ± ${(p.lambda_width / 2).toFixed(3)} µm`,
    value: isUsable(p)
      ? `${(p.flux! * factor).toPrecision(3)} ± ${((p.flux_err ?? 0) * factor).toPrecision(2)} mJy`
      : `Not measured: ${p.reason ?? "flagged or missing pixels in the aperture"}`,
    detector: `Detector ${p.det_id}`,
    exposure: p.exposure_id,
  };
}

/** Accessible text uses the same formatted fields as the visible card. */
export function pointLabel(p: PhotometryPoint, factor: number): string {
  return Object.values(measurementDetails(p, factor)).join("\n");
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
    const details = measurementDetails(p, factor);
    return {
      id: p.exposure_id,
      mjd: p.mjd,
      detector: p.det_id,
      reason: p.reason,
      details,
      x: x(p),
      y: usable ? (p.flux as number) * factor : null,
      err: usable && p.flux_err !== null && p.flux_err !== undefined ? p.flux_err * factor : null,
      xerr: options.bandpass ? p.lambda_width / 2 : undefined,
      wavelength: p.wavelength,
      label: Object.values(details).join("\n"),
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
  const usable = usableForBins(points);
  if (usable.length === 0 || bins < 1) return [];
  const lo = Math.min(...usable.map((p) => p.x));
  const width = binWidth(points, bins);
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

type BinnablePoint = PlotPoint & { y: number; err: number };

/** Points that take part in binning: measured, with a positive error. */
function usableForBins(points: PlotPoint[]): BinnablePoint[] {
  return points.filter((p): p is BinnablePoint => p.y !== null && p.err !== null && p.err > 0);
}

/** Width of each bin in `binPoints`, in x units. One definition, shared with `spectrumAt`. */
export function binWidth(points: PlotPoint[], bins: number): number {
  const usable = usableForBins(points);
  if (usable.length === 0 || bins < 1) return 1;
  const lo = Math.min(...usable.map((p) => p.x));
  const hi = Math.max(...usable.map((p) => p.x));
  return (hi - lo) / bins || 1;
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

/** Split text into plain parts and web addresses, so addresses can be shown as links. */
export function splitLinks(text: string): Array<{ text: string; href?: string }> {
  const parts: Array<{ text: string; href?: string }> = [];
  let last = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s)]+[^\s).,;]/g)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at) });
    parts.push({ text: match[0], href: match[0] });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** A short label for a link: "issue #4" for a GitHub issue, else the host name. */
export function linkLabel(href: string): string {
  const issue = href.match(/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
  if (issue) return `issue #${issue[1]}`;
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
}

const MJD_OF_UNIX_EPOCH = 40587;

/** MJD to a calendar day, "2025-05-14". */
export function mjdToDay(mjd: number): string {
  return new Date((mjd - MJD_OF_UNIX_EPOCH) * 86_400_000).toISOString().slice(0, 10);
}


/** Clip API bands to the axis, splitting adjacent overlaps at their midpoint. */
export function bandStrips(bands: Band[], x0: number, x1: number) {
  const sorted = [...bands].sort((a, b) => a.wl_min_um - b.wl_min_um);
  return sorted.map((band, i) => {
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    const left = prev && prev.wl_max_um > band.wl_min_um
      ? (prev.wl_max_um + band.wl_min_um) / 2 : band.wl_min_um;
    const right = next && band.wl_max_um > next.wl_min_um
      ? (band.wl_max_um + next.wl_min_um) / 2 : band.wl_max_um;
    return { band: band.band, left: Math.max(x0, left), right: Math.min(x1, right) };
  }).filter((band) => band.right > band.left);
}

/** Pixel-space search; equal distances keep the first point in input order. */
export function nearestPoint<T extends { px: number; py: number }>(points: T[], px: number, py: number, maxDistance = 24): T | undefined {
  let nearest: T | undefined;
  let distance = maxDistance ** 2;
  for (const point of points) {
    const d = (point.px - px) ** 2 + (point.py - py) ** 2;
    if (d <= distance && (!nearest || d < distance)) {
      nearest = point;
      distance = d;
    }
  }
  return nearest;
}

/** All chart geometry uses CSS pixels, including the separate missing-value lane. */
export function chartGeometry(points: PlotPoint[], width: number, height = CHART_HEIGHT, invertY = false, extraY: number[] = []) {
  const lane = points.some((p) => p.y === null) ? 18 : 0;
  const plot = { left: 64, top: 22, width: Math.max(1, width - 108), height: height - 66 - lane };
  const [x0, x1] = extent(points.map((p) => p.x));
  const [y0, y1] = extent([...points.filter((p) => p.y !== null).flatMap((p) => [p.y! - (p.err ?? 0), p.y! + (p.err ?? 0)]), ...extraY]);
  const sx = (x: number) => plot.left + (x - x0) / (x1 - x0) * plot.width;
  const sy = (y: number) => plot.top + (invertY ? (y - y0) / (y1 - y0) : 1 - (y - y0) / (y1 - y0)) * plot.height;
  const floor = plot.top + plot.height;
  return { sx, sy, x0, x1, y0, y1, plot, floor, lane,
    xTicks: ticks(x0, x1, Math.max(1, Math.floor(plot.width / 100))), yTicks: ticks(y0, y1, 5),
    positioned: points.map((point) => ({ point, px: sx(point.x), py: point.y === null ? floor + 10 : sy(point.y) })),
  };
}


export const CHART_HEIGHT = 220;

export function pointKey(point: PlotPoint): string {
  return point.id ?? `bin:${point.x}`;
}

export interface ChartSelection { chart: string; key: string }
export interface ChartSelections { keyboard?: ChartSelection; pointer?: ChartSelection }
export type SelectionKind = keyof ChartSelections;

/** Leaving one chart cannot clear a selection owned by the other chart. */
export function selectChartPoint(state: ChartSelections, chart: string, kind: SelectionKind, key?: string): ChartSelections {
  if (key === undefined && state[kind]?.chart !== chart) return state;
  return { ...state, [kind]: key === undefined ? undefined : { chart, key } };
}

/** One label per displayed x value (e.g. calendar dates instead of fractional days). */
export function uniqueTicks(values: number[], format: (value: number) => string): number[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const label = format(value);
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });
}

// Threshold from docs/SCIENCE.md section 6; this verdict uses aperture S/N, not PSF significance.
export const SIGNAL_THRESHOLD = 5;
// Oke & Gunn (1983), AB definition; input fluxes here are mJy.
export const AB_ZERO_POINT_JY = 3631;
// backend/app/wise.py, BANDS / wavelength_um. Centres only, not filter widths.
export const WISE_BANDS = [{ name: "WISE W1", wavelength: 3.4 }, { name: "WISE W2", wavelength: 4.6 }];
// docs/SCIENCE.md section 7: aperture and background annulus, in detector pixels.
export const PIXEL_SCALE_ARCSEC = 6.15;
export const APERTURE_RADIUS_PIXELS = 3;
export const BACKGROUND_RADII_PIXELS = [5, 7.5] as const;

// Visit grouping is a display convention; rationale and WISE dates: docs/SCIENCE.md section 7.
export function groupVisits(mjds: number[], gapDays = 60): Array<{ start: number; end: number; count: number }> {
  const visits: Array<{ start: number; end: number; count: number }> = [];
  for (const mjd of [...mjds].sort((a, b) => a - b)) {
    const last = visits.at(-1);
    if (!last || mjd - last.end > gapDays) visits.push({ start: mjd, end: mjd, count: 1 });
    else { last.end = mjd; last.count++; }
  }
  return visits;
}

export function summarise(points: PlotPoint[]) {
  const measured = points.filter((p) => p.y !== null);
  const withError = measured.filter((p): p is PlotPoint & { y: number; err: number } => p.err !== null && p.err > 0);
  const snrs = withError.map((p) => p.y / p.err).sort((a, b) => a - b);
  const middle = Math.floor(snrs.length / 2);
  const meanPoint = binPoints(points, 1)[0];
  const mean = meanPoint ? { y: meanPoint.y!, err: meanPoint.err! } : undefined;
  const combinedSnr = mean ? mean.y / mean.err : undefined;
  const bins = binPoints(points, binCount(withError.length));
  const brightest = bins.reduce<PlotPoint | undefined>((best, p) => !best || p.y! > best.y! ? p : best, undefined);
  const wavelengths = points.map((p) => p.wavelength ?? p.x);
  const mjds = points.flatMap((p) => p.mjd === undefined ? [] : [p.mjd]);
  return {
    measured: measured.length, snrMeasured: withError.length, total: points.length, bins,
    wlMin: wavelengths.length ? Math.min(...wavelengths) : undefined,
    wlMax: wavelengths.length ? Math.max(...wavelengths) : undefined,
    firstMjd: mjds.length ? Math.min(...mjds) : undefined,
    lastMjd: mjds.length ? Math.max(...mjds) : undefined,
    visits: groupVisits(mjds), mean, combinedSnr,
    medianSnr: snrs.length ? (snrs.length % 2 ? snrs[middle] : (snrs[middle - 1] + snrs[middle]) / 2) : undefined,
    brightest: combinedSnr !== undefined && combinedSnr >= SIGNAL_THRESHOLD ? brightest?.x : undefined,
  };
}

export function verdict(summary: ReturnType<typeof summarise>, { mock, warned }: { mock: boolean; warned: boolean }): {
  tone: "clear" | "combined" | "none" | "empty"; text: string;
} {
  let tone: "clear" | "combined" | "none" | "empty";
  let text: string;
  if (!summary.measured) {
    tone = "empty";
    text = "No measurement: every aperture holds flagged or missing pixels.";
  } else if (summary.combinedSnr === undefined) {
    tone = "none";
    text = "S/N unavailable: measured aperture fluxes have no positive background-noise errors.";
  } else if (summary.medianSnr! >= SIGNAL_THRESHOLD) {
    tone = "clear";
    text = `Clear signal in single exposures (typical S/N ${summary.medianSnr!.toFixed(1)}).`;
  } else if (summary.combinedSnr! >= SIGNAL_THRESHOLD) {
    tone = "combined";
    text = `Signal only when exposures are combined (S/N ${summary.combinedSnr!.toFixed(1)}); about ${summary.medianSnr!.toFixed(1)} in a single exposure. The Stacked view in the frame player is the better way to see a faint object.`;
  } else {
    tone = "none";
    text = `No clear signal in this wavelength range (combined S/N ${summary.combinedSnr!.toFixed(1)}).`;
  }
  if (warned) text += " The warning above says what else may be in the aperture.";
  if (mock) text += " (Synthetic data.)";
  return { tone, text };
}

export function toAbMag(mJy: number, errMJy: number): { mag: number; err: number } | null {
  if (mJy <= 0) return null;
  return { mag: -2.5 * Math.log10(mJy / (AB_ZERO_POINT_JY * 1000)), err: (2.5 / Math.LN10) * errMJy / mJy };
}

/** Convert only after averaging in flux space; retain raw flux in every tooltip. */
export function magnitudePoints(points: PlotPoint[]): PlotPoint[] {
  return points.map((p) => {
    if (p.y === null) return p;
    const converted = toAbMag(p.y, p.err ?? 0);
    const raw = pointDetails(p);
    const details = { ...raw, value: converted
      ? `${converted.mag.toFixed(2)} ± ${converted.err.toFixed(2)} AB mag (${raw.value})`
      : `No magnitude: flux ${p.y.toPrecision(3)} ± ${(p.err ?? 0).toPrecision(2)} mJy is not above zero` };
    return { ...p, y: converted?.mag ?? null, err: converted ? (p.err === null ? null : converted.err) : null,
      details, label: Object.values(details).join("\n") };
  });
}

// Layer 3, phase 3: colour-corrected light curve. Method, assumptions and validation:
// docs/SCIENCE.md, section 7, "Colour-corrected light curve".

/** Exposure-to-exposure scatter of a steady 0.14 Jy check star (docs/SCIENCE.md section 7). */
export const NOISE_FLOOR = 0.038;
/** A visit needs this many corrected exposures before the change verdict uses it. */
export const MIN_POINTS_PER_VISIT = 3;
/** Visit-to-visit change threshold: the same S/N threshold as the detection (docs/SCIENCE.md section 6). */
export const CHANGE_THRESHOLD = SIGNAL_THRESHOLD;
/** Below CHANGE_THRESHOLD but at least this: reported as unclear, never as a change. */
export const HINT_THRESHOLD = 3;

/**
 * The binned spectrum at `wavelength`: the bin's own value at a bin centre; elsewhere linear between
 * bin centres (error: the larger of the two),
 * the end bin's value up to one bin width beyond the outermost centres. Null where the spectrum is
 * too uncertain to divide by: outside that reach, across a gap of more than two bin widths between
 * centres, at or below zero, or with S/N under SIGNAL_THRESHOLD.
 */
export function spectrumAt(bins: PlotPoint[], wavelength: number, width: number): { y: number; err: number } | null {
  const sorted = usableForBins(bins).sort((a, b) => a.x - b.x);
  if (sorted.length === 0) return null;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  // At a bin centre no interpolation is needed: use that bin alone, without its neighbours'
  // errors or gaps. A one-exposure bin's centre is that exposure's wavelength, up to rounding.
  const exact = sorted.find((p) => Math.abs(p.x - wavelength) <= 1e-9 * Math.max(width, Math.abs(p.x)));
  let value: { y: number; err: number };
  if (exact) {
    value = { y: exact.y, err: exact.err };
  } else if (wavelength <= first.x) {
    if (first.x - wavelength > width) return null;
    value = { y: first.y, err: first.err };
  } else if (wavelength >= last.x) {
    if (wavelength - last.x > width) return null;
    value = { y: last.y, err: last.err };
  } else {
    const i = sorted.findIndex((p, k) => p.x <= wavelength && wavelength < sorted[k + 1].x);
    const a = sorted[i];
    const b = sorted[i + 1];
    if (b.x - a.x > 2 * width * (1 + 1e-9)) return null;
    const t = (wavelength - a.x) / (b.x - a.x);
    value = { y: a.y + (b.y - a.y) * t, err: Math.max(a.err, b.err) };
  }
  if (value.y <= 0 || value.y / value.err < SIGNAL_THRESHOLD) return null;
  return value;
}

/**
 * Light-curve points (flux in mJy, x = MJD, `wavelength` set) divided by the binned spectrum at each
 * exposure's wavelength: 1 means the usual brightness at that colour. Error of r = f / S:
 * sqrt(err_f² + (r × err_S)²) / S. Exposures where the spectrum is too uncertain become
 * value-less points with a reason, so they stay visible in the lane.
 */
export function correctedPoints(points: PlotPoint[], bins: PlotPoint[], width: number): PlotPoint[] {
  return points.map((p) => {
    if (p.y === null) return p;
    const raw = pointDetails(p);
    const spectrum = p.wavelength === undefined ? null : spectrumAt(bins, p.wavelength, width);
    if (!spectrum) {
      const details = { ...raw, value: `Not corrected: the spectrum is too uncertain at ${(p.wavelength ?? p.x).toFixed(3)} µm` };
      return { ...p, y: null, err: null, reason: details.value, details, label: Object.values(details).join("\n") };
    }
    const r = p.y / spectrum.y;
    const err = p.err === null ? null : Math.sqrt(p.err ** 2 + (r * spectrum.err) ** 2) / spectrum.y;
    const details = { ...raw, value: `${r.toFixed(3)}${err === null ? "" : ` ± ${err.toFixed(3)}`} of normal (${raw.value})` };
    return { ...p, y: r, err, details, label: Object.values(details).join("\n") };
  });
}

export interface VisitMean { start: number; end: number; mjd: number; count: number; r: number; errFormal: number; err: number }

/**
 * Inverse-variance weighted mean of the corrected exposures in each visit. `err` adds the noise
 * floor in quadrature and is deliberately not reduced by the number of exposures (docs/SCIENCE.md).
 */
export function visitMeans(corrected: PlotPoint[], gapDays = 60, floor = NOISE_FLOOR): VisitMean[] {
  const usable = usableForBins(corrected).filter((p) => p.mjd !== undefined);
  return groupVisits(usable.map((p) => p.mjd!), gapDays).map((visit) => {
    const members = usable.filter((p) => p.mjd! >= visit.start && p.mjd! <= visit.end);
    let w = 0, wr = 0, wt = 0;
    for (const p of members) {
      const weight = 1 / (p.err * p.err);
      w += weight;
      wr += weight * p.y;
      wt += weight * p.mjd!;
    }
    const errFormal = 1 / Math.sqrt(w);
    return { start: visit.start, end: visit.end, mjd: wt / w, count: members.length, r: wr / w, errFormal,
      err: Math.sqrt(errFormal ** 2 + floor ** 2) };
  });
}

// backend/app/photometry.py: the purely informational photometry notes. The unmeasured points
// already show in the "Not measured" lane with their reasons, and the sampling note says the
// exposures were spread evenly over time (the Measured tile says so too).
const INFORMATIONAL_NOTES = [
  /^\d+ of \d+ point\(s\) have no flux: /,
  /^Measured \d+ of \d+ matching exposures, spread evenly over time\.$/,
];

/**
 * API warnings that make the numbers less trustworthy: a field star in the aperture, a failed search,
 * unreadable exposures, or anything not known to be informational. Used to withhold the change verdict.
 */
export function cautionWarnings(warnings: string[] | null | undefined): string[] {
  return (warnings ?? []).filter((w) => !INFORMATIONAL_NOTES.some((note) => note.test(w)));
}

export interface ChangeVerdict { tone: "change" | "unclear" | "steady" | "unjudged"; value: string; detail: string }

/** Plain answer to "did the aperture's brightness change between visits?", or why it is not judged. */
export function changeVerdict(visits: VisitMean[], { warned, mock, available }: { warned: boolean; mock: boolean; available: boolean }): ChangeVerdict {
  const suffix = mock ? " (synthetic)" : "";
  const unjudged = (detail: string): ChangeVerdict => ({ tone: "unjudged", value: "Not judged", detail: detail + suffix });
  if (warned) return unjudged("see the warning above");
  if (!available) return unjudged("spectrum too uncertain");
  const qualifying = visits.filter((v) => v.count >= MIN_POINTS_PER_VISIT);
  if (qualifying.length < 2) return unjudged(`needs 2 visits with ${MIN_POINTS_PER_VISIT}+ exposures each`);
  let largest = { z: -1, delta: 0 };
  let tightest = Infinity;
  for (let i = 0; i < qualifying.length; i++) {
    for (let j = i + 1; j < qualifying.length; j++) {
      const a = qualifying[i];
      const b = qualifying[j];
      const combined = Math.sqrt(a.err ** 2 + b.err ** 2);
      const z = Math.abs(a.r - b.r) / combined;
      if (z > largest.z) largest = { z, delta: Math.abs(a.r - b.r) };
      tightest = Math.min(tightest, combined);
    }
  }
  const delta = Math.round(largest.delta * 100);
  if (largest.z >= CHANGE_THRESHOLD) {
    return { tone: "change", value: "Yes", detail: `visits differ by ${delta}% (${largest.z.toFixed(1)} times the combined error)${suffix}` };
  }
  // A visit too small to compare is still drawn, so a quiet verdict must say it was left out.
  const left = visits.length - qualifying.length;
  const leftOut = left ? `; ${left} ${left === 1 ? "visit" : "visits"} with fewer than ${MIN_POINTS_PER_VISIT} exposures not compared` : "";
  if (largest.z >= HINT_THRESHOLD) return { tone: "unclear", value: "Unclear", detail: `visits differ by ${delta}%; not significant${leftOut}${suffix}` };
  // A limit on the visit averages, not on the object: self-dilution makes real changes look smaller.
  return { tone: "steady", value: "No sign", detail: `visits agree; a change under ${Math.round(CHANGE_THRESHOLD * tightest * 100)}% could not be seen${leftOut}${suffix}` };
}
