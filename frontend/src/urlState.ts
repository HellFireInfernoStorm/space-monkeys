// All view state lives in the URL, so any view can be shared or embedded with a link.
// A new control means a new field here, a new line in parseView and serializeView,
// and a new case in urlState.test.ts.

export type ViewMode = "blink" | "diff" | "stack";
export type SkyLayer = "wise" | "spherex";

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
  /** Background survey in the wide-field sky map. */
  sky: SkyLayer;
  /** Label of the chosen target, for display only. */
  name: string;
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
  name: "",
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
    sky: sky === "spherex" ? "spherex" : "wise",
    name: (p.get("name") ?? "").slice(0, 80),
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
  if (view.name) p.set("name", view.name);
  return p.toString();
}
