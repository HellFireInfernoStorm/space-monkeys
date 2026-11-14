// Link to WiseView (http://byw.tools/wiseview), which shows WISE and NEOWISE images
// from 2010 onward at a position. We link out; we do not copy its images or code.

const WISEVIEW = "http://byw.tools/wiseview";

/** Address of WiseView centred on a position. `sizeArcsec` is the width of its image. */
export function wiseViewUrl(ra: number, dec: number, sizeArcsec = 176): string {
  const size = Math.round(Math.min(2000, Math.max(30, sizeArcsec)));
  return `${WISEVIEW}#ra=${ra.toFixed(6)}&dec=${dec.toFixed(6)}&size=${size}`;
}
