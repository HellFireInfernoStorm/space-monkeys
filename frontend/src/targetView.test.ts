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
    expect(back.plx).toBe(439); // the parallax travels with the link
  });

  it("gives every built-in target the range scripts/prewarm.py warms", () => {
    const ranges: Record<string, [number, number]> = {
      barnard: [1.0, 1.2],
      "eps-ind-b": [1.1, 1.3],
      "wise-0855": [4.4, 5.0],
      "rw-aur": [2.0, 2.4],
      "r-dra": [2.0, 2.4],
    };
    for (const [id, [lo, hi]] of Object.entries(ranges)) {
      const change = viewForTarget(target(id, id));
      expect([change.wlmin, change.wlmax]).toEqual([lo, hi]);
    }
  });

  it("leaves the wavelength range alone for an unknown target", () => {
    const change = viewForTarget(target("other", "Other"));
    expect("wlmin" in change).toBe(false);
    expect("wlmax" in change).toBe(false);
    expect(change.name).toBe("Other");
  });
});
