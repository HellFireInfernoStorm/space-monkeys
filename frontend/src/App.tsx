import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  getBands,
  getExposures,
  getFrames,
  getHealth,
  getTargets,
  type Band,
  type ExposureList,
  type Frame,
  type FrameList,
  type Health,
  type StackResult,
  type Target,
} from "./api";
import AladinPanel from "./components/AladinPanel";
import BlinkPlayer from "./components/BlinkPlayer";
import ModeToggle from "./components/ModeToggle";
import StackView from "./components/StackView";
import TargetPicker from "./components/TargetPicker";
import ViewForm from "./components/ViewForm";
import { viewForTarget } from "./targetView";
import { isNewView, parseView, serializeView, type ViewState } from "./urlState";
import { WISE_EPOCH, wiseViewUrl } from "./wiseview";

const ACKNOWLEDGEMENT =
  "This publication makes use of data products from the Spectro-Photometer for the History of the " +
  "Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet " +
  "Propulsion Laboratory and the California Institute of Technology, and is funded by the National " +
  "Aeronautics and Space Administration.";

type FramesState =
  | { status: "idle" }
  | { status: "loading"; started: number }
  | { status: "ready"; data: FrameList }
  | { status: "not-built"; exposures: ExposureList | null; message: string }
  | { status: "error"; message: string };

export default function App() {
  const [view, setView] = useState<ViewState>(() => parseView(window.location.search));
  const [health, setHealth] = useState<Health | null>(null);
  const [bands, setBands] = useState<Band[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const [frames, setFrames] = useState<FramesState>({ status: "idle" });
  const [stack, setStack] = useState<StackResult | null>(null);
  const [shownFrame, setShownFrame] = useState<Frame | null>(null);
  const [frameAttempt, setFrameAttempt] = useState(0);

  const update = useCallback((change: Partial<ViewState>) => {
    setView((previous) => ({ ...previous, ...change }));
  }, []);

  // Keep the address bar in step with the view, so the link can always be copied.
  // A new target, position, range or mode is a new history entry, so Back returns to the
  // previous view; speed and the background survey only update the current entry.
  const shown = useRef(view);
  useEffect(() => {
    const query = serializeView(view);
    const address = window.location.pathname + (query ? "?" + query : "");
    if (address !== window.location.pathname + window.location.search) {
      if (isNewView(shown.current, view)) window.history.pushState(null, "", address);
      else window.history.replaceState(null, "", address);
    }
    shown.current = view;
  }, [view]);

  useEffect(() => {
    const onPop = () => setView(parseView(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    Promise.all([getHealth(abort.signal), getBands(abort.signal), getTargets(abort.signal)])
      .then(([h, b, t]) => {
        setHealth(h);
        setBands(b);
        setTargets(t);
        setStartError(null);
        if (window.location.search === "") {
          const barnard = t.find((target) => target.id === "barnard");
          if (barnard) {
            const initial = { ...parseView(""), ...viewForTarget(barnard) };
            window.history.replaceState(null, "", `${window.location.pathname}?${serializeView(initial)}`);
            setView(initial);
          }
        }
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        setStartError(
          "Cannot reach the back end. Start it with `python -m uvicorn app.main:app --port 8000` " +
            `inside backend/. (${error instanceof Error ? error.message : String(error)})`,
        );
      });
    return () => abort.abort();
  }, []);

  const { ra, dec, size, wlmin, wlmax, pmra, pmdec, epoch, track } = view;
  const stackMode = view.mode === "stack";
  useEffect(() => {
    if (ra === null || dec === null || stackMode) {
      setFrames({ status: "idle" });
      return;
    }
    const abort = new AbortController();
    const position = { ra, dec, pmra, pmdec, epoch };
    setFrames({ status: "loading", started: Date.now() });
    getFrames({ ...position, size, wl_min: wlmin, wl_max: wlmax, track }, abort.signal)
      .then((data) => setFrames({ status: "ready", data }))
      .catch(async (error: unknown) => {
        if (abort.signal.aborted) return;
        if (error instanceof ApiError && error.status === 501) {
          // Live images are not built yet. The live exposure search is, so show what it finds.
          const exposures = await getExposures(position, abort.signal).catch(() => null);
          if (!abort.signal.aborted) {
            setFrames({ status: "not-built", exposures, message: error.message });
          }
          return;
        }
        setFrames({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => abort.abort();
  }, [ra, dec, size, wlmin, wlmax, pmra, pmdec, epoch, track, stackMode, frameAttempt]);

  const mode = stackMode && stack ? stack.mode : frames.status === "ready" ? frames.data.mode : health?.mode;
  // Where the object is at the time of the observations, if the server has told us.
  // In blink mode, a moving object is where the frame on screen says it is.
  const frame = !stackMode && frames.status === "ready" ? shownFrame : null;
  const mapRa = stackMode && stack ? stack.reference_ra : frame ? frame.target_ra : frames.status === "ready" ? frames.data.ra : ra;
  const mapDec = stackMode && stack ? stack.reference_dec : frame ? frame.target_dec : frames.status === "ready" ? frames.data.dec : dec;

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>Sky Workbench</h1>
          <p className="tagline">
            Watch the infrared sky change: SPHEREx images over time for any position.
          </p>
        </div>
        {mode && (
          <span className={`badge badge-${mode}`} title="Which data the back end is serving">
            {mode === "mock" ? "Mock data (synthetic, not real sky)" : "Live data"}
          </span>
        )}
      </header>

      {startError && <p className="notice error">{startError}</p>}

      <main className="layout">
        <section className="panel target-panel" aria-labelledby="target-heading">
          <h2 id="target-heading">Choose a target</h2>
          <TargetPicker targets={targets} view={view} onPick={update} />
        </section>

        <section className="panel settings-panel" aria-labelledby="position-heading">
          <h2 id="position-heading">Or enter a sky position</h2>
          <ViewForm
            key={serializeView({ ...view, speed: 2, mode: "blink", sky: "wise", track: false })}
            view={view}
            bands={bands}
            onApply={update}
          />
          <div className="future-search">
            <label htmlFor="future-name">Search for a name</label>
            <input id="future-name" disabled placeholder="Coming soon" />
          </div>
        </section>

        <section className="panel viewer-panel" aria-labelledby="viewer-heading">
          <div className="viewer-heading-row">
            <div>
              <h2 id="viewer-heading">
                {stackMode
                  ? view.name
                    ? `${view.name}: stacked exposures`
                    : "Stacked exposures"
                  : view.name
                    ? `${view.name}: frames over time`
                    : "Frames over time"}
              </h2>
              {ra !== null && dec !== null && (
                <p className="viewer-position">
                  ICRS position: RA {ra.toFixed(5)}°, Dec {dec >= 0 ? "+" : ""}{dec.toFixed(5)}°
                </p>
              )}
            </div>
            <ModeToggle mode={view.mode} onChange={update} />
          </div>
          {stackMode && ra !== null && dec !== null && (
            <StackView view={view} onChange={update} onResult={setStack} />
          )}
          {frames.status === "idle" && (ra === null || dec === null) && (
            <p className="hint">Pick a target or enter a position to see its exposures.</p>
          )}
          {frames.status === "loading" && <LoadingStage started={frames.started} live={mode === "live"} />}
          {frames.status === "error" && (
            <div className="status-stage error-stage" role="alert">
              <div>
                <h3>Could not load these images</h3>
                <p>{frames.message}</p>
                <button type="button" className="primary" onClick={() => setFrameAttempt((attempt) => attempt + 1)}>Retry loading</button>
              </div>
            </div>
          )}
          {frames.status === "not-built" && (
            <div className="notice">
              <p>Image cut-outs from live data are not built yet ({frames.message}).</p>
              {frames.exposures && (
                <p>
                  The live archive search works: {frames.exposures.total} exposures cover this
                  position across {frames.exposures.collections.join(", ")}.
                </p>
              )}
            </div>
          )}
          {frames.status === "ready" && (
            <BlinkPlayer
              key={frames.data.frames.map((frame) => frame.exposure_id).join("|")}
              list={frames.data}
              speed={view.speed}
              mode={view.mode}
              onChange={update}
              onFrame={setShownFrame}
            />
          )}
        </section>

        <section className="panel map-panel" aria-labelledby="map-heading">
          <h2 id="map-heading">Wider sky view</h2>
          {mapRa !== null && mapDec !== null ? (
            <>
              <AladinPanel ra={mapRa} dec={mapDec} sky={view.sky} onSky={(sky) => update({ sky })} />
              <p className="links">
                <a
                  href={wiseViewUrl(
                    ra !== null && dec !== null ? { ra, dec, pmra, pmdec, epoch } : { ra: mapRa, dec: mapDec },
                    Math.max(size, 176),
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  Compare with WISE images from 2010 onward in WiseView (centred where the object was in{" "}
                  {WISE_EPOCH})
                </a>
              </p>
            </>
          ) : (
            <p className="hint">The sky map appears once a position is chosen.</p>
          )}
        </section>
      </main>

      <footer className="foot">
        <p>{ACKNOWLEDGEMENT}</p>
        <p>
          Sky map: Aladin Lite, developed at CDS, Strasbourg Observatory, France. WISE images in the
          linked comparison: WiseView.
        </p>
        <p>This project is not affiliated with or endorsed by NASA.</p>
      </footer>
    </div>
  );
}

function LoadingStage({ started, live }: { started: number; live: boolean }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="status-stage" role="status" aria-live="polite">
      <div>
        <h3>Loading sky images</h3>
        <p aria-hidden="true">{Math.round((Date.now() - started) / 1000)} seconds elapsed</p>
        {live && <p>The first request for a position can take 30 to 90 seconds.</p>}
      </div>
    </div>
  );
}
