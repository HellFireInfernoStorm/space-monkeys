import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { alignmentLabel, alignmentSpot } from "./alignment";
import { MatchOverlay } from "./components/AlignmentPanel";
import type { AlignmentResult, Frame } from "./api";
import { DEFAULT_VIEW, isNewView, parseView, serializeView } from "./urlState";

const frame = { exposure_id: "test", center_ra: 0, center_dec: 0, target_ra: 0, target_dec: 0 } as Frame;
const result: AlignmentResult = {
  center_ra: 0, center_dec: 0, target_ra: 0, target_dec: 0,
  mode: "live", exposure_id: "test", mjd: 61000, state: "complete", provenance: "verified",
  reason: "test", catalogue: "test", catalogue_url: "", solver_version: "test", field_arcsec: 990,
  correction_applied: false, detected: 12, elapsed_s: 1, matched: 12, rejected: 0,
  matches: [{ source_id: "1", catalogue_ra: 0, catalogue_dec: 0, measured_ra: 0.0001,
    measured_dec: 0, east_arcsec: 0.36, north_arcsec: 0, residual_arcsec: 0.36, inlier: true }],
};

describe("visible independent alignment", () => {
  it("projects centre and east/north with correct handedness", () => {
    expect(alignmentSpot(0, 0, frame, 120)).toEqual({ x: 50, y: 50, inside: true });
    expect(alignmentSpot(0.001, 0, frame, 120).x).toBeLessThan(50);
    expect(alignmentSpot(0, 0.001, frame, 120).y).toBeLessThan(50);
    expect(alignmentSpot(180, 0, frame, 120).inside).toBe(false);
  });
  it("handles RA wrap and high declination", () => {
    expect(alignmentSpot(359.999, 0, frame, 120).x).toBeCloseTo(53, 5);
    const polar = { ...frame, center_dec: 85 };
    expect(alignmentSpot(0.01, 85, polar, 120).x).toBeCloseTo(47.3853, 3);
  });
  it("round-trips overlay preference and records history", () => {
    expect(parseView(serializeView({ ...DEFAULT_VIEW, matches: false })).matches).toBe(false);
    expect(parseView("?matches=garbage").matches).toBe(true);
    expect(isNewView(DEFAULT_VIEW, { ...DEFAULT_VIEW, matches: false })).toBe(true);
  });
  it("never labels archive or mock results independently verified", () => {
    expect(alignmentLabel(null)).toContain("not independently verified");
    expect(alignmentLabel(result)).toBe("Verified against catalogue");
    expect(alignmentLabel({ ...result, mode: "mock" })).toContain("Mock demonstration");
    for (const state of ["failed", "timeout", "busy"] as const) {
      expect(alignmentLabel({ ...result, state })).toContain("unverified");
    }
  });
  it("draws true matches and never overlays another exposure", () => {
    const svg = renderToStaticMarkup(createElement(MatchOverlay, { result, frame, extent: 120 }));
    expect(svg).toContain("<circle");
    expect(svg).toContain("<path");
    expect(renderToStaticMarkup(createElement(MatchOverlay, {
      result, frame: { ...frame, exposure_id: "other" }, extent: 120,
    }))).toBe("");
  });
});
