// Multi-frame HiPS cubes (today only the SPHEREx all-sky cube): reading a survey's
// `properties` file, and choosing, stepping and labelling frames. Pure apart from
// `loadProperties`, which fetches. Frame numbers here are 0-based; the label and the
// `skyf` URL parameter show them 1-based.

/** What a survey's `properties` file does not say about its cube. */
export interface CubeConfig {
  /** 0-based frames that hold no data. They are skipped by every control. */
  blankFrames?: readonly number[];
  /** Frames per band, when the cube is a set of equal bands. Adds "(band N)" to the label. */
  framesPerBand?: number;
  /** 0-based frame shown when no wavelength range is chosen. */
  defaultFrame?: number;
}

export interface CubeInfo {
  depth: number;
  /** Wavelength of each frame, micrometres. */
  wavelengths: number[];
  /** True when `wavelengths` were spread out from the two ends, not read from a list. */
  approximate: boolean;
  blank: ReadonlySet<number>;
  framesPerBand?: number;
  defaultFrame?: number;
}

const SPEED_OF_LIGHT_M_PER_S = 299792458;

/** Reads a HiPS `properties` file: one `key = value` per line; `#` starts a comment line. */
export function parseProperties(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1) continue;
    result[line.slice(0, equals).trim()] = line.slice(equals + 1).trim();
  }
  return result;
}

/**
 * Wavelengths spread between the survey's two ends (metres) with equal steps in frequency,
 * the spacing `showCubeFrame` in AladinPanel uses. Assumes the wavelength grows with the
 * frame number, as in the SPHEREx list. Returned in micrometres.
 */
export function approximateWavelengths(depth: number, emMin: number, emMax: number): number[] {
  const lowest = SPEED_OF_LIGHT_M_PER_S / emMax;
  const highest = SPEED_OF_LIGHT_M_PER_S / emMin;
  return Array.from({ length: depth }, (_, frame) => {
    const frequency = highest - ((frame + 0.5) / depth) * (highest - lowest);
    return (SPEED_OF_LIGHT_M_PER_S / frequency) * 1e6;
  });
}

function build(depth: number, wavelengths: number[], approximate: boolean, config: CubeConfig): CubeInfo | null {
  const blank = new Set((config.blankFrames ?? []).filter((frame) => frame >= 0 && frame < depth));
  if (blank.size >= depth) return null;
  return { depth, wavelengths, approximate, blank, framesPerBand: config.framesPerBand, defaultFrame: config.defaultFrame };
}

/** Wavelength unit conversion to micrometres, for the units HiPS cubes use. */
const TO_MICROMETRES: Record<string, number> = { um: 1, micron: 1, nm: 1e-3, angstrom: 1e-4, m: 1e6 };

/** The cube described by a `properties` file, or null when the survey is not a cube. */
export function cubeFromProperties(properties: Record<string, string>, config: CubeConfig = {}): CubeInfo | null {
  const depth = Number(properties.hips_cube_depth);
  if (properties.dataproduct_type !== "cube" || !Number.isInteger(depth) || depth <= 1) return null;
  const list = (properties.data_cube_crval3_arr ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
  const scale = TO_MICROMETRES[(properties.data_cube_bunit3 ?? "um").toLowerCase()];
  if (list.length === depth && list.every(Number.isFinite) && scale) {
    return build(depth, list.map((value) => value * scale), false, config);
  }
  const emMin = Number(properties.em_min);
  const emMax = Number(properties.em_max);
  if (emMin > 0 && emMax > 0) return build(depth, approximateWavelengths(depth, emMin, emMax), true, config);
  return null;
}

/** Fallback when the `properties` file cannot be read: what Aladin Lite itself loaded. */
export function cubeFromSurvey(
  survey: { cubeDepth?: number; emMin?: number; emMax?: number },
  config: CubeConfig = {},
): CubeInfo | null {
  const { cubeDepth, emMin, emMax } = survey;
  if (!cubeDepth || cubeDepth <= 1 || !emMin || !emMax) return null;
  return build(cubeDepth, approximateWavelengths(cubeDepth, emMin, emMax), true, config);
}

/** The first frame from `frame` (inclusive) in `direction` that is not blank, or null. */
function search(cube: CubeInfo, frame: number, direction: 1 | -1): number | null {
  for (let f = frame; f >= 0 && f < cube.depth; f += direction) if (!cube.blank.has(f)) return f;
  return null;
}

/** `frame` itself, or the nearest usable frame in `direction` (the other way if there is none). */
export function snapFrame(cube: CubeInfo, frame: number, direction: 1 | -1): number {
  const clamped = Math.max(0, Math.min(cube.depth - 1, Math.round(frame)));
  return search(cube, clamped, direction) ?? search(cube, clamped, direction === 1 ? -1 : 1) ?? clamped;
}

/** The next usable frame after (1) or before (-1) `frame`; `frame` itself at the end. */
export function stepFrame(cube: CubeInfo, frame: number, direction: 1 | -1): number {
  return search(cube, frame + direction, direction) ?? frame;
}

/** The usable frame whose wavelength is closest to `micrometres`. */
export function nearestFrame(cube: CubeInfo, micrometres: number): number {
  let best = -1;
  for (let f = 0; f < cube.depth; f++) {
    if (cube.blank.has(f)) continue;
    if (best < 0 || Math.abs(cube.wavelengths[f] - micrometres) < Math.abs(cube.wavelengths[best] - micrometres)) best = f;
  }
  return best;
}

/**
 * The frame to show when the user has not picked one: the frame nearest the middle of the
 * chosen wavelength range (a missing end is the cube's own edge). With no range, the
 * survey's `defaultFrame`, or else the usable frame nearest the middle of the cube.
 */
export function defaultFrame(cube: CubeInfo, wlmin: number | null, wlmax: number | null): number {
  if (wlmin !== null || wlmax !== null) {
    const shortest = Math.min(...cube.wavelengths);
    const longest = Math.max(...cube.wavelengths);
    return nearestFrame(cube, ((wlmin ?? shortest) + (wlmax ?? longest)) / 2);
  }
  const preferred = cube.defaultFrame ?? Math.floor((cube.depth - 1) / 2);
  return snapFrame(cube, preferred, 1);
}

/** The 0-based frame to show: the 1-based `skyf` from the URL when valid, else the default. */
export function chooseFrame(cube: CubeInfo, skyf: number | null, wlmin: number | null, wlmax: number | null): number {
  if (skyf !== null && Number.isInteger(skyf) && skyf >= 1 && skyf <= cube.depth) return snapFrame(cube, skyf - 1, 1);
  return defaultFrame(cube, wlmin, wlmax);
}

/** For example "Frame 9 of 102 · 0.910 µm (band 1)". */
export function frameLabel(cube: CubeInfo, frame: number): string {
  const wavelength = `${cube.approximate ? "≈" : ""}${cube.wavelengths[frame].toFixed(3)} µm`;
  const band = cube.framesPerBand ? ` (band ${Math.floor(frame / cube.framesPerBand) + 1})` : "";
  return `Frame ${frame + 1} of ${cube.depth} · ${wavelength}${band}`;
}

const cache = new Map<string, Promise<Record<string, string>>>();

/** Fetches `<url>/properties` once per address; a failure is forgotten so a later call retries. */
export function loadProperties(url: string, fetcher: typeof fetch = fetch): Promise<Record<string, string>> {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetcher(`${url}/properties`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(parseProperties);
    pending.catch(() => cache.delete(url));
    cache.set(url, pending);
  }
  return pending;
}
