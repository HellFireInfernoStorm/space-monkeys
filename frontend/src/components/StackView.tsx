import { useEffect, useState } from "react";

import { apiUrl, getStack, type StackImage, type StackResult } from "../api";
import { clickToSky } from "../photometry";
import { dayOf, differenceText, measuredText, predictedText, spotPercent, stackLabel } from "../stackView";
import { LIMITS, type ViewState } from "../urlState";
import ModeToggle from "./ModeToggle";

interface Props {
  view: ViewState;
  onChange: (change: Partial<ViewState>) => void;
  onResult: (result: StackResult | null) => void;
  /** Called with the sky position of a click on a fixed-grid image, for the spectrum panel. */
  onPick?: (ra: number, dec: number) => void;
}

type Pick = (e: React.MouseEvent<HTMLDivElement>) => void;

/** A click handler for an image on the fixed sky grid of `data`, or undefined without `onPick`. */
function fixedGridPick(data: StackResult, onPick?: (ra: number, dec: number) => void): Pick | undefined {
  if (!onPick) return undefined;
  return (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const { ra, dec } = clickToSky(
      (e.clientX - box.left) / box.width,
      (e.clientY - box.top) / box.height,
      data.reference_ra,
      data.reference_dec,
      data.pixels * data.pixel_scale,
    );
    onPick(ra, dec);
  };
}

const PICK_TITLE = "Click to see the spectrum and light curve of this point";

type State =
  | { status: "loading"; started: number }
  | { status: "ready"; data: StackResult }
  | { status: "error"; message: string };

const CAPTION =
  "Adding many exposures together averages the random noise down (by the square root of their " +
  "number) while a real object adds up, so things too faint for one exposure appear.";

/** One image with optional markers. Markers are given in stack pixels. */
function Panel({
  image,
  pixels,
  label,
  note,
  marker,
  onClick,
}: {
  image: StackImage;
  pixels: number;
  label: string;
  note?: string;
  marker?: { x: number; y: number };
  onClick?: Pick;
}) {
  return (
    <figure className="stack-panel">
      <div
        className={onClick ? "stage small pickable" : "stage small"}
        onClick={onClick}
        title={onClick ? PICK_TITLE : undefined}
      >
        <img src={apiUrl(image.image_url)} alt={label} className="frame shown" draggable={false} />
        {marker && <span className="reticle small" style={spotPercent(marker.x, marker.y, pixels)} />}
      </div>
      <figcaption>
        <strong>{label}</strong>
        {note && <span className="hint"> {note}</span>}
      </figcaption>
    </figure>
  );
}

function EpochBlink({ data, speed, onPick }: { data: StackResult; speed: number; onPick?: Pick }) {
  const epochs = data.epochs;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing || epochs.length < 2) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % epochs.length), 1000 / Math.min(speed, 4));
    return () => window.clearInterval(timer);
  }, [playing, speed, epochs.length]);

  if (epochs.length === 0) {
    return (
      <p className="hint">
        No visit has the 5 or more exposures needed for a separate stack, so there is no blink between visits.
      </p>
    );
  }
  const current = epochs[Math.min(index, epochs.length - 1)];
  const first = epochs[0];
  return (
    <div>
      <div
        className={onPick ? "stage pickable" : "stage"}
        aria-label={`Visit ${index + 1} of ${epochs.length}`}
        onClick={onPick}
        title={onPick ? PICK_TITLE : undefined}
      >
        {epochs.map((epoch, i) => (
          <img
            key={epoch.index}
            src={apiUrl(epoch.image_url)}
            alt={i === index ? `Stack of visit ${i + 1}, ${dayOf(epoch.mjd_mid)}` : ""}
            className={i === index ? "frame shown" : "frame"}
            draggable={false}
          />
        ))}
        {data.has_motion && (
          <span
            className="reticle ghost"
            style={spotPercent(first.target_x, first.target_y, data.pixels)}
            title="Predicted position at the first visit"
          />
        )}
        <span
          className="reticle"
          style={spotPercent(current.target_x, current.target_y, data.pixels)}
          title="Predicted position at this visit"
        />
        <span className="compass">N up, E left</span>
      </div>
      <dl className="facts">
        <div>
          <dt>Visit</dt>
          <dd>
            {index + 1} of {epochs.length}
          </dd>
        </div>
        <div>
          <dt>Dates (UTC)</dt>
          <dd>
            {dayOf(current.mjd_start)} to {dayOf(current.mjd_end)}
          </dd>
        </div>
        <div>
          <dt>Stacked</dt>
          <dd>{stackLabel(current)}</dd>
        </div>
      </dl>
      <div className="transport">
        <button type="button" className="primary" onClick={() => setPlaying((p) => !p)}>
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={epochs.length - 1}
          value={index}
          aria-label="Visit"
          onChange={(e) => {
            setPlaying(false);
            setIndex(Number(e.target.value));
          }}
        />
      </div>
    </div>
  );
}

function MotionTable({ data }: { data: StackResult }) {
  if (data.motion.length < 2) return null;
  return (
    <>
      <h3>Measured motion between visits</h3>
      <table className="motion">
        <thead>
          <tr>
            <th>Visit (middle date)</th>
            <th>Measured offset (± 1σ)</th>
            <th>Predicted from catalogue {data.parallax ? "motion and parallax" : "motion"}</th>
            <th>Measured minus predicted</th>
          </tr>
        </thead>
        <tbody>
          {data.motion.map((point) => (
            <tr key={point.index}>
              <td>
                {point.index + 1} ({dayOf(point.mjd_mid)})
              </td>
              <td>{measuredText(point)}</td>
              <td>{predictedText(point)}</td>
              <td>{differenceText(point)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        Offsets from the first visit where the object was measured, in arcseconds (one pixel is{" "}
        {data.pixel_scale}″). Measured: a Gaussian fitted to the object in the stack of each visit's
        exposures, each centred on the predicted position. Uncertainty (1σ): the spread of the fitted position
        when each visit is re-stacked from its own exposures drawn at random with repeats (a bootstrap), both
        visits combined.
        {data.parallax ? "" : " Parallax is not included; enter it to include it."}
      </p>
    </>
  );
}

/** Layer 2: one exposure beside the stack, the per-visit blink, and the fixed-grid stack. */
export default function StackView({ view, onChange, onResult, onPick }: Props) {
  const [state, setState] = useState<State>({ status: "loading", started: Date.now() });
  const [, setTick] = useState(0);
  const { ra, dec, size, wlmin, wlmax, pmra, pmdec, epoch, plx } = view;

  useEffect(() => {
    if (ra === null || dec === null) return;
    const abort = new AbortController();
    setState({ status: "loading", started: Date.now() });
    onResult(null);
    getStack({ ra, dec, size, wl_min: wlmin, wl_max: wlmax, pmra, pmdec, epoch, parallax: plx }, abort.signal)
      .then((data) => {
        setState({ status: "ready", data });
        onResult(data);
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => abort.abort();
  }, [ra, dec, size, wlmin, wlmax, pmra, pmdec, epoch, plx, onResult]);

  // Count the seconds while a cold stack is being made.
  useEffect(() => {
    if (state.status !== "loading") return;
    const timer = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(timer);
  }, [state.status]);

  return (
    <div className="player">
      <p className="caption">{CAPTION}</p>
      {state.status === "loading" && (
        <p className="hint" role="status">
          Stacking every exposure in this wavelength range… {Math.round((Date.now() - state.started) / 1000)} s.
          The first stack for a position can take about a minute; after that it is saved.
        </p>
      )}
      {state.status === "error" && <p className="notice error">Could not make the stack: {state.message}</p>}
      {state.status === "ready" && <StackBody data={state.data} speed={view.speed} onPick={onPick} />}
      <div className="transport">
        <label>
          Speed
          <input
            type="range"
            min={LIMITS.speed[0]}
            max={LIMITS.speed[1]}
            step={0.5}
            value={view.speed}
            onChange={(e) => onChange({ speed: Number(e.target.value) })}
          />
          <span className="value">{view.speed} per second</span>
        </label>
        <ModeToggle mode={view.mode} onChange={onChange} />
      </div>
    </div>
  );
}

function StackBody({
  data,
  speed,
  onPick,
}: {
  data: StackResult;
  speed: number;
  onPick?: (ra: number, dec: number) => void;
}) {
  const { single, tracked, static: fixed } = data;
  if (!tracked || !single) {
    return (
      <p className="notice">
        No exposures match this position and wavelength range, so there is nothing to stack. Try another range.
      </p>
    );
  }
  const centre = { x: data.pixels / 2, y: data.pixels / 2 };
  // Only images on the fixed sky grid map a click to one sky position. The single exposure and
  // the tracked stack follow the object, unless there is no motion (then tracked is the fixed grid).
  const pick = fixedGridPick(data, onPick);
  const range = `${tracked.wl_min_um.toFixed(2)} to ${tracked.wl_max_um.toFixed(2)} µm`;
  return (
    <>
      {(data.warnings ?? []).map((warning) => (
        <p key={warning} className="notice">
          {warning}
        </p>
      ))}
      {data.capped && (
        <p className="hint">
          Stacked {data.returned} of {data.total} matching exposures, spread evenly over time.
        </p>
      )}
      <div className="stack-row">
        <Panel
          image={single}
          pixels={data.pixels}
          label={stackLabel(single)}
          note={`${dayOf(single.mjd_mid)}, ${single.wl_min_um.toFixed(2)} µm (a typical one)`}
          marker={centre}
        />
        <Panel
          image={tracked}
          pixels={data.pixels}
          label={stackLabel(tracked)}
          note={
            data.has_motion
              ? `each shifted to follow the object; ${dayOf(tracked.mjd_start)} to ${dayOf(tracked.mjd_end)}, ${range}`
              : `no motion given, so following the object and a fixed sky grid are the same stack; ${range}`
          }
          marker={centre}
          onClick={data.has_motion ? undefined : pick}
        />
        {fixed && (
          <Panel
            image={fixed}
            pixels={data.pixels}
            label={`Fixed sky grid: ${fixed.n_exposures} exposures`}
            note="not shifted: stars are sharp, a moving object is smeared along its path"
            marker={{ x: fixed.target_x, y: fixed.target_y }}
            onClick={pick}
          />
        )}
      </div>
      <h3>One stack per visit</h3>
      <p className="hint">
        {data.has_motion
          ? "Each visit's exposures stacked on the same fixed sky grid. Stars stay put; the yellow marker is where the object should be at that visit, the grey one where it was at the first visit."
          : "Each visit's exposures stacked on the same sky grid, so brightness changes between visits show."}
      </p>
      <EpochBlink data={data} speed={speed} onPick={pick} />
      <MotionTable data={data} />
    </>
  );
}
