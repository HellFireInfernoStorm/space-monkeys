// Layer 3, phase 4: tests for the CSV download and the drag-to-zoom range.

import { describe, expect, it } from "vitest";

import type { PhotometryPoint, PhotometryResult } from "./api";
import { csvField, csvFileName, mjdToIso, photometryCsv, type CsvContext } from "./export";
import { dragRange, type VisitMean } from "./photometry";

function point(over: Partial<PhotometryPoint>): PhotometryPoint {
  return {
    exposure_id: "e1", obs_id: "o1", det_id: 6, mjd: 60801.5, wavelength: 4.511, lambda_width: 0.034,
    flux: 554.0, flux_err: 43.1, flags: 0, usable: true, reason: null, ...over,
  };
}

function result(points: PhotometryPoint[], mode: "mock" | "live" = "live"): PhotometryResult {
  return {
    mode, total: points.length, returned: points.length, capped: false, warnings: [], collections: [],
    ra: 133.818908, dec: -7.247048, flux_unit: "uJy", method: "Aperture 3 px; quick look", points,
  } as unknown as PhotometryResult;
}

const context: CsvContext = {
  corrected: [], visits: [], name: "WISE 0855", ra: 133.8189082, dec: -7.247048, isPoint: false, moving: true,
  wlmin: 4.4, wlmax: 5, generatedAt: new Date("2026-11-15T16:00:00Z"),
};

const lines = (text: string) => text.trimEnd().split("\n");

describe("mjdToIso", () => {
  it("gives UTC to the second", () => {
    expect(mjdToIso(40587)).toBe("1970-01-01T00:00:00Z");
    expect(mjdToIso(60801.25)).toBe("2025-05-06T06:00:00Z");
  });
});

describe("csvField", () => {
  it("quotes commas, quotes and line breaks, and leaves the rest alone", () => {
    expect(csvField("flags: TRANSIENT, HALO")).toBe('"flags: TRANSIENT, HALO"');
    expect(csvField('a "b"')).toBe('"a ""b"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField("plain")).toBe("plain");
    expect(csvField(1.5)).toBe("1.5");
    expect(csvField(false)).toBe("false");
    expect(csvField(null)).toBe("");
  });
});

describe("photometryCsv", () => {
  it("writes the header lines and one row per exposure in time order, fluxes in mJy", () => {
    const text = photometryCsv(result([point({ exposure_id: "late", mjd: 61000 }), point({})]), context);
    const all = lines(text);
    expect(all[0]).toBe("# spaceshift quick-look photometry");
    expect(all).toContain("# mode: live");
    expect(all).toContain("# position: RA 133.818908, Dec -7.247048 (ICRS degrees), followed along its motion");
    expect(all).toContain("# target: WISE 0855");
    expect(all).toContain("# wavelength range: 4.4 to 5 µm");
    expect(all).toContain("# method: Aperture 3 px; quick look");
    expect(all).toContain("# generated: 2026-11-15T16:00:00Z");
    const columns = all.findIndex((l) => l.startsWith("exposure_id,"));
    expect(all.slice(columns + 1).map((l) => l.split(",")[0])).toEqual(["e1", "late"]);
    expect(all[columns + 1]).toBe("e1,o1,6,60801.5,2025-05-06T12:00:00Z,4.511,0.034,0.554,0.0431,true,,0,,,");
  });

  it("says mock in the header", () => {
    expect(lines(photometryCsv(result([point({})], "mock"), context)))
      .toContain("# mode: mock: synthetic numbers, not measurements of the real sky");
  });

  it("leaves unmeasured fluxes empty and quotes reasons with commas", () => {
    const text = photometryCsv(result([point({ flux: null, flux_err: null, usable: false, flags: 5, reason: "Not measured: flags TRANSIENT, HALO" })]), context);
    expect(lines(text).at(-1)).toBe('e1,o1,6,60801.5,2025-05-06T12:00:00Z,4.511,0.034,,,false,"Not measured: flags TRANSIENT, HALO",5,,,');
  });

  it("fills the corrected ratio and visit by exposure id", () => {
    const visits: VisitMean[] = [{ start: 60800, end: 60802, mjd: 60801, count: 3, r: 1, errFormal: 0.01, err: 0.04 }];
    const corrected = [{ id: "e1", x: 60801.5, y: 1.0234, err: 0.0567 }];
    const text = photometryCsv(result([point({}), point({ exposure_id: "e2", mjd: 61000 })]), { ...context, corrected, visits });
    expect(lines(text).at(-2)!.endsWith(",1.0234,0.0567,1")).toBe(true);
    expect(lines(text).at(-1)!.endsWith(",,,")).toBe(true);
  });

  it("names a fixed point and an open range", () => {
    const all = lines(photometryCsv(result([point({})]), { ...context, isPoint: true, wlmin: null, wlmax: null }));
    expect(all).toContain("# position: RA 133.818908, Dec -7.247048 (ICRS degrees), fixed point");
    expect(all).toContain("# wavelength range: all");
    expect(all.some((l) => l.startsWith("# target:"))).toBe(false);
  });
});

describe("csvFileName", () => {
  it("uses the target name, the range and a mock suffix", () => {
    expect(csvFileName(context, false)).toBe("spaceshift-wise-0855-4.4-5um.csv");
    expect(csvFileName(context, true)).toBe("spaceshift-wise-0855-4.4-5um-mock.csv");
    expect(csvFileName({ ...context, name: "Barnard's Star", wlmin: null, wlmax: null }, false)).toBe("spaceshift-barnard-s-star-all.csv");
  });

  it("uses the position for a fixed point", () => {
    expect(csvFileName({ ...context, isPoint: true }, false)).toBe("spaceshift-ra133.81891-dec-7.24705-4.4-5um.csv");
  });
});

describe("dragRange", () => {
  const scales = { x0: 4.4, x1: 5.0, plot: { left: 64, width: 600 } };

  it("is null for a drag of 8 pixels or less", () => {
    expect(dragRange(100, 108, scales)).toBeNull();
    expect(dragRange(108, 100, scales)).toBeNull();
  });

  it("orders, converts and rounds the ends", () => {
    // 164 px → 4.5 µm, 364 px → 4.7 µm.
    expect(dragRange(364, 164, scales)).toEqual({ lo: 4.5, hi: 4.7 });
    expect(dragRange(164.4, 364.6, scales)).toEqual({ lo: 4.5, hi: 4.701 });
  });

  it("clamps to the axis", () => {
    expect(dragRange(0, 2000, scales)).toEqual({ lo: 4.4, hi: 5.0 });
  });
});
