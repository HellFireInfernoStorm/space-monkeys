import { describe, expect, it } from "vitest";

import type { PhotometryPoint } from "./api";
import {
  summarise, groupVisits, verdict, toAbMag, magnitudePoints,
  pointDetails,
  selectChartPoint,
  uniqueTicks,
  bandStrips,
  chartGeometry,
  nearestPoint,
  binCount,
  binPoints,
  clickToSky,
  extent,
  isUsable,
  linkLabel,
  milliJanskyFactor,
  mjdToDay,
  pointLabel,
  splitLinks,
  ticks,
  toPlotPoints,
  wavelengthColour,
} from "./photometry";

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
    usable: true,
    reason: null,
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
    expect(plotted[1]).toMatchObject({ x: 4.6, y: null, err: null });
  });

  it("trusts usable=false even if a number came with it", () => {
    const p = point({ usable: false, reason: "empty pixel in the aperture" });
    expect(isUsable(p)).toBe(false);
    expect(toPlotPoints([p], "Jy", (q) => q.mjd)[0].y).toBeNull();
  });

  it("gives the bandpass as a horizontal half-width only when asked", () => {
    expect(toPlotPoints([point({})], "Jy", (p) => p.wavelength, { bandpass: true })[0].xerr).toBeCloseTo(0.0175);
    expect(toPlotPoints([point({})], "Jy", (p) => p.mjd)[0].xerr).toBeUndefined();
  });

  it("labels a point with its value, or with why it was not measured", () => {
    expect(pointLabel(point({}), 1000)).toContain("0.500 ± 0.10 mJy");
    expect(pointLabel(point({}), 1000)).toContain("4.600 ± 0.018 µm");
    const refused = point({ flux: null, flux_err: null, usable: false, reason: "empty pixel; flags: BLOOM" });
    expect(pointLabel(refused, 1000)).toContain("Not measured: empty pixel; flags: BLOOM");
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

describe("wavelengthColour", () => {
  it("runs from light blue at the short end to dark blue at the long end", () => {
    expect(wavelengthColour(4.4, 4.4, 5.0)).toBe("#cde2fb");
    expect(wavelengthColour(5.0, 4.4, 5.0)).toBe("#256abf");
    expect(wavelengthColour(9, 4.4, 5.0)).toBe("#256abf");
    expect(wavelengthColour(4.6, 4.6, 4.6)).toBe("#cde2fb");
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

describe("links in warnings", () => {
  it("splits out web addresses, leaving trailing punctuation as text", () => {
    expect(splitLinks("See https://github.com/a/b/issues/4. Done")).toEqual([
      { text: "See " },
      { text: "https://github.com/a/b/issues/4", href: "https://github.com/a/b/issues/4" },
      { text: ". Done" },
    ]);
    expect(splitLinks("no links here")).toEqual([{ text: "no links here" }]);
  });

  it("labels GitHub issues by number and other links by host", () => {
    expect(linkLabel("https://github.com/HellFireInfernoStorm/space-monkeys/issues/4")).toBe("issue #4");
    expect(linkLabel("https://irsa.ipac.caltech.edu/Missions/spherex.html")).toBe("irsa.ipac.caltech.edu");
  });
});


describe("responsive chart geometry", () => {
  it("keeps errors and negative values inside the plot and missing values in their lane", () => {
    const points = [{ x: 1, y: -2, err: 3 }, { x: 2, y: null, err: null }];
    const g = chartGeometry(points, 700);
    expect(g.y0).toBeLessThan(-5);
    expect(g.y1).toBeGreaterThan(1);
    expect(g.positioned[0].py).toBeLessThan(g.floor);
    expect(g.positioned[1].py).toBeGreaterThan(g.floor);
    expect(g.lane).toBe(18);
    expect(chartGeometry(points, 400).xTicks.length).toBeLessThan(g.xTicks.length);
  });
  it("survives hidden, single-point and all-unmeasured charts", () => {
    for (const points of [[{ x: 1, y: 2, err: 0 }], [{ x: 1, y: null, err: null }], []]) {
      const g = chartGeometry(points, 0);
      expect(Number.isFinite(g.sx(1))).toBe(true);
      expect(Number.isFinite(g.sy(0))).toBe(true);
      expect(g.x1).toBeGreaterThan(g.x0);
      expect(g.y1).toBeGreaterThan(g.y0);
    }
  });
  it("finds the nearest pixel position within the radius, keeping the first tie", () => {
    const points = [{ px: 10, py: 10 }, { px: 12, py: 10 }];
    expect(nearestPoint(points, 11, 10)).toBe(points[0]);
    expect(nearestPoint(points, 12, 10)).toBe(points[1]);
    expect(nearestPoint(points, 100, 100)).toBeUndefined();
    expect(nearestPoint(points, 10, 34)).toBe(points[0]);
    expect(nearestPoint([], 0, 0)).toBeUndefined();
  });
  it("clips API bands and splits overlaps without changing the input", () => {
    const bands = [{ band: 2, wl_min_um: 1.1, wl_max_um: 1.65 }, { band: 1, wl_min_um: 0.75, wl_max_um: 1.12 }];
    expect(bandStrips(bands, 1, 1.5)).toEqual([
      { band: 1, left: 1, right: 1.11 }, { band: 2, left: 1.11, right: 1.5 },
    ]);
    expect(bands[0].band).toBe(2);
    expect(bandStrips([], 0, 5)).toEqual([]);
    expect(bandStrips(bands, 3, 5)).toEqual([]);
  });
  it("carries exposure identity and tooltip fields into both chart views", () => {
    const p = point({ usable: false, reason: "saturated" });
    for (const x of [(p: PhotometryPoint) => p.wavelength, (p: PhotometryPoint) => p.mjd]) {
      expect(toPlotPoints([p], "uJy", x)[0]).toMatchObject({
        id: "e", mjd: 60800, detector: 6, reason: "saturated", details: { wavelength: "4.600 ± 0.018 µm" }, y: null,
      });
    }
  });
});


describe("chart review regressions", () => {
  it("restores keyboard selection after a pointer visit to the other chart", () => {
    const keyboard = selectChartPoint({}, "spectrum", "keyboard", "e1");
    const hovered = selectChartPoint(keyboard, "lightCurve", "pointer", "e2");
    expect(hovered.pointer).toEqual({ chart: "lightCurve", key: "e2" });
    const left = selectChartPoint(hovered, "lightCurve", "pointer");
    expect(left.pointer ?? left.keyboard).toEqual({ chart: "spectrum", key: "e1" });
    expect(selectChartPoint(left, "lightCurve", "keyboard")).toBe(left);
    expect(selectChartPoint(left, "spectrum", "keyboard").keyboard).toBeUndefined();
  });
  it("does not clear a pointer selection owned by the other chart", () => {
    const state = selectChartPoint({}, "spectrum", "pointer", "e1");
    expect(selectChartPoint(state, "lightCurve", "pointer")).toBe(state);
  });
  it("shows each date once when ticks span fractional days", () => {
    expect(uniqueTicks([60800.1, 60800.4, 60800.9, 60801.2], mjdToDay)).toEqual([60800.1, 60801.2]);
    expect(uniqueTicks([1, 2, 3], String)).toEqual([1, 2, 3]);
  });
  it("uses one set of formatted fields for accessible labels and tooltip cards", () => {
    const source = point({ flux: null, usable: false, reason: "saturated" });
    const plotted = toPlotPoints([source], "Jy", (p) => p.mjd)[0];
    expect(Object.values(pointDetails(plotted)).join("\n")).toBe(pointLabel(source, 1000));
    expect(pointDetails(plotted).value).toBe("Not measured: saturated");
    expect(pointDetails({ x: 4.6, y: 0.5, err: 0.1 })).toEqual({ wavelength: "4.600 µm", value: "0.500 ± 0.10 mJy" });
  });
});


describe("phase 2 summaries and units", () => {
  it("groups unsorted dates into visits without mutating input; exactly 60 days stays together", () => {
    const dates = [61171, 60989, 60801, 61021, 61151];
    expect(groupVisits(dates)).toEqual([
      { start: 60801, end: 60801, count: 1 },
      { start: 60989, end: 61021, count: 2 },
      { start: 61151, end: 61171, count: 2 },
    ]);
    expect(dates[0]).toBe(61171);
    expect(groupVisits([60, 0, 60, 121])).toEqual([{ start: 0, end: 60, count: 3 }, { start: 121, end: 121, count: 1 }]);
    expect(groupVisits([])).toEqual([]);
    expect(groupVisits([0, 2], 1)).toHaveLength(2);
  });
  it("summarises ranges over all points but weights and S/N over measured points only", () => {
    const summary = summarise([
      { x: 4.5, wavelength: 4.5, mjd: 60801, y: 10, err: 1 },
      { x: 4.9, wavelength: 4.9, mjd: 60989, y: 20, err: 2 },
      { x: 4.4, wavelength: 4.4, mjd: 61171, y: null, err: null },
      { x: 5, wavelength: 5, mjd: 61151, y: 1000, err: 0 },
    ]);
    expect(summary).toMatchObject({ measured: 3, snrMeasured: 2, total: 4, wlMin: 4.4, wlMax: 5, firstMjd: 60801, lastMjd: 61171, medianSnr: 10, mean: { y: 12 }, brightest: 4.9 });
    expect(summary.mean!.err).toBeCloseTo(1 / Math.sqrt(1.25));
    expect(summary.combinedSnr).toBeCloseTo(12 * Math.sqrt(1.25));
    expect(summary.visits).toHaveLength(3);
    expect(summarise([])).toMatchObject({ measured: 0, total: 0, visits: [], mean: undefined, brightest: undefined });
    expect(summarise([{ x: 4.6, y: 1, err: 1 }]).brightest).toBeUndefined();
  });
  it("counts flux measurements without errors while excluding them from weighted statistics", () => {
    const plotted = toPlotPoints([
      point({ flux_err: null }), point({ flux_err: 0 }),
      point({ usable: false, flux: null, flux_err: null }),
    ], "Jy", (p) => p.wavelength);
    const summary = summarise(plotted);
    expect(summary).toMatchObject({ measured: 2, snrMeasured: 0, total: 3, bins: [],
      mean: undefined, combinedSnr: undefined, medianSnr: undefined, brightest: undefined });
    expect(plotted.filter((p) => p.y !== null)).toHaveLength(summary.measured);
    expect(verdict(summary, { mock: true, warned: false })).toEqual({ tone: "none",
      text: "S/N unavailable: measured aperture fluxes have no positive background-noise errors. (Synthetic data.)" });
    const mixed = summarise([...plotted, { x: 4.6, y: 10, err: 2 }]);
    expect(mixed).toMatchObject({ measured: 3, snrMeasured: 1, mean: { y: 10, err: 2 }, combinedSnr: 5, medianSnr: 5 });
  });
  it("returns the same bins used for the brightest wavelength, independent of the display toggle", () => {
    const points = Array.from({ length: 20 }, (_, i) => ({ x: 4.4 + i * 0.03, y: i + 10, err: 1 }));
    const summary = summarise(points);
    expect(summary.bins).toEqual(binPoints(points, binCount(summary.measured)));
    expect(summary.brightest).toBe(summary.bins.reduce((best, p) => p.y! > best.y! ? p : best).x);
    expect(summarise([{ x: 4.6, y: null, err: null }]).bins).toEqual([]);
  });
  it("takes the middle S/N, averaging the middle pair for an even count", () => {
    expect(summarise([1, 8, 3].map((y) => ({ x: 1, y, err: 1 }))).medianSnr).toBe(3);
    expect(summarise([1, 8, 3, 5].map((y) => ({ x: 1, y, err: 1 }))).medianSnr).toBe(4);
  });
  it("uses the exact verdicts for empty, single, combined and weak signal", () => {
    const options = { mock: false, warned: false };
    expect(verdict(summarise([]), options)).toEqual({ tone: "empty", text: "No measurement: every aperture holds flagged or missing pixels." });
    expect(verdict(summarise([{ x: 1, y: 5, err: 1 }]), options)).toEqual({ tone: "clear", text: "Clear signal in single exposures (typical S/N 5.0)." });
    expect(verdict(summarise(Array.from({ length: 4 }, () => ({ x: 1, y: 3, err: 1 }))), options)).toEqual({ tone: "combined", text: "Signal only when exposures are combined (S/N 6.0); about 3.0 in a single exposure. The Stacked view in the frame player is the better way to see a faint object." });
    expect(verdict(summarise([{ x: 1, y: -1, err: 1 }]), options)).toEqual({ tone: "none", text: "No clear signal in this wavelength range (combined S/N -1.0)." });
    const text = verdict(summarise([]), { mock: true, warned: true }).text;
    expect(text).toBe("No measurement: every aperture holds flagged or missing pixels. The warning above says what else may be in the aperture. (Synthetic data.)");
    expect(text).not.toMatch(/detected|detection|σ/);
  });
  it("converts the AB zero point, mJy and propagated error, and rejects nonpositive flux", () => {
    expect(toAbMag(3631 * 1000, 0)!.mag).toBeCloseTo(0);
    expect(toAbMag(1, 0)!.mag.toFixed(2)).toBe("16.40");
    expect(toAbMag(0.554, 0.043)!.mag.toFixed(2)).toBe("17.04");
    expect(toAbMag(0.554, 0.043)!.err.toFixed(2)).toBe("0.08");
    expect(toAbMag(-1, 1)).toBeNull();
    expect(toAbMag(0, 1)).toBeNull();
  });
  it("retains exposure identity, mJy and reasons when mapping magnitude points", () => {
    const raw = toPlotPoints([point({ flux: 0.000554, flux_err: 0.000043 }), point({ exposure_id: "negative", flux: -0.001 }), point({ flux: null, usable: false, reason: "flagged" })], "Jy", (p) => p.wavelength);
    const mapped = magnitudePoints(raw);
    expect(mapped[0]).toMatchObject({ id: "e", mjd: 60800 });
    expect(pointDetails(mapped[0]).value).toBe("17.04 ± 0.08 AB mag (0.554 ± 0.043 mJy)");
    expect(mapped[0].label).toContain(pointDetails(mapped[0]).value);
    expect(mapped[1].y).toBeNull();
    expect(mapped[1].label).toContain("No magnitude: flux -1.00 ± 0.10 mJy is not above zero");
    expect(mapped[2]).toBe(raw[2]);
    expect(mapped[2].label).toContain("Not measured: flagged");
    expect(raw[0].y).toBeCloseTo(0.554);
  });
  it("keeps brighter magnitudes above faint ones, errors inside, and missing values below", () => {
    const g = chartGeometry([{ x: 1, y: 12, err: 1 }, { x: 2, y: 17, err: 1 }, { x: 3, y: null, err: null }], 700, 220, true);
    expect(g.sy(12)).toBeLessThan(g.sy(17));
    expect(g.sy(11)).toBeGreaterThan(g.plot.top);
    expect(g.sy(18)).toBeLessThan(g.floor);
    expect(g.positioned[2].py).toBeGreaterThan(g.floor);
    expect(g.yTicks.length).toBeGreaterThan(1);
  });
});
