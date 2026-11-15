// Layer 3, phase 4: the spectrum tab's CSV download. Pure, so it is easy to test.

import type { PhotometryResult } from "./api";
import { isUsable, milliJanskyFactor, type PlotPoint, type VisitMean } from "./photometry";

const MJD_OF_UNIX_EPOCH = 40587;

/** MJD to an ISO date and time in UTC, to the second: "2025-05-06T06:08:12Z". */
export function mjdToIso(mjd: number): string {
  return new Date(Math.round((mjd - MJD_OF_UNIX_EPOCH) * 86_400) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** One CSV field: quoted when it holds a comma, a double quote or a line break; inner quotes doubled. */
export function csvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A number without floating-point noise, keeping the precision the API gave. */
function num(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return String(Number(value.toPrecision(12)));
}

export interface CsvContext {
  /** Phase 3's corrected light-curve points (matched to exposures by `id`). */
  corrected: PlotPoint[];
  visits: VisitMean[];
  name: string;
  /** The measured position, and whether it is a fixed point (else the target, along its motion). */
  ra: number;
  dec: number;
  isPoint: boolean;
  moving: boolean;
  wlmin: number | null;
  wlmax: number | null;
  generatedAt: Date;
}

export const CSV_COLUMNS = [
  "exposure_id", "obs_id", "detector", "mjd", "date_utc", "wavelength_um", "bandpass_um", "flux_mjy",
  "flux_err_mjy", "measured", "reason", "flags", "corrected_ratio", "corrected_ratio_err", "visit",
] as const;

function rangeText(wlmin: number | null, wlmax: number | null): string {
  if (wlmin === null && wlmax === null) return "all";
  return `${wlmin ?? "shortest"} to ${wlmax ?? "longest"} µm`;
}

/** The whole file: `#` header lines, the column line, one row per exposure in time order. */
export function photometryCsv(data: PhotometryResult, context: CsvContext): string {
  const factor = milliJanskyFactor(data.flux_unit);
  const corrected = new Map(context.corrected.filter((p) => p.id !== undefined).map((p) => [p.id!, p]));
  const where = context.isPoint ? "fixed point" : context.moving ? "followed along its motion" : "fixed position";
  const header = [
    "# SpaceShift quick-look photometry",
    `# mode: ${data.mode === "mock" ? "mock: synthetic numbers, not measurements of the real sky" : data.mode}`,
    `# position: RA ${context.ra.toFixed(6)}, Dec ${context.dec.toFixed(6)} (ICRS degrees), ${where}`,
    ...(context.name && !context.isPoint ? [`# target: ${context.name}`] : []),
    `# wavelength range: ${rangeText(context.wlmin, context.wlmax)}`,
    `# method: ${data.method}`,
    "# flux_mjy, flux_err_mjy: millijansky; empty when the exposure could not be measured",
    "# bandpass_um: full width of the bandpass",
    "# corrected_ratio: flux / binned spectrum at the exposure's wavelength (docs/SCIENCE.md section 7); empty where not corrected",
    "# visit: 1-based visit of the corrected light curve; empty when the exposure is not in a visit average",
    `# generated: ${context.generatedAt.toISOString().replace(/\.\d{3}Z$/, "Z")}`,
    CSV_COLUMNS.join(","),
  ];
  const rows = [...data.points].sort((a, b) => a.mjd - b.mjd).map((p) => {
    const measured = isUsable(p);
    const c = corrected.get(p.exposure_id);
    const ratio = c && c.y !== null ? c.y : null;
    const inVisit = ratio !== null && c!.err !== null && c!.err > 0;
    const visit = inVisit ? context.visits.findIndex((v) => p.mjd >= v.start && p.mjd <= v.end) : -1;
    return [
      p.exposure_id, p.obs_id, p.det_id, num(p.mjd), mjdToIso(p.mjd), num(p.wavelength), num(p.lambda_width),
      measured ? num(p.flux! * factor) : "", measured && p.flux_err !== null && p.flux_err !== undefined ? num(p.flux_err * factor) : "",
      measured, p.reason ?? "", p.flags, num(ratio), ratio === null ? "" : num(c!.err), visit >= 0 ? visit + 1 : "",
    ].map(csvField).join(",");
  });
  return [...header, ...rows].join("\n") + "\n";
}

/** "spaceshift-wise-0855-4.4-5um.csv" (lower case, as file names usually are); "-mock" is added in mock mode so it is never taken for real data. */
export function csvFileName(context: Pick<CsvContext, "name" | "ra" | "dec" | "isPoint" | "wlmin" | "wlmax">, mock: boolean): string {
  const slug = context.name && !context.isPoint
    ? context.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    : `ra${context.ra.toFixed(5)}-dec${context.dec.toFixed(5)}`;
  const range = context.wlmin === null && context.wlmax === null
    ? "all" : `${context.wlmin ?? "min"}-${context.wlmax ?? "max"}um`;
  return `spaceshift-${slug}-${range}${mock ? "-mock" : ""}.csv`;
}
