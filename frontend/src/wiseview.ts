// Link to WiseView (http://byw.tools/wiseview), which shows WISE and NEOWISE images
// from 2010 onward at a position. We link out; we do not copy its images or code.
//
// Link format, checked on 2026-11-14 against the page and its script (static/flash3.js,
// function fromUrl): parameters after "#", separated by "&": `ra` and `dec` in decimal
// degrees, `size` the field of view in arcseconds (the page caps it at 2000, default 176).
// The site answers on http only (https was refused on that date).

const WISEVIEW = "http://byw.tools/wiseview";

/**
 * Epoch (decimal year) the link's position is moved to: the middle of the WISE-era
 * images WiseView shows (AllWISE 2010 to 2011, NEOWISE 2014 onward). A fast star's
 * catalogue position for 2000 would be far off: WISE 0855 moves 8 arcseconds a year.
 */
export const WISE_EPOCH = 2014.0;

/** Straight-line proper motion, as `propagate()` in backend/app/targets.py. */
export function propagate(
  ra: number,
  dec: number,
  pmra: number,
  pmdec: number,
  epoch: number,
  year: number,
): { ra: number; dec: number } {
  const years = year - epoch;
  const cosDec = Math.max(Math.cos((dec * Math.PI) / 180), 1e-6);
  const newRa = (((ra + (pmra * years) / 3_600_000 / cosDec) % 360) + 360) % 360;
  const newDec = Math.max(-90, Math.min(90, dec + (pmdec * years) / 3_600_000));
  return { ra: newRa, dec: newDec };
}

export interface WiseViewTarget {
  ra: number;
  dec: number;
  pmra?: number;
  pmdec?: number;
  /** Decimal year of `ra` and `dec`. */
  epoch?: number;
}

/** Address of WiseView centred on a position, moved to WISE_EPOCH along its proper motion. */
export function wiseViewUrl(target: WiseViewTarget, sizeArcsec = 176): string {
  const { ra, dec, pmra = 0, pmdec = 0, epoch = WISE_EPOCH } = target;
  const at = pmra || pmdec ? propagate(ra, dec, pmra, pmdec, epoch, WISE_EPOCH) : { ra, dec };
  const size = Math.round(Math.min(2000, Math.max(30, sizeArcsec)));
  return `${WISEVIEW}#ra=${at.ra.toFixed(6)}&dec=${at.dec.toFixed(6)}&size=${size}`;
}
