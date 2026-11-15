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
import ControlsDrawer from "./components/ControlsDrawer";
import SiteBrand from "./components/SiteBrand";
import PhotometryPanel from "./components/PhotometryPanel";
import WiseCompare, { type SpherexImage } from "./components/WiseCompare";
import StackView from "./components/StackView";
import TargetPicker from "./components/TargetPicker";
import ViewForm from "./components/ViewForm";
import { DEFAULT_SKY_CENTRE } from "./skyMaps";
import { applyChange, isNewView, parseView, serializeView, type ViewState } from "./urlState";
import { framePixels } from "./wiseCompare";
import { wiseViewUrl } from "./wiseview";
import { viewForTypedPosition } from "./targetView";

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
  const [skyVisited, setSkyVisited] = useState(() => view.tab === "sky");
  const [health, setHealth] = useState<Health | null>(null);
  const [bands, setBands] = useState<Band[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const [frames, setFrames] = useState<FramesState>({ status: "idle" });
  const [stack, setStack] = useState<StackResult | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const menuButton = useRef<HTMLButtonElement>(null);
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const [shownFrame, setShownFrame] = useState<Frame | null>(null);
  // Layer 3, phase 4: an exposure clicked on the spectrum tab, and whether the player had it.
  const [requestedFrame, setRequestedFrame] = useState<{ id: string; nonce: number } | null>(null);
  const [missingFrame, setMissingFrame] = useState<{ id: string; nonce: number; loaded: number } | null>(null);

  const update = useCallback((change: Partial<ViewState>) => {
    // A new position drops the measured point; a new sky map or range drops the cube frame.
    setView((previous) => applyChange(previous, change));
  }, []);
  const pick = useCallback((pra: number, pdec: number) => update({ phot: true, pra, pdec, tab: "spectrum" }), [update]);

  // Initialise WebGL only with a visible, sized container. Once opened, keep the map mounted.
  useEffect(() => {
    if (view.tab === "sky") setSkyVisited(true);
  }, [view.tab]);

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
  }, [ra, dec, size, wlmin, wlmax, pmra, pmdec, epoch, track, stackMode]);

  const mode = stackMode && stack ? stack.mode : frames.status === "ready" ? frames.data.mode : health?.mode;
  // Where the object is at the time of the observations, if the server has told us.
  // In blink mode, a moving object is where the frame on screen says it is.
  const frame = !stackMode && frames.status === "ready" ? shownFrame : null;
  // The SPHEREx image the WISE comparison (layer 4) uses: the fixed-grid stack in Stack mode, or
  // the frame on screen. With "follow the object" every frame has its own centre, so the middle
  // frame is used instead, to keep one WISE image.
  let compareImage: SpherexImage | null = null;
  if (stackMode && stack) {
    const image = stack.static ?? stack.tracked;
    if (image) {
      compareImage = {
        imageUrl: image.image_url,
        ra: stack.reference_ra,
        dec: stack.reference_dec,
        extent: stack.pixels * stack.pixel_scale,
        mjd: image.mjd_mid,
        label: `${image.n_exposures} exposures stacked on a fixed sky grid, ${image.wl_min_um.toFixed(2)} to ${image.wl_max_um.toFixed(2)} µm`,
      };
    }
  } else if (!stackMode && frames.status === "ready" && frames.data.frames.length > 0) {
    const list = frames.data.frames;
    const chosen = track ? list[Math.floor(list.length / 2)] : (shownFrame ?? list[0]);
    compareImage = {
      imageUrl: chosen.image_url,
      ra: chosen.center_ra,
      dec: chosen.center_dec,
      extent: framePixels(frames.data.size, frames.data.pixel_scale) * frames.data.pixel_scale,
      mjd: chosen.mjd,
      label: `one exposure, ${chosen.wavelength_um === null ? "wavelength unknown" : `${chosen.wavelength_um.toFixed(3)} µm`}`,
    };
  }

  const mapRa = stackMode && stack ? stack.reference_ra : frame ? frame.target_ra : frames.status === "ready" ? frames.data.ra : ra;
  const mapDec = stackMode && stack ? stack.reference_dec : frame ? frame.target_dec : frames.status === "ready" ? frames.data.dec : dec;

  return (
    <div className="page">
      <header className="top">
        <button type="button" ref={menuButton} className="menu-button"
          aria-label={drawerOpen ? "Hide controls" : "Show controls"}
          aria-expanded={drawerOpen} aria-controls="controls-drawer"
          onClick={() => setDrawerOpen((open) => !open)}>☰ <span>Controls</span></button>
        <h1><SiteBrand /></h1>
        <div className="view-summary">
          <span className="summary-position">{ra !== null && dec !== null
            ? `RA ${ra.toFixed(5)}°, Dec ${dec.toFixed(5)}°` : "No position yet"}</span>
          <span>{wlmin === null && wlmax === null ? "All wavelengths"
            : wlmin === null ? `≤ ${wlmax} µm` : wlmax === null ? `≥ ${wlmin} µm` : `${wlmin}–${wlmax} µm`}</span>
          {mode && (
            <span className={`badge badge-${mode}`} title="Which data the back end is serving">
              {mode === "mock" ? "Mock data (synthetic, not real sky)" : "Live data"}
            </span>
          )}
        </div>
      </header>

      <ControlsDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} trigger={menuButton}>
        <h2>Target</h2>
        <TargetPicker targets={targets} view={view} onPick={(change) => { update(change); setDrawerOpen(false); }} />
        <h2>Position and view</h2>
        <ViewForm
          key={serializeView({ ...view, speed: 2, mode: "blink", sky: "wise", frame: "ICRSd", tab: "sky", track: false })}
          view={view} bands={bands}
          onApply={(change) => {
            update(change);
            if ("ra" in change) setDrawerOpen(false);
          }}
        />
      </ControlsDrawer>

      {startError && <p className="notice error">{startError}</p>}

      <main className="layout">
        <section className="panel frames-panel">
          <h2>
            {stackMode
              ? view.name
                ? `${view.name}: stacked exposures`
                : "Stacked exposures"
              : view.name
                ? `${view.name}: frames over time`
                : "Frames over time"}
          </h2>
          {stackMode && ra !== null && dec !== null && (
            <StackView view={view} onChange={update} onResult={setStack} onPick={pick} />
          )}
          {frames.status === "idle" && (ra === null || dec === null) && (
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
              showMatches={view.matches}
              mode={view.mode}
              onChange={update}
              onFrame={setShownFrame}
              onPick={pick}
              requestedFrame={requestedFrame}
              onRequestResult={(request, found) => {
                setRequestedFrame(null);
                setMissingFrame(found ? null : { ...request, loaded: frames.data.frames.length });
              }}
            />
          )}
        </section>


        <section className="panel workbench-panel">
          <div className="workbench-tabs" role="tablist" aria-label="Sky and measurements">
            {(["sky", "spectrum"] as const).map((tab, index) => (
              <button type="button" key={tab} role="tab" id={`tab-${tab}`}
                ref={(element) => { tabButtons.current[index] = element; }}
                aria-controls={`panel-${tab}`} aria-selected={view.tab === tab}
                tabIndex={view.tab === tab ? 0 : -1}
                onClick={() => update({ tab })}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
                  update({ tab: next === 0 ? "sky" : "spectrum" });
                  tabButtons.current[next]?.focus();
                }}
              >{tab === "sky" ? "Sky map" : "Spectrum & light curve"}</button>
            ))}
          </div>
          <div id="panel-sky" role="tabpanel" aria-labelledby="tab-sky" hidden={view.tab !== "sky"}
            className="sky-tab" tabIndex={0}>
            {/* With no position yet the map still opens, on a starting place (DEFAULT_SKY_CENTRE). */}
            {skyVisited && (
              <AladinPanel ra={mapRa ?? DEFAULT_SKY_CENTRE.ra} dec={mapDec ?? DEFAULT_SKY_CENTRE.dec}
                centred={mapRa !== null && mapDec !== null}
                sky={view.sky} frame={view.frame}
                wlmin={wlmin} wlmax={wlmax} skyf={view.skyf}
                onChange={update}
                onPosition={(newRa, newDec) => update(viewForTypedPosition(view, newRa, newDec, {}))}
                wiseUrl={mapRa === null || mapDec === null ? null : wiseViewUrl(
                  ra !== null && dec !== null ? { ra, dec, pmra, pmdec, epoch } : { ra: mapRa, dec: mapDec },
                  Math.max(size, 176),
                )}
              />
            )}
          </div>
          <div id="panel-spectrum" role="tabpanel" aria-labelledby="tab-spectrum" hidden={view.tab !== "spectrum"}
            className="spectrum-tab" tabIndex={0}>
            {ra !== null && dec !== null ? view.phot ? (
              <PhotometryPanel view={view} onChange={update} bands={bands}
                currentFrame={frame ? { id: frame.exposure_id, mjd: frame.mjd } : null}
                missingFrame={missingFrame}
                onOpenFrame={(id) => {
                  setMissingFrame(null);
                  if (stackMode) update({ mode: "blink" });
                  setRequestedFrame({ id, nonce: Date.now() });
                }} />
            ) : (
              <>
                <p className="hint">Measure the brightness in every exposure: against wavelength for a spectrum,
                  against time for a light curve. Click a point in the frames, or measure the target itself.</p>
                <button type="button" className="primary" onClick={() => update({ phot: true })}>Measure this target</button>
              </>
            ) : <p className="hint">Pick a target or enter a position to measure its brightness.</p>}
          </div>
        </section>

        {ra !== null && dec !== null && (
          <section className="panel full-width">
            <h2>Then and now: WISE (2010) and SPHEREx</h2>
            {view.wise ? (
              <>
                <WiseCompare view={view} spherex={compareImage} onChange={update} />
                <button type="button" onClick={() => update({ wise: null })}>
                  Close
                </button>
              </>
            ) : (
              <>
                <p className="hint">
                  See the same patch of sky as WISE saw it in 2010, next to SPHEREx. Anything that moved since then is in
                  a different place.
                </p>
                <button type="button" className="primary" onClick={() => update({ wise: "W2" })}>
                  Compare with WISE (2010)
                </button>
              </>
            )}
          </section>
        )}
      </main>

      <footer className="foot">
        <p>{ACKNOWLEDGEMENT}</p>
        <p>This publication makes use of data products from the Wide-field Infrared Survey Explorer, which is a joint project of the University of California, Los Angeles, and the Jet Propulsion Laboratory/California Institute of Technology, and NEOWISE, which is a project of the Jet Propulsion Laboratory/California Institute of Technology. WISE and NEOWISE are funded by the National Aeronautics and Space Administration.</p>
        <p>
          Sky map: Aladin Lite, developed at CDS, Strasbourg Observatory, France. Sky map backgrounds: DSS, IRIS (IRAS),
          2MASS, SDSS, GALEX, Spitzer, Planck, AllWISE and SPHEREx HiPS maps (most made by CDS), served by IRSA. WISE comparison images:
          AllWISE Atlas, from the NASA/IPAC Infrared Science Archive. Further WISE images: WiseView.
        </p>
        <p>This project is not affiliated with or endorsed by NASA.</p>
      </footer>
    </div>
  );
}
