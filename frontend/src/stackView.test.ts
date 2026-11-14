import { describe, expect, it } from "vitest";

import type { MotionPoint, StackImage } from "./api";
import {
  dayOf,
  differenceText,
  measuredText,
  offsetText,
  predictedText,
  sigmaText,
  spotPercent,
  stackLabel,
} from "./stackView";

function image(change: Partial<StackImage>): StackImage {
  return {
    kind: "tracked",
    index: 0,
    n_exposures: 46,
    exposure_ids: [],
    mjd_start: 60800,
    mjd_end: 61171,
    mjd_mid: 61000,
    wl_min_um: 4.4,
    wl_max_um: 5,
    center_ra: 133.76,
    center_dec: -7.24,
    target_x: 10,
    target_y: 10,
    snr: 18.6,
    saturated: false,
    image_url: "/api/stack.png?kind=tracked",
    ...change,
  };
}

describe("stackView", () => {
  it("labels stacks and single exposures", () => {
    expect(stackLabel(image({}))).toBe("46 exposures stacked, about 19 sigma");
    expect(stackLabel(image({ kind: "single", n_exposures: 1, snr: 4.49 }))).toBe("1 exposure");
    expect(sigmaText(4.49)).toBe("about 4.5 sigma");
    expect(stackLabel(image({ snr: null }))).toBe("46 exposures stacked");
    expect(sigmaText(undefined)).toBe("");
    // A saturated core has no S/N by design: the label says so instead of leaving it out.
    expect(stackLabel(image({ snr: null, saturated: true }))).toBe("46 exposures stacked, saturated");
    expect(stackLabel(image({ kind: "single", n_exposures: 1, snr: null, saturated: true }))).toBe(
      "1 exposure, saturated",
    );
  });

  it("places markers by stack pixel", () => {
    expect(spotPercent(10, 5, 20)).toEqual({ left: "50%", top: "25%" });
  });

  it("writes dates and offsets", () => {
    expect(dayOf(60800)).toBe("2025-05-05");
    expect(offsetText(-3.61, 0.3)).toBe("3.6″ W, 0.3″ N");
    expect(offsetText(null, null)).toBe("too faint");
    const point: MotionPoint = {
      index: 1,
      mjd_mid: 61157.9,
      predicted_east_arcsec: -4.43,
      predicted_north_arcsec: 0.54,
      parallax_east_arcsec: -0.82,
      parallax_north_arcsec: 0.24,
      measured_east_arcsec: -3.93,
      measured_north_arcsec: 1.04,
      error_east_arcsec: 0.5,
      error_north_arcsec: 0.25,
      error_method: "bootstrap",
      error_arcsec: 0.5,
      snr: 14,
      saturated: false,
    };
    expect(measuredText(point)).toBe("3.9 ± 0.5″ W, 1.0 ± 0.3″ N");
    expect(measuredText({ ...point, error_east_arcsec: null, error_north_arcsec: null })).toBe("3.9″ W, 1.0″ N");
    expect(measuredText({ ...point, measured_east_arcsec: null })).toBe("too faint");
    expect(predictedText(point)).toBe("4.4″ W, 0.5″ N (parallax 0.8″ W, 0.2″ N)");
    expect(predictedText({ ...point, parallax_east_arcsec: 0, parallax_north_arcsec: 0 })).toBe("4.4″ W, 0.5″ N");
    expect(differenceText(point)).toBe("0.5″ E (1.0σ), 0.5″ N (2.0σ)");
    expect(differenceText({ ...point, error_east_arcsec: null })).toBe("");
    expect(measuredText({ ...point, saturated: true })).toBe(
      "3.9 ± 0.5″ W, 1.0 ± 0.3″ N (saturated: fitted to the wings, error statistical only)",
    );
    expect(measuredText({ ...point, saturated: true, measured_north_arcsec: null })).toBe("saturated, not measured");
  });
});
