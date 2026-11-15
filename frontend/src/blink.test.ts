import { describe, expect, it } from "vitest";

import type { Frame } from "./api";
import { colourSpread, imageAddress, playbackShortcut } from "./blink";

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
  it("maps only playback keys and toggles just once per Space press", () => {
    expect(playbackShortcut(" ", false)).toBe("toggle");
    expect(playbackShortcut(" ", true)).toBe("ignore-repeat");
    expect(playbackShortcut("ArrowLeft", false)).toBe(-1);
    expect(playbackShortcut("ArrowRight", true)).toBe(1);
    expect(playbackShortcut("Enter", false)).toBeNull();
  });

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
