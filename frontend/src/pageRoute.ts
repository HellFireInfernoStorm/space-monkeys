/** Keep existing query-based workbench links working at the original root URL. */
export function isLandingPage(pathname: string, search: string): boolean {
  return pathname === "/" && search === "";
}

/** Move legacy shared links once, before App starts writing view changes. */
export function canonicalizeWorkbenchEntry(): void {
  if (window.location.pathname === "/" && window.location.search) {
    window.history.replaceState(null, "", "/explore/" + window.location.search + window.location.hash);
  }
}
