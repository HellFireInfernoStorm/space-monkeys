// @vitest-environment jsdom
// Layer 3, phase 4: the spectrum tab talking to the frame player, the CSV download and drag to zoom.

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "./api";
import type { PhotometryPoint } from "./api";
import PhotometryPanel from "./components/PhotometryPanel";
import { DEFAULT_VIEW, type ViewState } from "./urlState";

function point(i: number, over: Partial<PhotometryPoint> = {}): PhotometryPoint {
  return {
    exposure_id: `e${i}`, obs_id: `o${i}`, det_id: 6, mjd: 60800 + i * 10, wavelength: 4.4 + i * 0.05,
    lambda_width: 0.035, flux: 0.001, flux_err: 0.0001, flags: 0, usable: true, reason: null, ...over,
  };
}

describe("spectrum tab, phase 4", () => {
  let container: HTMLDivElement;
  let root: Root;
  let views: ViewState[];
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() { this.callback([{ contentRect: { width: 700 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
      disconnect() {}
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    views = [];
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(props: Record<string, unknown> = {}, points = Array.from({ length: 12 }, (_, i) => point(i))) {
    const fetch = vi.spyOn(api, "getPhotometry").mockResolvedValue({
      points, capped: false, returned: points.length, total: points.length,
      ra: 10, dec: 20, mode: "mock", flux_unit: "Jy", method: "aperture", warnings: [],
    });
    function Harness() {
      const [view, setView] = useState<ViewState>({ ...DEFAULT_VIEW, ra: 10, dec: 20, wlmin: 4.4, wlmax: 5, name: "Test star", phot: true });
      views.push(view);
      return createElement(PhotometryPanel, { view, bands: [], ...props,
        onChange: (change: Partial<ViewState>) => setView((previous) => ({ ...previous, ...change })),
      });
    }
    await act(async () => root.render(createElement(Harness)));
    return fetch;
  }

  const charts = () => [...container.querySelectorAll<SVGSVGElement>("svg.plot")];
  const hit = (chart: SVGSVGElement) => chart.querySelector<SVGRectElement>("rect.hit")!;
  /** Centre of a chart's n-th point, in the chart's pixels (jsdom puts the chart at 0, 0). */
  const pointAt = (chart: SVGSVGElement, n: number) => {
    const dot = chart.querySelectorAll("circle.dot")[n];
    return { clientX: Number(dot.getAttribute("cx")), clientY: Number(dot.getAttribute("cy")) };
  };

  it("opens the clicked exposure in the player, from either chart, and says so in the tooltip", async () => {
    const onOpenFrame = vi.fn();
    await render({ onOpenFrame });
    const [spectrum, lightCurve] = charts();
    act(() => { hit(lightCurve).dispatchEvent(new MouseEvent("click", { bubbles: true, ...pointAt(lightCurve, 3) })); });
    expect(onOpenFrame).toHaveBeenLastCalledWith("e3");
    expect(container.querySelector(".chart-tooltip")!.textContent).toContain("Click to show this frame");
    act(() => { hit(spectrum).dispatchEvent(new MouseEvent("click", { bubbles: true, ...pointAt(spectrum, 7) })); });
    expect(onOpenFrame).toHaveBeenLastCalledWith("e7");
  });

  it("marks the player's frame on both charts and rings its point", async () => {
    await render({ currentFrame: { id: "e5", mjd: 60850 } });
    for (const chart of charts()) {
      expect(chart.querySelector(".frame-marker")).not.toBeNull();
      expect(chart.querySelectorAll(".frame-ring")).toHaveLength(1);
    }
  });

  it("marks only the light curve when the frame was not measured here", async () => {
    await render({ currentFrame: { id: "elsewhere", mjd: 60850 } });
    const [spectrum, lightCurve] = charts();
    expect(spectrum.querySelector(".frame-marker")).toBeNull();
    expect(lightCurve.querySelector(".frame-marker")).not.toBeNull();
    expect(container.querySelector(".frame-ring")).toBeNull();
  });

  it("explains when the exposure is not among the player's frames, and drops the notice on a new measurement", async () => {
    vi.spyOn(api, "getPhotometry").mockResolvedValue({
      points: [point(0), point(1)], capped: false, returned: 2, total: 2,
      ra: 10, dec: 20, mode: "mock", flux_unit: "Jy", method: "aperture", warnings: [],
    });
    const view: ViewState = { ...DEFAULT_VIEW, ra: 10, dec: 20, wlmin: 4.4, wlmax: 5, phot: true };
    const show = (props: Record<string, unknown>) => createElement(PhotometryPanel, { view, bands: [], onChange: () => {}, ...props });
    await act(async () => root.render(show({ missingFrame: null })));
    // The answer arrives after the click, while the measurement is on screen.
    await act(async () => root.render(show({ missingFrame: { id: "e9", nonce: 1, loaded: 40 } })));
    expect(container.textContent).toContain("That exposure is not among the 40 frames loaded in the player.");
    await act(async () => root.render(show({ missingFrame: { id: "e9", nonce: 1, loaded: 40 }, view: { ...view, wlmin: 4.5 } })));
    expect(container.textContent).not.toContain("That exposure is not among");
  });

  it("downloads every exposure as CSV, marked mock in the name and the header", async () => {
    let saved: Blob | undefined;
    URL.createObjectURL = vi.fn((blob: Blob) => { saved = blob; return "blob:test"; });
    URL.revokeObjectURL = vi.fn();
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this.download); });
    await render({}, [point(0), point(1, { flux: null, flux_err: null, usable: false, reason: "flags: HALO, TRANSIENT" })]);
    const download = [...container.querySelectorAll("button")].find((b) => b.textContent === "Download CSV")!;
    act(() => download.click());
    expect(clicks).toEqual(["spaceshift-test-star-4.4-5um-mock.csv"]);
    const text = await saved!.text();
    expect(text).toContain("# mode: mock: synthetic numbers, not measurements of the real sky");
    expect(text).toContain("e0,o0,6,60800,");
    expect(text).toContain(',false,"flags: HALO, TRANSIENT",');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });

  it("sets the wavelength range from a drag across the spectrum, and treats a short drag as a click", async () => {
    const onOpenFrame = vi.fn();
    const fetch = await render({ onOpenFrame });
    const spectrum = charts()[0];
    const at = (clientX: number) => ({ bubbles: true, clientX, clientY: 60, button: 0 });
    // A 5 px drag: no new range.
    act(() => {
      hit(spectrum).dispatchEvent(new MouseEvent("pointerdown", at(200)));
      hit(spectrum).dispatchEvent(new MouseEvent("pointermove", at(205)));
      hit(spectrum).dispatchEvent(new MouseEvent("pointerup", at(205)));
    });
    expect(views.at(-1)!.wlmin).toBe(4.4);
    // A wide drag: new range, ordered, and the click that follows does not open a frame.
    act(() => { hit(spectrum).dispatchEvent(new MouseEvent("pointerdown", at(400))); });
    act(() => { hit(spectrum).dispatchEvent(new MouseEvent("pointermove", at(150))); });
    expect(container.querySelector(".drag-band text")!.textContent).toMatch(/^\d\.\d\d–\d\.\d\d µm$/);
    await act(async () => {
      hit(spectrum).dispatchEvent(new MouseEvent("pointerup", at(150)));
      hit(spectrum).dispatchEvent(new MouseEvent("click", at(150)));
    });
    const view = views.at(-1)!;
    expect(view.wlmin).toBeGreaterThan(4.4);
    expect(view.wlmax).toBeLessThan(5);
    expect(view.wlmin!).toBeLessThan(view.wlmax!);
    expect(onOpenFrame).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ wl_min: view.wlmin, wl_max: view.wlmax }), expect.anything());
  });
});

describe("frame player, phase 4", () => {
  it("jumps to a requested exposure and reports whether it had it", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
    const { default: BlinkPlayer } = await import("./components/BlinkPlayer");
    const frame = (i: number) => ({
      exposure_id: `e${i}`, collection: "c", detector: 6, mjd: 60800 + i, wavelength_um: 4.6, image_url: `/f${i}.png`,
      center_ra: 10, center_dec: 20, target_ra: 10, target_dec: 20,
    });
    const list = { mode: "mock", ra: 10, dec: 20, size: 120, pixel_scale: 6.15, track: false, total: 3, returned: 3,
      capped: false, warnings: [], frames: [frame(0), frame(1), frame(2)] } as unknown as api.FrameList;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const results: Array<[string, boolean]> = [];
    const show = (requestedFrame: { id: string; nonce: number } | null) => createElement(BlinkPlayer, {
      list, speed: 2, mode: "blink", onChange: () => {}, showMatches: false, requestedFrame,
      onRequestResult: (request: { id: string }, found: boolean) => results.push([request.id, found]),
    });
    await act(async () => root.render(show(null)));
    await act(async () => root.render(show({ id: "e2", nonce: 1 })));
    expect(container.querySelector(".stage")!.getAttribute("aria-label")).toBe("Frame 3 of 3");
    await act(async () => root.render(show({ id: "gone", nonce: 2 })));
    expect(container.querySelector(".stage")!.getAttribute("aria-label")).toBe("Frame 3 of 3");
    expect(results).toEqual([["e2", true], ["gone", false]]);
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
});
