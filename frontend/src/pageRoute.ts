/** Keep existing query-based workbench links working at the original root URL. */
export function isLandingPage(pathname: string, search: string): boolean {
  return pathname === "/" && search === "";
}
