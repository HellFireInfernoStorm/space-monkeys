// Small pure helpers for the blink player, kept apart from the component so they can be tested.

import { apiUrl, type Frame } from "./api";
import type { ViewMode } from "./urlState";

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
