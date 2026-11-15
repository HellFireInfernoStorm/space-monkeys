import { describe, expect, it } from "vitest";
import { isLandingPage } from "./pageRoute";

describe("homepage entry without breaking shared workbench URLs", () => {
  it("opens the homepage only for the bare root URL", () => {
    expect(isLandingPage("/", "")).toBe(true);
    expect(isLandingPage("/explore", "")).toBe(false);
    expect(isLandingPage("/explore/", "")).toBe(false);
    expect(isLandingPage("/explore", "?ra=10&dec=20")).toBe(false);
    expect(isLandingPage("/", "?ra=10&dec=20&phot=1")).toBe(false);
    expect(isLandingPage("/", "?mode=stack")).toBe(false);
  });
});
