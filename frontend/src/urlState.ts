// All view state lives in the URL, so any view can be shared or embedded with a link.
// A new control means a new field here, a new line in parseView and serializeView,
// and a new case in urlState.test.ts.

import { isSkyLayer, type SkyLayer } from "./skyMaps";

export type { SkyLayer };

export type ViewMode = "blink" | "diff" | "stack";
export type WiseBand = "W1" | "W2";
export type CompareMode = "side" | "blink";
export type CoordinateFrame = "ICRS" | "ICRSd" | "Galactic";
export type WorkbenchTab = "sky" | "spectrum";

export interface ViewState {
  /** Right Ascension in degrees (ICRS) at `epoch`. Null until a position is chosen. */
  ra: number | null;
  /** Declination in degrees (ICRS) at `epoch`. */
  dec: number | null;
  /** Width of the image on the sky, arcseconds. */
  size: number;
  /** Shortest wavelength shown, micrometres. Null means no limit. */
  wlmin: number | null;
  /** Longest wavelength shown, micrometres. Null means no limit. */
  wlmax: number | null;
  /** Proper motion in RA (including cos(dec)), milliarcseconds per year. */
  pmra: number;
  /** Proper motion in Dec, milliarcseconds per year. */
  pmdec: number;
  /** Decimal year for which `ra` and `dec` are given. */
  epoch: number;
  /** Parallax, milliarcseconds. Used only for the predicted positions in the Stack view. */
  plx: number;
  /** Playback speed, frames per second. */
  speed: number;
  /** Plain frames, each frame minus the first one, or many exposures added together. */
  mode: ViewMode;
  /** Re-centre every frame on the moving object. */
  track: boolean;
  /** Background survey in the wide-field sky map (the values are in `skyMaps.ts`). */
  sky: SkyLayer;
  /**
   * For a sky map that is a wavelength cube: the frame shown, 1-based as its label shows it.
   * Null follows the default (the frame nearest the middle of the wavelength range).
   */
  skyf: number | null;
  frame: CoordinateFrame;
  tab: WorkbenchTab;
  /** Label of the chosen target, for display only. */
  name: string;
  /** Show the spectrum and light-curve panel (layer 3). */
  phot: boolean;
  /**
   * The point measured in that panel: Right Ascension and Declination in degrees, a fixed
   * spot on the sky. Null means the target itself, followed along its motion.
   */
  pra: number | null;
  pdec: number | null;
  /** Overlay inverse-variance wavelength bins on the raw spectrum. */
  bin: boolean;
  /** Display units for both photometry charts; measurements stay in flux space. */
  unit: "mjy" | "ab";
  /** Layer 4: compare with this WISE band (2010). Null hides the comparison. */
  wise: WiseBand | null;
  /** Layer 4: the two images side by side, or blinking between them. */
  cmp: CompareMode;
}

export const DEFAULT_VIEW: ViewState = {
  ra: null,
  dec: null,
  size: 120,
  wlmin: null,
  wlmax: null,
  pmra: 0,
  pmdec: 0,
  epoch: 2000,
  plx: 0,
  speed: 2,
  mode: "blink",
  track: false,
  sky: "wise",
  skyf: null,
  frame: "ICRSd",
  tab: "sky",
  name: "",
  phot: false,
  pra: null,
  pdec: null,
  bin: true,
  unit: "mjy",
  wise: null,
  cmp: "side",
};

export const LIMITS = {
  size: [30, 600],
  speed: [0.5, 20],
  epoch: [1900, 2100],
  plx: [0, 1000],
} as const;

function numberIn(value: string | null, min: number, max: number): number | null {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function wholeNumber(n: number | null): number | null {
  return n !== null && Number.isInteger(n) ? n : null;
}

/** Fixed number of decimals, without trailing zeros. */
function trim(n: number, decimals: number): string {
  return String(Number(n.toFixed(decimals)));
}

/** Read the view from a query string such as "?ra=10&dec=20". Bad values fall back to defaults. */
export function parseView(search: string): ViewState {
  const p = new URLSearchParams(search);
  const ra = numberIn(p.get("ra"), 0, 360);
  const dec = numberIn(p.get("dec"), -90, 90);
  const hasPosition = ra !== null && dec !== null;
  const pra = numberIn(p.get("pra"), 0, 360);
  const pdec = numberIn(p.get("pdec"), -90, 90);
  const hasPoint = pra !== null && pdec !== null;
  const mode = p.get("mode");
  const sky = p.get("sky");
  return {
    ra: hasPosition ? ra : null,
    dec: hasPosition ? dec : null,
    size: numberIn(p.get("size"), ...LIMITS.size) ?? DEFAULT_VIEW.size,
    wlmin: numberIn(p.get("wlmin"), 0, 100),
    wlmax: numberIn(p.get("wlmax"), 0, 100),
    pmra: numberIn(p.get("pmra"), -1e6, 1e6) ?? DEFAULT_VIEW.pmra,
    pmdec: numberIn(p.get("pmdec"), -1e6, 1e6) ?? DEFAULT_VIEW.pmdec,
    epoch: numberIn(p.get("epoch"), ...LIMITS.epoch) ?? DEFAULT_VIEW.epoch,
    plx: numberIn(p.get("plx"), ...LIMITS.plx) ?? DEFAULT_VIEW.plx,
    speed: numberIn(p.get("speed"), ...LIMITS.speed) ?? DEFAULT_VIEW.speed,
    mode: mode === "diff" || mode === "stack" ? mode : "blink",
    track: p.get("track") === "1",
    sky: isSkyLayer(sky) ? sky : "wise",
    skyf: wholeNumber(numberIn(p.get("skyf"), 1, 10000)),
    frame: p.get("frame") === "ICRS" || p.get("frame") === "Galactic"
      ? p.get("frame") as CoordinateFrame : "ICRSd",
    // Old measurement links should still open their spectrum panel.
    tab: p.get("tab") === "spectrum" || (!p.has("tab") && p.get("phot") === "1")
      ? "spectrum" : "sky",
    name: (p.get("name") ?? "").slice(0, 80),
    phot: p.get("phot") === "1",
    pra: hasPoint ? pra : null,
    pdec: hasPoint ? pdec : null,
    bin: p.get("bin") !== "0",
    unit: p.get("unit") === "ab" ? "ab" : "mjy",
    wise: p.get("wise") === "W1" || p.get("wise") === "W2" ? (p.get("wise") as WiseBand) : null,
    cmp: p.get("cmp") === "blink" ? "blink" : "side",
  };
}

/** Write the view as a query string (without the leading "?"). Defaults are left out. */
export function serializeView(view: ViewState): string {
  const p = new URLSearchParams();
  if (view.ra !== null && view.dec !== null) {
    p.set("ra", trim(view.ra, 7));
    p.set("dec", trim(view.dec, 7));
  }
  if (view.size !== DEFAULT_VIEW.size) p.set("size", trim(view.size, 1));
  if (view.wlmin !== null) p.set("wlmin", trim(view.wlmin, 4));
  if (view.wlmax !== null) p.set("wlmax", trim(view.wlmax, 4));
  if (view.pmra !== 0) p.set("pmra", trim(view.pmra, 3));
  if (view.pmdec !== 0) p.set("pmdec", trim(view.pmdec, 3));
  if (view.epoch !== DEFAULT_VIEW.epoch) p.set("epoch", trim(view.epoch, 3));
  if (view.plx !== DEFAULT_VIEW.plx) p.set("plx", trim(view.plx, 3));
  if (view.speed !== DEFAULT_VIEW.speed) p.set("speed", trim(view.speed, 2));
  if (view.mode !== DEFAULT_VIEW.mode) p.set("mode", view.mode);
  if (view.track) p.set("track", "1");
  if (view.sky !== DEFAULT_VIEW.sky) p.set("sky", view.sky);
  if (view.skyf !== null) p.set("skyf", String(view.skyf));
  if (view.frame !== DEFAULT_VIEW.frame) p.set("frame", view.frame);
  // Explicit sky preserves a measured target while looking at the map.
  if (view.tab !== DEFAULT_VIEW.tab || view.phot) p.set("tab", view.tab);
  if (view.name) p.set("name", view.name);
  if (view.phot) p.set("phot", "1");
  if (view.pra !== null && view.pdec !== null) {
    p.set("pra", trim(view.pra, 6));
    p.set("pdec", trim(view.pdec, 6));
  }
  if (!view.bin) p.set("bin", "0");
  if (view.unit === "ab") p.set("unit", "ab");
  if (view.wise) p.set("wise", view.wise);
  if (view.cmp !== DEFAULT_VIEW.cmp) p.set("cmp", view.cmp);
  return p.toString();
}

/** Settings that change continuously while watching; every other change is a new view. */
const CONTINUOUS: ReadonlyArray<keyof ViewState> = ["speed", "sky", "skyf", "bin", "unit", "cmp"];

/**
 * Whether going from one view to the next deserves its own entry in the browser history
 * (a new target, position, range, size or mode), or only an update of the current entry
 * (speed, background survey, cube frame).
 */
export function isNewView(before: ViewState, after: ViewState): boolean {
  return (Object.keys(after) as Array<keyof ViewState>).some(
    (key) => !CONTINUOUS.includes(key) && before[key] !== after[key],
  );
}

/**
 * Applies a change from a control to the view, with the rules that tie fields together:
 * a new position drops the measured point picked at the old one, and a new sky map or
 * wavelength range drops the chosen cube frame, so the default frame for the range applies.
 * A change that sets those fields itself keeps its own values.
 */
export function applyChange(previous: ViewState, change: Partial<ViewState>): ViewState {
  const next = { ...previous, ...change };
  const moved = next.ra !== previous.ra || next.dec !== previous.dec;
  if (moved && !("pra" in change)) Object.assign(next, { pra: null, pdec: null });
  const refocused = next.sky !== previous.sky || next.wlmin !== previous.wlmin || next.wlmax !== previous.wlmax;
  if (refocused && !("skyf" in change)) next.skyf = null;
  return next;
}
