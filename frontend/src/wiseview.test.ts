import { describe, expect, it } from "vitest";

import { wiseViewUrl } from "./wiseview";

describe("wiseViewUrl", () => {
  it("puts the position and size after the hash", () => {
    expect(wiseViewUrl(133.75977, -7.24219, 180)).toBe(
      "http://byw.tools/wiseview#ra=133.759770&dec=-7.242190&size=180",
    );
  });

  it("keeps the size within sensible limits", () => {
    expect(wiseViewUrl(10, 20, 5)).toContain("size=30");
    expect(wiseViewUrl(10, 20, 99999)).toContain("size=2000");
    expect(wiseViewUrl(10, 20)).toContain("size=176");
  });
});
