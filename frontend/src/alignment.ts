import type { AlignmentResult, Frame } from "./api";

/** Exact gnomonic projection; includes RA wrap and the cosine of declination. */
export function alignmentSpot(ra: number, dec: number, frame: Frame, extent: number) {
  const rad = Math.PI / 180;
  const a = ra * rad, d = dec * rad;
  const a0 = frame.center_ra * rad, d0 = frame.center_dec * rad;
  const c = Math.sin(d0)*Math.sin(d) + Math.cos(d0)*Math.cos(d)*Math.cos(a-a0);
  const east = Math.cos(d)*Math.sin(a-a0)/c / rad * 3600;
  const north = (Math.cos(d0)*Math.sin(d)-Math.sin(d0)*Math.cos(d)*Math.cos(a-a0))/c / rad * 3600;
  const x = 50 - east / extent * 100, y = 50 - north / extent * 100;
  return { x, y, inside: c > 0 && x >= 0 && x <= 100 && y >= 0 && y <= 100 };
}

export function alignmentLabel(result: AlignmentResult | null): string {
  if (!result) return "Archive coordinates — not independently verified";
  if (result.mode === "mock") return "Mock demonstration — synthetic star matches";
  if (result.state === "timeout") return "Timed out — archive coordinates unverified";
  if (result.state === "busy") return "Check busy — archive coordinates unverified";
  if (result.state === "failed") return "Check unavailable — archive coordinates unverified";
  return result.provenance === "verified"
    ? "Verified against catalogue" : "Archive coordinates — verification rejected";
}
