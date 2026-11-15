// Layer 3, phase 3: tests for the colour-corrected light curve helpers in photometry.ts.

import { describe, expect, it } from "vitest";

import {
  binPoints,
  binWidth,
  changeVerdict,
  chartGeometry,
  correctedPoints,
  NOISE_FLOOR,
  spectrumAt,
  type PlotPoint,
  type VisitMean,
  visitMeans,
} from "./photometry";

const bin = (x: number, y: number, err: number): PlotPoint => ({ x, y, err });

function exposure(over: Partial<PlotPoint>): PlotPoint {
  return { id: "e", x: 60800, mjd: 60800, wavelength: 4.6, y: 1, err: 0.1, details: { wavelength: "w", value: "1 ± 0.1 mJy" }, ...over };
}

function visit(r: number, err: number, count = 5, mjd = 60800): VisitMean {
  return { start: mjd, end: mjd, mjd, count, r, errFormal: err, err };
}

describe("binWidth", () => {
  it("matches the bins binPoints makes, ignoring points without a positive error", () => {
    const points = [bin(1, 1, 0.1), bin(2, 1, 0.1), bin(4, 1, 0.1), bin(9, 1, null as unknown as number), { x: 10, y: null, err: null }];
    expect(binWidth(points, 3)).toBeCloseTo(1);
    expect(binPoints(points, 3).map((p) => p.x)).toEqual([1, 2, 4]);
  });

  it("falls back to 1 for a single position or no data", () => {
    expect(binWidth([bin(2, 1, 0.1)], 3)).toBe(1);
    expect(binWidth([], 3)).toBe(1);
  });
});

describe("spectrumAt", () => {
  const bins = [bin(1, 10, 1), bin(2, 20, 2), bin(3, 30, 1)];

  it("is exact at a bin centre", () => {
    expect(spectrumAt(bins, 2, 1)).toEqual({ y: 20, err: 2 });
  });

  it("interpolates linearly between centres and keeps the larger error", () => {
    expect(spectrumAt(bins, 1.5, 1)).toEqual({ y: 15, err: 2 });
  });

  it("uses the end bin up to one bin width beyond the outermost centres, then gives up", () => {
    expect(spectrumAt(bins, 0.2, 1)).toEqual({ y: 10, err: 1 });
    expect(spectrumAt(bins, 3.9, 1)).toEqual({ y: 30, err: 1 });
    expect(spectrumAt(bins, -0.1, 1)).toBeNull();
    expect(spectrumAt(bins, 4.1, 1)).toBeNull();
  });

  it("refuses to bridge a gap of more than two bin widths", () => {
    expect(spectrumAt([bin(1, 10, 1), bin(4, 10, 1)], 2.5, 1)).toBeNull();
    expect(spectrumAt([bin(1, 10, 1), bin(3, 10, 1)], 2, 1)).toEqual({ y: 10, err: 1 });
  });

  it("refuses a spectrum with S/N under 5, or at or below zero", () => {
    expect(spectrumAt([bin(1, 4, 1)], 1, 1)).toBeNull();
    expect(spectrumAt([bin(1, 5, 1)], 1, 1)).toEqual({ y: 5, err: 1 });
    expect(spectrumAt([bin(1, -10, 1)], 1, 1)).toBeNull();
    expect(spectrumAt([bin(1, 0, 1)], 1, 1)).toBeNull();
    expect(spectrumAt([], 1, 1)).toBeNull();
  });
});

describe("correctedPoints", () => {
  const flat = [bin(4.5, 2, 0.1), bin(4.7, 2, 0.1)];

  it("divides by the spectrum and propagates both errors", () => {
    const [p] = correctedPoints([exposure({ y: 3, err: 0.3, wavelength: 4.6 })], flat, 0.2);
    expect(p.y).toBeCloseTo(1.5);
    // sqrt(0.3² + (1.5 × 0.1)²) / 2
    expect(p.err).toBeCloseTo(Math.sqrt(0.09 + 0.0225) / 2);
    expect(p.details?.value).toBe("1.500 ± 0.168 of normal (1 ± 0.1 mJy)");
    expect(p.id).toBe("e");
  });

  it("follows the spectrum's shape, so colour alone gives 1", () => {
    const sloped = [bin(4.5, 1, 0.01), bin(4.9, 3, 0.01)];
    const points = [4.5, 4.7, 4.9].map((wavelength, i) => exposure({ id: String(i), wavelength, y: 1 + (wavelength - 4.5) * 5 }));
    for (const p of correctedPoints(points, sloped, 0.4)) expect(p.y).toBeCloseTo(1);
  });

  it("keeps unmeasured points and their reason", () => {
    const unmeasured = exposure({ y: null, err: null, reason: "saturated" });
    expect(correctedPoints([unmeasured], flat, 0.2)[0]).toBe(unmeasured);
  });

  it("turns an exposure the spectrum cannot correct into a value-less point with a reason", () => {
    const [p] = correctedPoints([exposure({ wavelength: 5.5 })], flat, 0.2);
    expect(p.y).toBeNull();
    expect(p.details?.value).toBe("Not corrected: the spectrum is too uncertain at 5.500 µm");
    expect(p.reason).toBe(p.details?.value);
  });
});

describe("visitMeans", () => {
  it("averages each visit with inverse-variance weights and adds the noise floor in quadrature", () => {
    const points = [
      exposure({ mjd: 60801, y: 1.0, err: 0.01 }),
      exposure({ mjd: 60802, y: 1.0, err: 0.01 }),
      exposure({ mjd: 60803, y: 1.0, err: 0.01 }),
      exposure({ mjd: 61000, y: 1.2, err: 0.1 }),
      exposure({ mjd: 61001, y: 0.9, err: 0.05 }),
    ];
    const [a, b] = visitMeans(points);
    expect(a.count).toBe(3);
    expect(a.r).toBeCloseTo(1);
    expect(a.errFormal).toBeCloseTo(0.01 / Math.sqrt(3));
    expect(a.err).toBeCloseTo(Math.sqrt((0.01 / Math.sqrt(3)) ** 2 + NOISE_FLOOR ** 2));
    // Weights 100 and 400 favour the smaller error.
    expect(b.r).toBeCloseTo((100 * 1.2 + 400 * 0.9) / 500);
    expect(b.mjd).toBeCloseTo((100 * 61000 + 400 * 61001) / 500);
  });

  it("does not reduce the floor with more exposures", () => {
    const many = Array.from({ length: 100 }, (_, i) => exposure({ mjd: 60800 + i * 0.1, y: 1, err: 0.01 }));
    expect(visitMeans(many)[0].err).toBeGreaterThan(NOISE_FLOOR);
    expect(Math.sqrt(0.01 ** 2 + 0.038 ** 2)).toBeCloseTo(0.0393, 4);
  });

  it("splits the WISE 0855 visit dates into three visits and skips unusable points", () => {
    const mjds = [60801, 60989, 61005, 61021, 61151, 61171];
    const points = [...mjds.map((mjd) => exposure({ mjd })), exposure({ mjd: 61000, y: null, err: null }), exposure({ mjd: 61002, err: 0 })];
    expect(visitMeans(points).map((v) => v.count)).toEqual([1, 3, 2]);
  });
});

describe("changeVerdict", () => {
  const options = { warned: false, mock: false, available: true };

  it("never judges when the API warned, even with a large difference", () => {
    expect(changeVerdict([visit(1, 0.04), visit(2, 0.04)], { ...options, warned: true }))
      .toEqual({ tone: "unjudged", value: "Not judged", detail: "see the warning above" });
  });

  it("does not judge without a clear spectrum", () => {
    expect(changeVerdict([visit(1, 0.04), visit(2, 0.04)], { ...options, available: false }).detail).toBe("spectrum too uncertain");
  });

  it("needs two visits with at least three exposures each", () => {
    expect(changeVerdict([visit(1, 0.04), visit(2, 0.04, 2)], options).detail).toBe("needs 2 visits with 3+ exposures each");
    expect(changeVerdict([visit(1, 0.04)], options).value).toBe("Not judged");
  });

  it("reports a change at 5 times the combined error or more", () => {
    // |1.3 - 1.0| / sqrt(2 × 0.04²) = 5.30
    expect(changeVerdict([visit(1, 0.04), visit(1.3, 0.04)], options))
      .toEqual({ tone: "change", value: "Yes", detail: "visits differ by 30% (5.3 times the combined error)" });
  });

  it("calls 3 to 5 times the combined error unclear", () => {
    expect(changeVerdict([visit(1, 0.04), visit(1.2, 0.04)], options))
      .toEqual({ tone: "unclear", value: "Unclear", detail: "visits differ by 20%; not significant" });
  });

  it("gives the size of change the data could have seen, from the tightest pair", () => {
    // Tightest pair: 0.04 and 0.04 → 5 × 0.0566 = 28%.
    expect(changeVerdict([visit(1, 0.04), visit(1.02, 0.04), visit(1.05, 0.5)], options))
      .toEqual({ tone: "steady", value: "No sign", detail: "a change above 28% would show" });
  });

  it("marks mock results as synthetic", () => {
    expect(changeVerdict([visit(1, 0.04), visit(1.02, 0.04)], { ...options, mock: true }).detail).toMatch(/\(synthetic\)$/);
  });
});

describe("chartGeometry extraY", () => {
  it("widens the y range to include extra values such as the noise band", () => {
    const points = [{ x: 1, y: 1, err: 0 }, { x: 2, y: 1.001, err: 0 }];
    const { y0, y1 } = chartGeometry(points, 400, 220, false, [1 - NOISE_FLOOR, 1 + NOISE_FLOOR]);
    expect(y0).toBeLessThan(1 - NOISE_FLOOR);
    expect(y1).toBeGreaterThan(1 + NOISE_FLOOR);
  });
});
