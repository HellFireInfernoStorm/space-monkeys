import { describe, expect, it } from "vitest";

import type { PhotometryPoint } from "./api";
import { binCount, binPoints, clickToSky, extent, milliJanskyFactor, mjdToDay, ticks, toPlotPoints } from "./photometry";

function point(over: Partial<PhotometryPoint>): PhotometryPoint {
  return {
    exposure_id: "e",
    obs_id: "o",
    det_id: 6,
    mjd: 60800,
    wavelength: 4.6,
    lambda_width: 0.035,
    flux: 0.0005,
    flux_err: 0.0001,
    flags: 0,
    ...over,
  };
}

describe("photometry units", () => {
  it("converts the server's units to millijansky", () => {
    expect(milliJanskyFactor("Jy")).toBe(1000);
    expect(milliJanskyFactor("uJy")).toBe(0.001);
    expect(() => milliJanskyFactor("furlongs")).toThrow();
  });

  it("keeps unmeasured points as null, never as zero", () => {
    const plotted = toPlotPoints([point({}), point({ flux: null, flux_err: null })], "Jy", (p) => p.wavelength);
    expect(plotted[0].y).toBeCloseTo(0.5);
    expect(plotted[0].err).toBeCloseTo(0.1);
    expect(plotted[1]).toEqual({ x: 4.6, y: null, err: null });
  });
});

describe("binPoints", () => {
  it("is the inverse-variance weighted mean with its error", () => {
    const binned = binPoints(
      [
        { x: 1.0, y: 1, err: 1 },
        { x: 1.1, y: 3, err: 1 },
      ],
      1,
    );
    expect(binned).toHaveLength(1);
    expect(binned[0].y).toBeCloseTo(2);
    expect(binned[0].err).toBeCloseTo(1 / Math.SQRT2);
  });

  it("leaves out unmeasured points and empty bins", () => {
    const binned = binPoints(
      [
        { x: 1.0, y: 1, err: 1 },
        { x: 1.5, y: null, err: null },
        { x: 2.0, y: 5, err: 1 },
      ],
      3,
    );
    expect(binned.map((b) => b.y)).toEqual([1, 5]);
  });

  it("returns nothing without measured points", () => {
    expect(binPoints([{ x: 1, y: null, err: null }], 4)).toEqual([]);
  });

  it("chooses about four points per bin", () => {
    expect(binCount(2)).toBe(3);
    expect(binCount(40)).toBe(10);
    expect(binCount(400)).toBe(16);
  });
});

describe("clickToSky", () => {
  it("puts the centre of the image at the centre position", () => {
    expect(clickToSky(0.5, 0.5, 133.8, -7.2, 120)).toEqual({ ra: 133.8, dec: -7.2 });
  });

  it("has north up and east to the left", () => {
    const topLeft = clickToSky(0, 0, 10, 0, 120);
    expect(topLeft.dec).toBeCloseTo(60 / 3600);
    expect(topLeft.ra).toBeCloseTo(10 + 60 / 3600);
  });

  it("widens RA steps by 1 / cos(dec) and wraps at 0 degrees", () => {
    expect(clickToSky(0, 0.5, 0, 60, 120).ra).toBeCloseTo(120 / 3600);
    expect(clickToSky(1, 0.5, 0, 0, 120).ra).toBeCloseTo(360 - 60 / 3600);
  });
});

describe("plot helpers", () => {
  it("pads the axis range and survives a single value or no values", () => {
    const [lo, hi] = extent([0, 10]);
    expect(lo).toBeLessThan(0);
    expect(hi).toBeGreaterThan(10);
    expect(extent([])).toEqual([0, 1]);
    const [a, b] = extent([5]);
    expect(a).toBeLessThan(5);
    expect(b).toBeGreaterThan(5);
  });

  it("gives round ticks inside the range", () => {
    expect(ticks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    for (const t of ticks(0.73, 1.12, 4)) {
      expect(t).toBeGreaterThanOrEqual(0.73);
      expect(t).toBeLessThanOrEqual(1.12);
    }
  });

  it("formats MJD as a calendar day", () => {
    expect(mjdToDay(60000)).toBe("2023-02-25");
    expect(mjdToDay(60800)).toBe("2025-05-05");
  });
});
