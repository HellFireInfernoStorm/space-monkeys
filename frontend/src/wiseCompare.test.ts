import { describe, expect, it } from "vitest";

import { framePixels, mjdToYear, offsetArcsec, rangeIncludes, spotOnDate, widthToShow } from "./wiseCompare";

const WISE_0855 = { ra: 133.81890825, dec: -7.247048, pmra: -8123.7, pmdec: 673.2, epoch: 2000 };

describe("wiseCompare", () => {
  it("converts MJD to decimal year like the back end", () => {
    expect(mjdToYear(51544.5)).toBe(2000);
    expect(mjdToYear(55322.34)).toBeCloseTo(2010.343, 3);
  });

  it("measures offsets east and north, across RA 0", () => {
    const o = offsetArcsec(0.01, 0, 359.99, 0);
    expect(o.east).toBeCloseTo(72, 0);
    expect(o.north).toBe(0);
  });

  it("puts WISE 0855 about two arcminutes east of its 2026 position in 2010", () => {
    const now = { ra: 133.7601, dec: -7.2422 };
    const mjd2010 = 55322.34;
    const spot = spotOnDate(WISE_0855, mjd2010, now, 300);
    expect(spot.east).toBeGreaterThan(110);
    expect(spot.east).toBeLessThan(140);
    expect(spot.inside).toBe(true); // 300" shows both
    expect(spot.left).toBeLessThan(0.5); // east is left
    expect(spotOnDate(WISE_0855, mjd2010, now, 120).inside).toBe(false);
  });

  it("finds the width that shows every point", () => {
    expect(widthToShow([{ east: 125, north: -15 }])).toBe(280);
    expect(widthToShow([{ east: 1000, north: 0 }])).toBe(600);
  });

  it("sizes frames like the back end: odd, 8 to 95 pixels", () => {
    expect(framePixels(120, 6.15)).toBe(21); // round(19.5) = 20, made odd
    expect(framePixels(300, 6.15)).toBe(49);
    expect(framePixels(30, 6.15)).toBe(9);
    expect(framePixels(600, 6.15)).toBe(95);
  });

  it("checks whether a range includes a wavelength", () => {
    expect(rangeIncludes(4.4, 5.0, 4.618)).toBe(true);
    expect(rangeIncludes(1.0, 1.2, 4.618)).toBe(false);
    expect(rangeIncludes(null, null, 4.618)).toBe(true);
  });
});
