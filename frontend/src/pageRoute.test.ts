// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { canonicalizeWorkbenchEntry, isLandingPage } from "./pageRoute";

afterEach(() => window.history.replaceState(null, "", "/"));

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

it("canonicalizes a legacy link without dropping its settings or fragment", () => {
  window.history.replaceState(null, "", "/?ra=133.8189083&dec=-7.247048&mode=stack#details");
  const length = window.history.length;
  canonicalizeWorkbenchEntry();
  expect(window.location.pathname).toBe("/explore/");
  expect(window.location.search).toBe("?ra=133.8189083&dec=-7.247048&mode=stack");
  expect(window.location.hash).toBe("#details");
  expect(window.history.length).toBe(length);
});

it("keeps an old default-only link in the workbench after its query is cleared", () => {
  window.history.replaceState(null, "", "/?speed=2");
  canonicalizeWorkbenchEntry();
  // The default view serializes to an empty query. App keeps this canonical pathname.
  window.history.replaceState(null, "", window.location.pathname);
  expect(window.location.pathname).toBe("/explore/");
  expect(isLandingPage(window.location.pathname, window.location.search)).toBe(false);
});

it.each(["/", "/#how-it-works", "/explore/?mode=stack"])("leaves %s in place", (url) => {
  window.history.replaceState(null, "", url);
  const before = window.location.href;
  canonicalizeWorkbenchEntry();
  expect(window.location.href).toBe(before);
});
