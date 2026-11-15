// Layer 4: pure helpers for the WISE (2010) against SPHEREx comparison. No React.

import { propagate } from "./wiseview";

const MJD_J2000 = 51544.5;

/** MJD to decimal year, as `mjd_to_year()` in backend/app/targets.py. */
export function mjdToYear(mjd: number): number {
  return 2000 + (mjd - MJD_J2000) / 365.25;
}

export interface Motion {
  ra: number;
  dec: number;
  pmra: number;
  pmdec: number;
  epoch: number;
}

/** Offset east and north (arcseconds) of a position from an image centre. */
export function offsetArcsec(ra: number, dec: number, raC: number, decC: number): { east: number; north: number } {
  const dRa = ((((ra - raC) % 360) + 540) % 360) - 180;
  return { east: dRa * Math.cos((decC * Math.PI) / 180) * 3600, north: (dec - decC) * 3600 };
}

/**
 * Where an object with proper motion is on a date, as fractions of an image `extent`
 * arcseconds wide from its top-left corner (north up, east left), and whether that is inside.
 */
export function spotOnDate(
  target: Motion,
  mjd: number,
  centre: { ra: number; dec: number },
  extent: number,
): { left: number; top: number; inside: boolean; east: number; north: number } {
  const p = propagate(target.ra, target.dec, target.pmra, target.pmdec, target.epoch, mjdToYear(mjd));
  const { east, north } = offsetArcsec(p.ra, p.dec, centre.ra, centre.dec);
  const left = 0.5 - east / extent;
  const top = 0.5 - north / extent;
  return { left, top, inside: left > 0 && left < 1 && top > 0 && top < 1, east, north };
}

/** Image width (arcseconds) needed to show points at these offsets, with a margin; at most 600. */
export function widthToShow(offsets: Array<{ east: number; north: number }>, margin = 30): number {
  const reach = Math.max(0, ...offsets.flatMap((o) => [Math.abs(o.east), Math.abs(o.north)]));
  return Math.min(600, Math.ceil((2 * reach + margin) / 10) * 10);
}

/**
 * Width in pixels of a SPHEREx frame image for a view `size` arcseconds wide: the same rule as
 * `patch_pixels()` in backend/app/mock.py (8 to 96 pixels, always odd, so the target sits on a
 * pixel centre). Python rounds exact halves to even; that differs only at sizes of exactly n.5 pixels.
 */
export function framePixels(size: number, pixelScale: number): number {
  const width = Math.min(96, Math.max(8, Math.round(size / pixelScale)));
  return Math.min(95, width | 1);
}

/** The SPHEREx range that goes with each WISE band by default (issue #7: W2 with 4.4 to 5.0). */
export const SUGGESTED_SPHEREX_RANGE: Readonly<Record<string, readonly [number, number] | undefined>> = {
  W2: [4.4, 5.0],
};

/** Whether a wavelength range (null ends are open) includes a wavelength. */
export function rangeIncludes(lo: number | null, hi: number | null, wavelength: number): boolean {
  return (lo === null || lo <= wavelength) && (hi === null || wavelength <= hi);
}
