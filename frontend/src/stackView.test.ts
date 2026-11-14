import { describe, expect, it } from "vitest";

import type { MotionPoint, StackImage } from "./api";
import { dayOf, measuredText, offsetText, sigmaText, spotPercent, stackLabel } from "./stackView";

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
    image_url: "/api/stack.png?kind=tracked",
    ...change,
  };
}

describe("stackView", () => {
  it("labels stacks and single exposures", () => {
    expect(stackLabel(image({}))).toBe("46 exposures stacked, about 19 sigma");
    expect(stackLabel(image({ kind: "single", n_exposures: 1, snr: 4.49 }))).toBe("1 exposure, about 4.5 sigma");
    expect(stackLabel(image({ snr: null }))).toBe("46 exposures stacked");
    expect(sigmaText(undefined)).toBe("");
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
      predicted_east_arcsec: -3.61,
      predicted_north_arcsec: 0.3,
      measured_east_arcsec: -4.33,
      measured_north_arcsec: 2.22,
      error_arcsec: 0.54,
      snr: 14,
    };
    expect(measuredText(point)).toBe("4.3″ W, 2.2″ N (± 0.5″)");
    expect(measuredText({ ...point, error_arcsec: null })).toBe("4.3″ W, 2.2″ N");
  });
});
