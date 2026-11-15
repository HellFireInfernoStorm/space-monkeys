// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import LandingPage from "./LandingPage";
import { parseView } from "../urlState";

it("offers working section anchors and an honest entry into the workbench", () => {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(createElement(LandingPage));
  for (const link of page.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
    expect(page.querySelector(link.getAttribute("href")!), link.textContent ?? "section link").not.toBeNull();
  }
  expect(page.querySelector('a[href="/explore/"]')?.textContent).toContain("Open workbench");
  expect(page.textContent).toContain("The workbench labels real and synthetic data.");
  expect(page.textContent).not.toContain("Synthetic data, clearly labelled");
  expect(page.textContent).toContain("not live demo measurements");
  expect(page.querySelectorAll("h1")).toHaveLength(1);
});

it("opens the featured WISE 0855 stack with its motion and wavelength range", () => {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(createElement(LandingPage));
  const link = [...page.querySelectorAll<HTMLAnchorElement>("a")]
    .find((a) => a.textContent?.startsWith("Try stacking"))!;
  const url = new URL(link.href);
  const view = parseView(url.search);
  expect(url.pathname).toBe("/explore/");
  expect(view).toMatchObject({
    name: "WISE 0855", mode: "stack", epoch: 2000,
    pmra: -8123.7, pmdec: 673.2, plx: 439, wlmin: 4.4, wlmax: 5,
  });
  expect(view.ra).toBeCloseTo(133.81890825, 6);
  expect(view.dec).toBeCloseTo(-7.247048, 6);
});
