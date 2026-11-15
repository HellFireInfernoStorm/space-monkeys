import { describe, expect, it, vi } from "vitest";

import {
  approximateWavelengths,
  chooseFrame,
  cubeFromProperties,
  cubeFromSurvey,
  defaultFrame,
  frameLabel,
  loadProperties,
  nearestFrame,
  parseProperties,
  snapFrame,
  stepFrame,
} from "./hipsCube";
import { SKY_MAPS, skyMap } from "./skyMaps";

// Made-up but SPHEREx-shaped: 102 ascending wavelengths from 0.753 µm, about 0.0422 µm apart.
const WAVELENGTHS = Array.from({ length: 102 }, (_, frame) => Number((0.753 + frame * 0.0422).toFixed(3)));
const SPHEREX = skyMap("spherex").cube!;

function properties(list: string, extra = "") {
  return [
    "# A comment line = not a property",
    "creator_did = ivo://irsa.ipac/SPHEREx/spherex_allsky_cube",
    "dataproduct_type = cube",
    "hips_cube_depth = 102",
    "hips_cube_firstframe = 1",
    "em_min = 7.430000e-07",
    "em_max = 5.009000e-06",
    "data_cube_bunit3 = um",
    `data_cube_crval3_arr = ${list}`,
    extra,
  ].join("\n");
}

const cube = cubeFromProperties(parseProperties(properties(WAVELENGTHS.join(" "))), SPHEREX)!;

describe("parseProperties", () => {
  it("reads key = value lines and skips comments", () => {
    const parsed = parseProperties("# x = 1\nobs_title = SPHEREx = cube\r\n\nhips_order=7\n");
    expect(parsed).toEqual({ obs_title: "SPHEREx = cube", hips_order: "7" });
  });
});

describe("cubeFromProperties", () => {
  it("reads the space-separated wavelength list", () => {
    expect(cube.depth).toBe(102);
    expect(cube.approximate).toBe(false);
    expect(cube.wavelengths.slice(0, 3)).toEqual([0.753, 0.795, 0.837]);
    expect([...cube.blank]).toEqual([50, 51]);
  });

  it("tolerates commas in the list", () => {
    const withCommas = cubeFromProperties(parseProperties(properties(WAVELENGTHS.join(", "))))!;
    expect(withCommas.wavelengths).toEqual(WAVELENGTHS);
  });

  it("spreads the wavelengths from em_min and em_max when the list is missing or the wrong length", () => {
    for (const list of ["", "0.753 0.771 0.790"]) {
      const fallback = cubeFromProperties(parseProperties(properties(list)))!;
      expect(fallback.approximate).toBe(true);
      expect(fallback.wavelengths).toHaveLength(102);
      expect(fallback.wavelengths[0]).toBeGreaterThan(0.743);
      expect(fallback.wavelengths[101]).toBeLessThan(5.009);
      expect(fallback.wavelengths[1]).toBeGreaterThan(fallback.wavelengths[0]);
    }
  });

  it("is null for an image survey or a one-frame cube", () => {
    expect(cubeFromProperties(parseProperties("dataproduct_type = image\nhips_cube_depth = 102"))).toBeNull();
    expect(cubeFromProperties(parseProperties("dataproduct_type = cube\nhips_cube_depth = 1"))).toBeNull();
  });

  it("falls back to what Aladin Lite loaded", () => {
    const loaded = cubeFromSurvey({ cubeDepth: 102, emMin: 7.43e-7, emMax: 5.009e-6 }, SPHEREX)!;
    expect(loaded.approximate).toBe(true);
    expect(loaded.blank.has(50)).toBe(true);
    expect(cubeFromSurvey({})).toBeNull();
  });
});

describe("frames", () => {
  it("steps over the blank frames 50 and 51 both ways", () => {
    expect(stepFrame(cube, 49, 1)).toBe(52);
    expect(stepFrame(cube, 52, -1)).toBe(49);
    expect(stepFrame(cube, 101, 1)).toBe(101);
    expect(stepFrame(cube, 0, -1)).toBe(0);
  });

  it("snaps a range-input value off a blank frame in the direction it moved", () => {
    expect(snapFrame(cube, 50, 1)).toBe(52);
    expect(snapFrame(cube, 51, -1)).toBe(49);
    expect(snapFrame(cube, 30, 1)).toBe(30);
  });

  it("matches a wavelength to the nearest usable frame", () => {
    expect(nearestFrame(cube, 0.75)).toBe(0);
    expect(nearestFrame(cube, 99)).toBe(101);
    expect(nearestFrame(cube, WAVELENGTHS[50])).not.toBe(50);
  });

  it("starts at the frame nearest the middle of the wavelength range", () => {
    const frame = defaultFrame(cube, 4.4, 5.0);
    const distance = (f: number) => Math.abs(cube.wavelengths[f] - 4.7);
    expect(cube.wavelengths.every((_, f) => distance(frame) <= distance(f))).toBe(true);
    // A missing end is the cube's own edge.
    expect(defaultFrame(cube, null, 0.753 + 0.0422 * 4)).toBe(2);
  });

  it("starts at frame 9 for SPHEREx without a range, and the URL's frame wins", () => {
    expect(defaultFrame(cube, null, null)).toBe(8);
    expect(chooseFrame(cube, null, null, null)).toBe(8);
    expect(chooseFrame(cube, 20, 4.4, 5)).toBe(19);
    expect(chooseFrame(cube, 51, null, null)).toBe(52);
    expect(chooseFrame(cube, 500, null, null)).toBe(8);
  });

  it("labels a frame with its wavelength and band", () => {
    const real = cubeFromProperties(parseProperties(properties(WAVELENGTHS.map((w, f) => (f === 8 ? 0.91 : w)).join(" "))), SPHEREX)!;
    expect(frameLabel(real, 8)).toBe("Frame 9 of 102 · 0.910 µm (band 1)");
    expect(frameLabel(real, 17)).toMatch(/\(band 2\)$/);
  });

  it("handles a made-up cube with no wavelength list and no blank frames", () => {
    const plain = cubeFromProperties(parseProperties(
      "dataproduct_type = cube\nhips_cube_depth = 5\nem_min = 1e-6\nem_max = 2e-6",
    ))!;
    expect(plain.blank.size).toBe(0);
    expect(defaultFrame(plain, null, null)).toBe(2);
    expect(stepFrame(plain, 2, 1)).toBe(3);
    expect(frameLabel(plain, 0)).toMatch(/^Frame 1 of 5 · ≈1\.\d{3} µm$/);
    expect(approximateWavelengths(5, 1e-6, 2e-6)[4]).toBeLessThan(2);
  });
});

describe("loadProperties", () => {
  it("fetches each address once and forgets failures", async () => {
    const ok = vi.fn(async () => new Response("dataproduct_type = cube"));
    await loadProperties("https://example.test/a", ok);
    await loadProperties("https://example.test/a", ok);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledWith("https://example.test/a/properties");

    const failing = vi.fn(async () => new Response("", { status: 503 }));
    await expect(loadProperties("https://example.test/b", failing)).rejects.toThrow("503");
    await expect(loadProperties("https://example.test/b", failing)).rejects.toThrow("503");
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

describe("sky map table", () => {
  it("has unique values and addresses, and only SPHEREx is configured as a cube", () => {
    expect(new Set(SKY_MAPS.map((map) => map.value)).size).toBe(SKY_MAPS.length);
    expect(new Set(SKY_MAPS.map((map) => map.url)).size).toBe(SKY_MAPS.length);
    expect(SKY_MAPS.filter((map) => "cube" in map).map((map) => map.value)).toEqual(["spherex"]);
  });
});
