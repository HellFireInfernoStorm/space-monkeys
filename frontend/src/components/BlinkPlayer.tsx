import { useEffect, useState } from "react";

import { type Frame, type FrameList } from "../api";
import { colourSpread, imageAddress, REFERENCE_LABEL } from "../blink";
import { LIMITS, type ViewMode, type ViewState } from "../urlState";
import ModeToggle from "./ModeToggle";

interface Props {
  list: FrameList;
  speed: number;
  mode: ViewMode;
  onChange: (change: Partial<ViewState>) => void;
  /** Called with the frame on screen, so the sky map can follow the object. */
  onFrame?: (frame: Frame | null) => void;
}

const MJD_OF_UNIX_EPOCH = 40587;

function dateOf(mjd: number): string {
  return new Date((mjd - MJD_OF_UNIX_EPOCH) * 86_400_000).toISOString().slice(0, 16).replace("T", " ");
}


/**
 * Where the target sits in a frame, as fractions of the image from the top-left corner.
 * Images are drawn north up, east to the left.
 */
function targetSpot(frame: Frame, extentArcsec: number): { left: number; top: number } {
  const cosDec = Math.cos((frame.center_dec * Math.PI) / 180);
  const east = (frame.target_ra - frame.center_ra) * cosDec * 3600;
  const north = (frame.target_dec - frame.center_dec) * 3600;
  return { left: 0.5 - east / extentArcsec, top: 0.5 - north / extentArcsec };
}

/** Shows the frames one after another (blink), or each one minus the first (difference). */
export default function BlinkPlayer({ list, speed, mode, onChange, onFrame }: Props) {
  const frames = list.frames;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const timer = window.setInterval(
      () => setIndex((i) => (i + 1) % frames.length),
      1000 / speed,
    );
    return () => window.clearInterval(timer);
  }, [playing, speed, frames.length]);

  const shown = frames[Math.min(index, frames.length - 1)] ?? null;
  useEffect(() => {
    onFrame?.(shown);
  }, [shown, onFrame]);

  if (frames.length === 0) {
    return (
      <p className="notice">
        No exposures match this position and wavelength range. Try "All bands" or another position.
      </p>
    );
  }

  const current = frames[Math.min(index, frames.length - 1)];
  const { shortest, longest, warn: mixedColours } = colourSpread(frames);

  // The server draws round(size / pixel_scale) pixels, limited to 8..96.
  const pixels = Math.min(96, Math.max(8, Math.round(list.size / list.pixel_scale)));
  const spot = targetSpot(current, pixels * list.pixel_scale);
  const spotVisible = spot.left > 0 && spot.left < 1 && spot.top > 0 && spot.top < 1;

  return (
    <div className="player">
      {list.capped && (
        <p className="hint">
          Showing {list.returned} of {list.total} exposures, spread evenly over time.
        </p>
      )}
      {(list.warnings ?? []).map((warning) => (
        <p key={warning} className="notice">
          {warning}
        </p>
      ))}
      {mixedColours && (
        <p className="notice">
          These frames run from {shortest.toFixed(2)} to {longest.toFixed(2)} µm. Each exposure sees
          this spot at a different wavelength, so most brightness differences here are colour, not
          change. Narrow the wavelength range to compare like with like.
        </p>
      )}

      <div className="stage" aria-label={`Frame ${index + 1} of ${frames.length}`}>
        {frames.map((frame, i) => (
          <img
            key={frame.exposure_id}
            src={imageAddress(frame, mode, frames[0])}
            alt={i === index ? `Sky image, ${dateOf(frame.mjd)} UTC` : ""}
            className={i === index ? "frame shown" : "frame"}
            draggable={false}
          />
        ))}
        {spotVisible && (
          <span
            className="reticle"
            style={{ left: `${spot.left * 100}%`, top: `${spot.top * 100}%` }}
            title="Predicted position of the target on this date"
          />
        )}
        {mode === "diff" && current.exposure_id === frames[0].exposure_id && (
          <span className="stage-label">{REFERENCE_LABEL}</span>
        )}
        <span className="compass">N up, E left</span>
      </div>

      <dl className="facts">
        <div>
          <dt>Frame</dt>
          <dd>
            {index + 1} of {frames.length}
          </dd>
        </div>
        <div>
          <dt>Date (UTC)</dt>
          <dd>{dateOf(current.mjd)}</dd>
        </div>
        <div>
          <dt>Wavelength</dt>
          <dd>{current.wavelength_um === null ? "unknown" : `${current.wavelength_um.toFixed(3)} µm`}</dd>
        </div>
        <div>
          <dt>Detector</dt>
          <dd>{current.detector}</dd>
        </div>
        <div>
          <dt>Release</dt>
          <dd>{current.collection}</dd>
        </div>
      </dl>

      <div className="transport">
        <button type="button" className="primary" onClick={() => setPlaying((p) => !p)}>
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={frames.length - 1}
          value={index}
          aria-label="Frame"
          onChange={(e) => {
            setPlaying(false);
            setIndex(Number(e.target.value));
          }}
        />
      </div>
      <div className="transport">
        <label>
          Speed
          <input
            type="range"
            min={LIMITS.speed[0]}
            max={LIMITS.speed[1]}
            step={0.5}
            value={speed}
            onChange={(e) => onChange({ speed: Number(e.target.value) })}
          />
          <span className="value">{speed} per second</span>
        </label>
        <ModeToggle mode={mode} onChange={onChange} />
      </div>
      <p className="hint mono">{current.exposure_id}</p>
    </div>
  );
}
