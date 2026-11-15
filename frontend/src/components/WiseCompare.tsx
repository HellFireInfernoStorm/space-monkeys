import { useEffect, useState } from "react";

import { apiUrl, getWise, type WiseImage } from "../api";
import type { ViewState } from "../urlState";
import {
  type Motion,
  rangeIncludes,
  spotOnDate,
  SUGGESTED_SPHEREX_RANGE,
  widthToShow,
} from "../wiseCompare";

/** The SPHEREx image the WISE image is compared with: its address, field and date. */
export interface SpherexImage {
  imageUrl: string;
  ra: number;
  dec: number;
  /** Width on the sky, arcseconds. */
  extent: number;
  /** Date of the image (middle date for a stack), MJD. */
  mjd: number;
  label: string;
}

interface Props {
  view: ViewState;
  spherex: SpherexImage | null;
  onChange: (change: Partial<ViewState>) => void;
}

type State =
  | { status: "loading"; started: number }
  | { status: "ready"; data: WiseImage }
  | { status: "error"; message: string };

const day = (iso: string) => iso.slice(0, 10);
const MJD_OF_UNIX_EPOCH = 40587;
const mjdDay = (mjd: number) => new Date((mjd - MJD_OF_UNIX_EPOCH) * 86_400_000).toISOString().slice(0, 10);

function Markers({ spots }: { spots: Array<{ left: number; top: number; inside: boolean; ghost: boolean; title: string }> }) {
  return (
    <>
      {spots
        .filter((s) => s.inside)
        .map((s) => (
          <span
            key={s.title}
            className={s.ghost ? "reticle ghost" : "reticle"}
            style={{ left: `${s.left * 100}%`, top: `${s.top * 100}%` }}
            title={s.title}
          />
        ))}
    </>
  );
}

/** Layer 4: the WISE image (2010) of the same field as the SPHEREx image, side by side or blinking. */
export default function WiseCompare({ view, spherex, onChange }: Props) {
  const [state, setState] = useState<State>({ status: "loading", started: Date.now() });
  const [, setTick] = useState(0);
  const [showWise, setShowWise] = useState(false);
  const band = view.wise ?? "W2";
  const ra = spherex?.ra;
  const dec = spherex?.dec;
  const extent = spherex?.extent;

  useEffect(() => {
    if (ra === undefined || dec === undefined || extent === undefined) return;
    const abort = new AbortController();
    setState({ status: "loading", started: Date.now() });
    // The API takes 30 to 600 arcseconds; the SPHEREx images always lie in that range.
    const size = Math.min(600, Math.max(30, Math.round(extent * 10) / 10));
    getWise({ ra, dec, size, band }, abort.signal)
      .then((data) => setState({ status: "ready", data }))
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => abort.abort();
  }, [ra, dec, extent, band]);

  useEffect(() => {
    if (state.status !== "loading") return;
    const timer = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(timer);
  }, [state.status]);

  // Blink between the two images at the player's speed (at most 2 per second, so it can be read).
  useEffect(() => {
    if (view.cmp !== "blink") return;
    const timer = window.setInterval(() => setShowWise((w) => !w), 1000 / Math.min(view.speed, 2));
    return () => window.clearInterval(timer);
  }, [view.cmp, view.speed]);

  if (!spherex) {
    return <p className="hint">The comparison appears once the SPHEREx frames or stack have loaded.</p>;
  }

  const suggested = SUGGESTED_SPHEREX_RANGE[band];
  const wavelength = state.status === "ready" ? state.data.wavelength_um : band === "W2" ? 4.6 : 3.4;
  const matched = rangeIncludes(view.wlmin, view.wlmax, wavelength) && view.wlmin !== null && view.wlmax !== null;

  const moving = view.ra !== null && view.dec !== null && (view.pmra !== 0 || view.pmdec !== 0);
  const target: Motion | null = moving
    ? { ra: view.ra as number, dec: view.dec as number, pmra: view.pmra, pmdec: view.pmdec, epoch: view.epoch }
    : null;
  const centre = { ra: spherex.ra, dec: spherex.dec };
  const wiseMjd = state.status === "ready" ? state.data.mjd_mid : null;
  const now = target ? spotOnDate(target, spherex.mjd, centre, spherex.extent) : null;
  const then = target && wiseMjd !== null ? spotOnDate(target, wiseMjd, centre, spherex.extent) : null;
  const spots = [
    ...(now ? [{ ...now, ghost: false, title: `Predicted position on the SPHEREx date, ${mjdDay(spherex.mjd)}` }] : []),
    ...(then && wiseMjd !== null
      ? [{ ...then, ghost: true, title: `Predicted position on the WISE date, ${mjdDay(wiseMjd)}` }]
      : []),
  ];
  const needed = now && then && !(now.inside && then.inside) ? widthToShow([now, then]) : null;

  const wiseFigure =
    state.status === "ready" ? (
      <figure className="compare-panel">
        <div className="stage">
          <img src={apiUrl(state.data.image_url)} alt={`WISE ${band} image, ${day(state.data.date_mid)}`} className="frame shown" />
          <Markers spots={spots} />
          <span className="compass">N up, E left</span>
        </div>
        <figcaption>
          <strong>
            WISE {state.data.band} ({state.data.wavelength_um} µm), {day(state.data.date_start)} to {day(state.data.date_end)}
          </strong>
          <span className="hint">
            {" "}
            {state.data.survey}, tile {state.data.tile}, {state.data.pixel_scale}″ pixels
          </span>
        </figcaption>
      </figure>
    ) : null;
  const spherexFigure = (
    <figure className="compare-panel">
      <div className="stage">
        <img src={apiUrl(spherex.imageUrl)} alt={`SPHEREx image, ${mjdDay(spherex.mjd)}`} className="frame shown" />
        <Markers spots={spots} />
        <span className="compass">N up, E left</span>
      </div>
      <figcaption>
        <strong>SPHEREx, {mjdDay(spherex.mjd)}</strong>
        <span className="hint"> {spherex.label}, 6.15″ pixels</span>
      </figcaption>
    </figure>
  );

  return (
    <div className="compare">
      <div className="transport">
        <label>
          WISE band{" "}
          <select value={band} onChange={(e) => onChange({ wise: e.target.value as "W1" | "W2" })}>
            <option value="W1">W1 (3.4 µm)</option>
            <option value="W2">W2 (4.6 µm)</option>
          </select>
        </label>
        <div className="toggle" role="group" aria-label="How to compare">
          <button type="button" className={view.cmp === "side" ? "chip active" : "chip"} onClick={() => onChange({ cmp: "side" })}>
            Side by side
          </button>
          <button type="button" className={view.cmp === "blink" ? "chip active" : "chip"} onClick={() => onChange({ cmp: "blink" })}>
            Blink
          </button>
        </div>
      </div>
      {!matched && suggested && (
        <p className="notice">
          The SPHEREx image is not at the WISE {band} wavelength ({wavelength} µm), so stars can look different
          because of their colour.{" "}
          <button type="button" className="link" onClick={() => onChange({ wlmin: suggested[0], wlmax: suggested[1] })}>
            Use {suggested[0]} to {suggested[1]} µm
          </button>
        </p>
      )}
      {state.status === "loading" && (
        <p className="hint" role="status">
          Reading the WISE image… {Math.round((Date.now() - state.started) / 1000)} s. A first image of a field takes
          from a few seconds to a minute, depending on the field size and the connection; after that it is saved.
        </p>
      )}
      <p className="hint">Archive coordinates — this comparison has not been independently plate solved.</p>
      {state.status === "error" && <p className="notice error">Could not load the WISE image: {state.message}</p>}
      {state.status === "ready" &&
        (state.data.warnings ?? []).map((warning) => (
          <p key={warning} className="notice">
            {warning}
          </p>
        ))}
      {state.status === "ready" && state.data.mode === "mock" && (
        <p className="notice">Mock mode: this WISE image is synthetic, not the real sky.</p>
      )}
      {view.cmp === "blink" && state.status === "ready" ? (
        <div className="compare-row single">{showWise ? wiseFigure : spherexFigure}</div>
      ) : (
        <div className="compare-row">
          {spherexFigure}
          {wiseFigure}
        </div>
      )}
      {target && (
        <p className="hint">
          <span className="key-reticle" /> where the object should be on the SPHEREx date;{" "}
          <span className="key-reticle ghost" /> where it should have been on the WISE date, from its catalogue motion.
          {needed && (
            <>
              {" "}
              One of these positions is outside this {Math.round(spherex.extent)}″ field.{" "}
              <button type="button" className="link" onClick={() => onChange({ size: needed })}>
                Widen the view to {needed}″
              </button>{" "}
              to see both.
            </>
          )}
        </p>
      )}
      <p className="hint">
        The two images cover the same patch of sky, north up and east left, so stars that did not move are in the same
        place. The WISE image is sharper (1.375″ pixels, about 6″ resolution, against SPHEREx's 6.15″ pixels): that
        difference in sharpness is not a change in the sky. Anything that moved since 2010 is in a different place.
      </p>
    </div>
  );
}
