import { describe, expect, it } from "vitest";

import { propagate, wiseViewUrl } from "./wiseview";

describe("wiseViewUrl", () => {
  it("puts the position and size after the hash", () => {
    expect(wiseViewUrl({ ra: 133.75977, dec: -7.24219 }, 180)).toBe(
      "http://byw.tools/wiseview#ra=133.759770&dec=-7.242190&size=180",
    );
  });

  it("keeps the size within sensible limits", () => {
    expect(wiseViewUrl({ ra: 10, dec: 20 }, 5)).toContain("size=30");
    expect(wiseViewUrl({ ra: 10, dec: 20 }, 99999)).toContain("size=2000");
    expect(wiseViewUrl({ ra: 10, dec: 20 })).toContain("size=176");
  });

  it("moves a fast star from its catalogue epoch to the WISE era", () => {
    // WISE 0855, catalogue position for 2000.0, moved to 2014.0 by hand:
    // RA -8123.7 mas/yr * 14 yr / cos(-7.247 deg), Dec +673.2 mas/yr * 14 yr.
    const url = wiseViewUrl({ ra: 133.81890825, dec: -7.247048, pmra: -8123.7, pmdec: 673.2, epoch: 2000 });
    expect(url).toBe("http://byw.tools/wiseview#ra=133.787062&dec=-7.244430&size=176");
    // WiseView's own default position (a WISE 0855 position, read from its script) is 3 arcsec away.
    const here = propagate(133.81890825, -7.247048, -8123.7, 673.2, 2000, 2014);
    const offset = Math.hypot((here.ra - 133.786245) * Math.cos((7.244 * Math.PI) / 180), here.dec + 7.244372) * 3600;
    expect(offset).toBeLessThan(5);
  });

  it("leaves a star without motion where it is", () => {
    expect(wiseViewUrl({ ra: 10, dec: 20, pmra: 0, pmdec: 0, epoch: 2000 })).toContain("ra=10.000000&dec=20.000000");
  });
});
