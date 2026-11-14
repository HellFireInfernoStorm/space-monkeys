import { describe, expect, it } from "vitest";

import { detailText } from "./api";

describe("detailText", () => {
  it("passes a plain string through", () => {
    expect(detailText("No exposures.")).toBe("No exposures.");
  });

  it("turns FastAPI's 422 list into a sentence", () => {
    const detail = [
      { type: "greater_than", loc: ["query", "wl_min"], msg: "Input should be greater than 0." },
      { loc: ["query", "dec"], msg: "Input should be less than or equal to 90" },
    ];
    expect(detailText(detail)).toBe(
      "The server rejected the request. wl_min: Input should be greater than 0; dec: Input should be less than or equal to 90.",
    );
  });

  it("gives null for anything else", () => {
    expect(detailText(undefined)).toBeNull();
    expect(detailText([])).toBeNull();
  });
});
