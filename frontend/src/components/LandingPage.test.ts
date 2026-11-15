// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import LandingPage from "./LandingPage";

it("offers working section anchors and an honest entry into the workbench", () => {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(createElement(LandingPage));
  for (const link of page.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
    expect(page.querySelector(link.getAttribute("href")!), link.textContent ?? "section link").not.toBeNull();
  }
  expect(page.querySelector('a[href="/explore/"]')?.textContent).toContain("Open workbench");
  expect(page.textContent).toContain("Synthetic data, clearly labelled");
  expect(page.textContent).toContain("not live demo measurements");
  expect(page.querySelectorAll("h1")).toHaveLength(1);
});
