import { describe, expect, it } from "vitest";

import { DEFAULT_VIEW, parseView, serializeView, type ViewState } from "./urlState";

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
      speed: 4,
      mode: "diff",
      track: true,
      sky: "spherex",
      name: "WISE 0855",
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
      { speed: 8 },
      { mode: "diff" },
      { mode: "stack" },
      { track: true },
      { sky: "spherex" },
      { name: "Barnard's Star" },
    ];
    for (const change of changes) {
      const view = { ...DEFAULT_VIEW, ...change };
      expect(parseView(serializeView(view))).toEqual(view);
    }
  });

  it("ignores values that are out of range or not numbers", () => {
    const view = parseView("?ra=400&dec=20&size=5&speed=fast&mode=sideways&epoch=1500&sky=moon");
    expect(view).toEqual(DEFAULT_VIEW);
  });

  it("needs both coordinates before it accepts a position", () => {
    expect(parseView("?ra=10").ra).toBeNull();
    expect(parseView("?dec=10").dec).toBeNull();
  });
});
