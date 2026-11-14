import { describe, expect, it } from "vitest";

import type { Frame } from "./api";
import { imageAddress } from "./blink";

function frame(id: string, wavelength: number | null = 1.1): Frame {
  return {
    exposure_id: id,
    collection: "spherex_dr1",
    detector: 2,
    mjd: 60900,
    wavelength_um: wavelength,
    image_url: `/api/frame.png?exposure_id=${id}`,
    center_ra: 10,
    center_dec: 20,
    target_ra: 10,
    target_dec: 20,
  };
}

describe("blink", () => {
  it("shows the reference frame plainly in difference mode and the others minus it", () => {
    const reference = frame("A-D2");
    expect(imageAddress(reference, "diff", reference)).toBe("/api/frame.png?exposure_id=A-D2");
    expect(imageAddress(frame("B-D2"), "diff", reference)).toBe(
      "/api/frame.png?exposure_id=B-D2&diff_ref=A-D2",
    );
    expect(imageAddress(frame("B-D2"), "blink", reference)).toBe("/api/frame.png?exposure_id=B-D2");
  });
});
