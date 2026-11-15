// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import type { AlignmentResult, FrameList } from "../api";
import BlinkPlayer from "./BlinkPlayer";

const list: FrameList = {
  capped: false, ra: 10, dec: 20, mode: "mock", pixel_scale: 6.15,
  returned: 2, size: 120, total: 2, track: false,
  frames: ["a", "b"].map((id) => ({
    exposure_id: id, collection: "mock", detector: 2, mjd: 60900,
    wavelength_um: 1.1, image_url: `/api/frame.png?id=${id}`,
    center_ra: 10, center_dec: 20, target_ra: 10, target_dec: 20,
  })),
};

const alignment: AlignmentResult = {
  exposure_id: "a", center_ra: 10, center_dec: 20, target_ra: 10, target_dec: 20,
  mode: "mock", mjd: 60900, state: "complete", provenance: "mock", quality_passed: true,
  reason: "Synthetic demonstration", catalogue: "mock", catalogue_url: "", solver_version: "test",
  correction_applied: false, detected: 8, matched: 8, rejected: 0, field_arcsec: 990, elapsed_s: 0,
  matches: [{ source_id: "demo", catalogue_ra: 10, catalogue_dec: 20,
    measured_ra: 10, measured_dec: 20, east_arcsec: 0, north_arcsec: 0,
    residual_arcsec: 0, offset_arcsec: 0, fit_residual_arcsec: 0, inlier: true }],
};

describe("rendered blink keyboard controls", () => {
  let root: Root;
  let container: HTMLDivElement;
  let setVisible: (visible: boolean) => void;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(api, "getAlignment").mockResolvedValue(alignment);
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) {
        setVisible = (visible) => {
          callback([{ intersectionRatio: Number(visible) } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
        };
      }
      observe() { setVisible(true); }
      disconnect() {}
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(createElement(BlinkPlayer, {
      list, mode: "blink", speed: 1, onChange: () => {}, showMatches: true,
    })));
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function press(key: string, target: Element = document.body) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    act(() => { target.dispatchEvent(event); });
    return event.defaultPrevented;
  }

  const playerButton = () => container.querySelector(".transport button")?.textContent;

  it.each(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "])(
    "keeps %s inside the reference table without changing frames or playback", async (key) => {
      await act(async () => {
        container.querySelector<HTMLButtonElement>(".alignment-panel button")!.click();
      });
      const details = container.querySelector(".alignment-panel details")!;
      details.setAttribute("open", "");
      const table = container.querySelector<HTMLDivElement>(".alignment-table")!;
      table.scrollBy = vi.fn();
      table.focus();
      expect(press(key, table)).toBe(true);
      expect(container.querySelector(".alignment-table")).toBe(table);
      expect(container.querySelector<HTMLInputElement>('input[aria-label="Frame"]')?.value).toBe("0");
      expect(playerButton()).toBe("Play");
      expect(table.scrollBy).toHaveBeenCalledOnce();
    },
  );

  it("allows a rendered A check to retry after keyboard navigation to B and back", async () => {
    let finish!: (result: AlignmentResult) => void;
    vi.mocked(api.getAlignment).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".alignment-panel button")!.click();
    });
    expect(container.querySelector<HTMLButtonElement>(".alignment-panel button")!.disabled).toBe(true);
    press("ArrowRight");
    press("ArrowLeft");
    expect(container.querySelector<HTMLButtonElement>(".alignment-panel button")!.disabled).toBe(false);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".alignment-panel button")!.click();
      finish(alignment);
    });
    expect(container.querySelector<HTMLButtonElement>(".alignment-panel button")!.disabled).toBe(false);
    expect(container.querySelector(".alignment-table")).not.toBeNull();
  });

  it("lets Space scroll when the player is offscreen", () => {
    setVisible(false);
    expect(press(" ")).toBe(false);
    expect(playerButton()).toBe("Play");
    setVisible(true);
    expect(press(" ")).toBe(true);
    expect(playerButton()).toBe("Pause");
  });

  it("uses Space on the playback sliders and leaves their arrows to the browser", () => {
    const sliders = container.querySelectorAll<HTMLInputElement>("input[type=range]");
    for (const slider of sliders) {
      expect(press("ArrowRight", slider)).toBe(false);
      expect(sliders[0].value).toBe("0");
      expect(press(" ", slider)).toBe(true);
      expect(playerButton()).toBe("Pause");
      expect(press(" ", slider)).toBe(true);
      expect(playerButton()).toBe("Play");
    }
  });

  it("leaves Space alone in text inputs and links, and works after focusing the sky panel", () => {
    const input = document.createElement("input");
    const link = document.createElement("a");
    link.href = "#details";
    const skyPanel = document.createElement("div");
    skyPanel.id = "panel-sky";
    skyPanel.tabIndex = 0;
    document.body.append(input, link, skyPanel);
    expect(press(" ", input)).toBe(false);
    expect(press(" ", link)).toBe(false);
    expect(playerButton()).toBe("Play");
    skyPanel.focus();
    expect(press(" ", skyPanel)).toBe(true);
    expect(playerButton()).toBe("Pause");
    expect(press("ArrowRight", skyPanel)).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Frame"]')?.value).toBe("1");
    expect(playerButton()).toBe("Play");
  });
});
