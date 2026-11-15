import { describe, expect, it } from "vitest";

import type { Frame } from "./api";
import { colourSpread, imageAddress, framePixels } from "./blink";

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

  it("warns about colour only for a wide spread of wavelengths", () => {
    const narrow = [frame("a", 1.0047), frame("b", 1.1995), frame("c", 1.1)]; // Barnard's Star, 1.0 to 1.2
    expect(colourSpread(narrow).warn).toBe(false);
    const band2 = [frame("a", 1.11), frame("b", 1.6)];
    expect(colourSpread(band2)).toEqual({ shortest: 1.11, longest: 1.6, warn: true });
    expect(colourSpread([frame("a", 0.8)]).warn).toBe(false);
    expect(colourSpread([frame("a", null), frame("b", 2.0)]).warn).toBe(false);
  });
});

it("matches the backend odd image grids at normal and limiting field sizes", () => {
  expect(framePixels(120, 6.15)).toBe(21);
  expect(framePixels(30, 6.15)).toBe(9);
  expect(framePixels(600, 6.15)).toBe(95);
  expect(framePixels(129.15, 6.15)).toBe(21);
});
