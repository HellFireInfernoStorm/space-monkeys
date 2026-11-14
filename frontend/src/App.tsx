import { useCallback, useEffect, useState } from "react";

import {
  ApiError,
  getBands,
  getExposures,
  getFrames,
  getHealth,
  getTargets,
  type Band,
  type ExposureList,
  type FrameList,
  type Health,
  type Target,
} from "./api";
import AladinPanel from "./components/AladinPanel";
import BlinkPlayer from "./components/BlinkPlayer";
import TargetPicker from "./components/TargetPicker";
import ViewForm from "./components/ViewForm";
import { parseView, serializeView, type ViewState } from "./urlState";
import { wiseViewUrl } from "./wiseview";

const ACKNOWLEDGEMENT =
  "This publication makes use of data products from the Spectro-Photometer for the History of the " +
  "Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet " +
  "Propulsion Laboratory and the California Institute of Technology, and is funded by the National " +
  "Aeronautics and Space Administration.";

type FramesState =
  | { status: "idle" }
  | { status: "loading" }
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

  const update = useCallback((change: Partial<ViewState>) => {
    setView((previous) => ({ ...previous, ...change }));
  }, []);

  // Keep the address bar in step with the view, so the link can always be copied.
  useEffect(() => {
    const query = serializeView(view);
    const address = window.location.pathname + (query ? "?" + query : "");
    if (address !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, "", address);
    }
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
  useEffect(() => {
    if (ra === null || dec === null) {
      setFrames({ status: "idle" });
      return;
    }
    const abort = new AbortController();
    const position = { ra, dec, pmra, pmdec, epoch };
    setFrames({ status: "loading" });
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
  }, [ra, dec, size, wlmin, wlmax, pmra, pmdec, epoch, track]);

  const mode = frames.status === "ready" ? frames.data.mode : health?.mode;
  // Where the object is at the time of the observations, if the server has told us.
  const mapRa = frames.status === "ready" ? frames.data.ra : ra;
  const mapDec = frames.status === "ready" ? frames.data.dec : dec;

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
        <section className="panel controls">
          <h2>Target</h2>
          <TargetPicker targets={targets} view={view} onPick={update} />
          <h2>Position and view</h2>
          <ViewForm
            key={serializeView({ ...view, speed: 2, mode: "blink", sky: "wise" })}
            view={view}
            bands={bands}
            onApply={update}
          />
        </section>

        <section className="panel">
          <h2>{view.name ? `${view.name}: frames over time` : "Frames over time"}</h2>
          {frames.status === "idle" && (
            <p className="hint">Pick a target or enter a position to see its exposures.</p>
          )}
          {frames.status === "loading" && <p className="hint">Loading frames…</p>}
          {frames.status === "error" && <p className="notice error">{frames.message}</p>}
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
            />
          )}
        </section>

        <section className="panel">
          <h2>Wider view</h2>
          {mapRa !== null && mapDec !== null ? (
            <>
              <AladinPanel ra={mapRa} dec={mapDec} sky={view.sky} onSky={(sky) => update({ sky })} />
              <p className="links">
                <a href={wiseViewUrl(mapRa, mapDec, Math.max(size, 176))} target="_blank" rel="noreferrer">
                  Compare with WISE images from 2010 onward in WiseView
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
