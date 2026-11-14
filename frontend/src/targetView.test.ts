import { describe, expect, it } from "vitest";

import type { Target } from "./api";
import { viewForTarget } from "./targetView";
import { DEFAULT_VIEW, parseView, serializeView } from "./urlState";

function target(id: string, name: string): Target {
  return {
    id,
    name,
    aliases: [],
    ra: 133.81890825,
    dec: -7.247048,
    pmra: -8123.7,
    pmdec: 673.2,
    parallax: 439,
    epoch: 2000,
    kind: "",
    note: "",
    reference: "",
  };
}

describe("viewForTarget", () => {
  it("sets 4.4 to 5.0 micrometres for WISE 0855, and the link keeps it", () => {
    const view = { ...DEFAULT_VIEW, ...viewForTarget(target("wise-0855", "WISE 0855")) };
    expect(view.wlmin).toBe(4.4);
    expect(view.wlmax).toBe(5);
    const back = parseView(serializeView(view));
    expect([back.wlmin, back.wlmax, back.name]).toEqual([4.4, 5, "WISE 0855"]);
  });

  it("leaves the wavelength range alone for other targets", () => {
    const change = viewForTarget(target("barnard", "Barnard's Star"));
    expect("wlmin" in change).toBe(false);
    expect("wlmax" in change).toBe(false);
    expect(change.name).toBe("Barnard's Star");
  });
});
