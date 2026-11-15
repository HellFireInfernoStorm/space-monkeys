import { describe, expect, it } from "vitest";

import { DEFAULT_VIEW, isNewView, parseView, serializeView, type ViewState } from "./urlState";

describe("urlState", () => {
  it("gives the defaults for an empty URL, and an empty URL for the defaults", () => {
    expect(parseView("")).toEqual(DEFAULT_VIEW);
    expect(serializeView(DEFAULT_VIEW)).toBe("");
  });

  it("round-trips every parameter", () => {
    const view: ViewState = {
      ra: 133.8189083,
      dec: -7.247048,
      size: 180,
      wlmin: 4.42,
      wlmax: 5,
      pmra: -8123.7,
      pmdec: 673.2,
      epoch: 2014.5,
      plx: 439,
      speed: 4,
      mode: "diff",
      track: true,
      sky: "spherex",
      name: "WISE 0855",
      phot: true,
      pra: 133.802411,
      pdec: -7.245112,
      bin: true,
    };
    expect(parseView("?" + serializeView(view))).toEqual(view);
  });

  it("round-trips each parameter on its own", () => {
    const changes: Partial<ViewState>[] = [
      { ra: 10, dec: 20 },
      { size: 300 },
      { wlmin: 0.75 },
      { wlmax: 1.09 },
      { pmra: -801.551 },
      { pmdec: 10362.394 },
      { epoch: 2016 },
      { plx: 546.976 },
      { speed: 8 },
      { mode: "diff" },
      { mode: "stack" },
      { track: true },
      { sky: "spherex" },
      { name: "Barnard's Star" },
      { phot: true },
      { pra: 76.97773, pdec: 30.37557 },
      { bin: true },
    ];
    for (const change of changes) {
      const view = { ...DEFAULT_VIEW, ...change };
      expect(parseView(serializeView(view))).toEqual(view);
    }
  });

  it("ignores values that are out of range or not numbers", () => {
    const view = parseView("?ra=400&dec=20&size=5&speed=fast&mode=sideways&epoch=1500&sky=moon&plx=-3");
    expect(view).toEqual(DEFAULT_VIEW);
  });

  it("needs both coordinates of a measured point, in range", () => {
    expect(parseView("?pra=10").pra).toBeNull();
    expect(parseView("?pra=10&pdec=95").pdec).toBeNull();
    expect(parseView("?pra=10&pdec=20")).toMatchObject({ pra: 10, pdec: 20 });
  });

  it("needs both coordinates before it accepts a position", () => {
    expect(parseView("?ra=10").ra).toBeNull();
    expect(parseView("?dec=10").dec).toBeNull();
  });
});

describe("isNewView", () => {
  it("is true for a new target, position, range or mode", () => {
    expect(isNewView(DEFAULT_VIEW, { ...DEFAULT_VIEW, ra: 1, dec: 2 })).toBe(true);
    expect(isNewView(DEFAULT_VIEW, { ...DEFAULT_VIEW, wlmin: 1, wlmax: 2 })).toBe(true);
    expect(isNewView(DEFAULT_VIEW, { ...DEFAULT_VIEW, mode: "diff" })).toBe(true);
  });

  it("is false for speed and the background survey", () => {
    expect(isNewView(DEFAULT_VIEW, { ...DEFAULT_VIEW, speed: 5, sky: "spherex" })).toBe(false);
  });
});
