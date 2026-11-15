// Small pure helpers for the blink player, kept apart from the component so they can be tested.

import { apiUrl, type Frame } from "./api";
import type { ViewMode } from "./urlState";

/**
 * Warn about colour only when the longest wavelength among the frames is more than this
 * many times the shortest. Why 1.25: on the long-wavelength side of its peak a star's
 * brightness per unit frequency falls roughly as wavelength^-2 (Rayleigh-Jeans), so a
 * spread of 1.25 alone changes it by up to 1.25^2, about 1.6 times (0.5 magnitude). Below
 * that, colour is smaller than the changes the variable targets show (factors of 2 and
 * more) and a narrowed range such as 1.0 to 1.2 micrometres (1.2) is not flagged. A whole
 * band 1 to 5 (1.4 to 1.6) still is; band 6 (4.42 to 5.0, 1.13) is not.
 */
export const WAVELENGTH_SPREAD_WARNING = 1.25;

/** Shortest and longest wavelength at the target among the frames, and whether to warn. */
export function colourSpread(frames: Frame[]): { shortest: number; longest: number; warn: boolean } {
  const wavelengths = frames.map((f) => f.wavelength_um).filter((w): w is number => w !== null);
  if (wavelengths.length < 2) return { shortest: NaN, longest: NaN, warn: false };
  const shortest = Math.min(...wavelengths);
  const longest = Math.max(...wavelengths);
  return { shortest, longest, warn: longest / shortest > WAVELENGTH_SPREAD_WARNING };
}

export const REFERENCE_LABEL = "Reference frame: the others are shown minus this one";

/**
 * Address of a frame's picture. In difference mode every frame but the reference is shown
 * minus the reference; the reference itself is shown as a plain image (minus itself it
 * would be flat grey) and labelled with REFERENCE_LABEL.
 */
export function imageAddress(frame: Frame, mode: ViewMode, reference: Frame): string {
  const address = apiUrl(frame.image_url);
  return mode === "diff" && frame.exposure_id !== reference.exposure_id
    ? `${address}&diff_ref=${encodeURIComponent(reference.exposure_id)}`
    : address;
}

/** Native image width; mirrors backend/app/mock.py patch_pixels. */
export function framePixels(size: number, pixelScale: number): number {
  const width = Math.min(96, Math.max(8, Math.round(size / pixelScale)));
  return Math.min(95, width | 1);
}
