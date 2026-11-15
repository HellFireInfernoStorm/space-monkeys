import { useEffect, useId, useRef, useState } from "react";

import { frameLabel, snapFrame, stepFrame, type CubeInfo } from "../hipsCube";

// Aladin Lite draws a new frame before its tiles arrive, so switching on every step of a
// drag flashes. While the value moves only the label changes; the frame follows once it rests.
const SETTLE_MS = 200;

const HELP = "This sky map is a stack of pictures, one per wavelength (colour) of infrared light. " +
  "Move the slider, or use the ‹ and › buttons, to change the wavelength shown. " +
  "Frames that hold no data are skipped. When you change the wavelength range, the map " +
  "jumps to the frame in the middle of it.";

/** Floating control at the bottom of the sky map for choosing the frame of a cube. */
export default function CubeSlider({ cube, frame, onCommit }: {
  cube: CubeInfo;
  /** The frame shown now, 0-based. */
  frame: number;
  onCommit: (frame: number) => void;
}) {
  const id = useId();
  const [pending, setPending] = useState(frame);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef({ frame, onCommit });
  latest.current = { frame, onCommit };

  useEffect(() => { setPending(frame); }, [frame]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function commit(next: number) {
    if (next !== latest.current.frame) latest.current.onCommit(next);
  }

  function commitNow(next: number) {
    window.clearTimeout(timer.current);
    setPending(next);
    commit(next);
  }

  function slide(value: number) {
    // The native range keys and drags move one step at a time; skip blank frames in that direction.
    const next = snapFrame(cube, value, value < pending ? -1 : 1);
    setPending(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => commit(next), SETTLE_MS);
  }

  const label = frameLabel(cube, pending);
  return (
    <div className="map-cube-slider" role="group" aria-label="Wavelength frame">
      <div className="cube-slider-label">
        <output id={`${id}-label`} aria-live="polite">{label}</output>
        <span className="tooltip-anchor">
          <button type="button" className="info-button" aria-label="About the wavelength slider"
            aria-describedby={`${id}-help`}>ⓘ</button>
          <span role="tooltip" id={`${id}-help`} className="tooltip">{HELP}</span>
        </span>
      </div>
      <div className="cube-slider-row">
        <button type="button" aria-label="Previous wavelength frame" disabled={stepFrame(cube, pending, -1) === pending}
          onClick={() => commitNow(stepFrame(cube, pending, -1))}>‹</button>
        <input type="range" min={0} max={cube.depth - 1} step={1} value={pending}
          aria-label="Wavelength frame" aria-valuetext={label}
          onChange={(event) => slide(Number(event.currentTarget.value))} />
        <button type="button" aria-label="Next wavelength frame" disabled={stepFrame(cube, pending, 1) === pending}
          onClick={() => commitNow(stepFrame(cube, pending, 1))}>›</button>
      </div>
    </div>
  );
}
