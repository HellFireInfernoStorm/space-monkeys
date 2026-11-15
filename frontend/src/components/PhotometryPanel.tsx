import { useEffect, useState } from "react";

import { getPhotometry, type Band, type PhotometryResult } from "../api";
import {
  binCount,
  binPoints,
  bandStrips,
  linkLabel,
  mjdToDay,
  splitLinks,
  type PlotPoint,
  toPlotPoints,
  WAVELENGTH_GRADIENT,
  wavelengthColour,
} from "../photometry";
import Chart from "./Chart";
import type { ViewState } from "../urlState";

// The tool itself (docs/RESOURCES.md). It is a browser application: a plain HTTP request for
// this address answers 404, but it opens in a browser.
const SPECTROPHOTOMETRY_TOOL = "https://irsa.ipac.caltech.edu/applications/spherex/tool-spectrophotometry";

interface Props {
  bands: Band[];
  view: ViewState;
  onChange: (change: Partial<ViewState>) => void;
}

type State =
  | { status: "loading"; started: number }
  | { status: "ready"; data: PhotometryResult }
  | { status: "error"; message: string };

/** Layer 3: quick-look spectrum and light curve of one point. */
export default function PhotometryPanel({ view, onChange, bands }: Props) {
  const [state, setState] = useState<State>({ status: "loading", started: Date.now() });
  const [, setTick] = useState(0);
  const { ra, dec, pmra, pmdec, epoch, plx, wlmin, wlmax, pra, pdec } = view;
  const isPoint = pra !== null && pdec !== null;

  useEffect(() => {
    if (ra === null || dec === null) return;
    const abort = new AbortController();
    setState({ status: "loading", started: Date.now() });
    // A clicked point is a fixed spot on the sky; the target is followed along its motion.
    const query = isPoint
      ? { ra: pra, dec: pdec, pmra: 0, pmdec: 0, epoch: 2000, parallax: 0 }
      : { ra, dec, pmra, pmdec, epoch, parallax: plx };
    getPhotometry({ ...query, wl_min: wlmin, wl_max: wlmax }, abort.signal)
      .then((data) => setState({ status: "ready", data }))
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => abort.abort();
  }, [ra, dec, pmra, pmdec, epoch, plx, wlmin, wlmax, pra, pdec, isPoint]);

  useEffect(() => {
    if (state.status !== "loading") return;
    const timer = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(timer);
  }, [state.status]);

  const what = isPoint
    ? `the point RA ${pra.toFixed(5)}°, Dec ${pdec.toFixed(5)}° (a fixed spot on the sky)`
    : `${view.name || "the target"}${pmra || pmdec ? ", followed along its motion" : ""}`;

  return (
    <div className="phot">
      <div className="phot-heading"><p className="caption">
        Brightness of {what} in every exposure of the chosen wavelength range. Click an image to measure
        another point.
        {isPoint && (
          <>
            {" "}
            <button type="button" className="link" onClick={() => onChange({ pra: null, pdec: null })}>
              Back to the target
            </button>
          </>
        )}
      </p><button type="button" aria-label="Close" onClick={() => onChange({ phot: false, pra: null, pdec: null })}>✕</button></div>
      {state.status === "loading" && (
        <>
        <p className="hint" role="status">
          Measuring every exposure… {Math.round((Date.now() - state.started) / 1000)} s. The first request for a
          position can take about a minute; after that it is saved.
        </p>
        <div className="plots" aria-hidden="true"><div className="chart-placeholder" /><div className="chart-placeholder" /></div>
        </>
      )}
      {state.status === "error" && <p className="notice error">Could not measure: {state.message}</p>}
      {state.status === "ready" && <Body data={state.data} binned={view.bin} onChange={onChange} bands={bands} />}

    </div>
  );
}

function Body({
  data,
  binned,
  onChange,
  bands,
}: {
  bands: Band[];
  data: PhotometryResult;
  binned: boolean;
  onChange: (change: Partial<ViewState>) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string>();
  const warnings = (data.warnings ?? []).map((warning) => (
    <p key={warning} className="notice">
      {splitLinks(warning).map((part, i) =>
        part.href ? (
          <a key={i} href={part.href} target="_blank" rel="noreferrer">
            {linkLabel(part.href)}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  ));
  if (data.points.length === 0) {
    const searchFailed = (data.warnings ?? []).some((w) => w.includes("failed"));
    return (
      <>
        {warnings}
        <p className="notice">
          {searchFailed
            ? "Part of the archive search failed, so this may not be the full answer. Try again in a minute; failed searches are not saved."
            : "No exposures cover this point in this wavelength range."}
        </p>
      </>
    );
  }
  const spectrum = toPlotPoints(data.points, data.flux_unit, (p) => p.wavelength, { bandpass: true });
  const lightCurve = toPlotPoints(data.points, data.flux_unit, (p) => p.mjd);
  const wavelengths = data.points.map((p) => p.wavelength);
  const wlLo = Math.min(...wavelengths);
  const wlHi = Math.max(...wavelengths);
  const byWavelength = (p: PlotPoint) => wavelengthColour(p.wavelength ?? p.x, wlLo, wlHi);
  const measured = spectrum.filter((p) => p.y !== null).length;
  const unmeasured = spectrum.length - measured;
  const shown = binned ? [...binPoints(spectrum, binCount(measured)), ...spectrum.filter((p) => p.y === null)] : spectrum;

  return (
    <>
      {data.mode === "mock" && (
        <p className="notice">Mock mode: these numbers are synthetic, not measurements of the real sky.</p>
      )}
      {warnings}
      <div className="phot-summary"><p className="hint">
        {measured} of {data.returned} exposures measured
        {data.capped ? ` (${data.returned} of ${data.total} matching, spread evenly over time)` : ""}.
      </p><span className="ramp-legend">{wlLo.toFixed(2)} µm <span className="ramp" style={{ background: WAVELENGTH_GRADIENT }} /> {wlHi.toFixed(2)} µm</span></div>
      <div className="plots">
        <figure>
          <div className="chart-heading"><h3>Spectrum</h3><span>Brightness against wavelength</span>
            <label className="check inline"><input type="checkbox" checked={binned} onChange={(e) => { setHoveredId(undefined); onChange({ bin: e.target.checked }); }} />Bin</label>
          </div>
          <Chart key={String(binned)} points={shown} xLabel="Wavelength (µm)" yLabel="Flux (mJy)" xFormat={(x) => x.toFixed(2)}
            title={binned ? "Binned spectrum" : "Spectrum: flux against wavelength"} colour={byWavelength}
            tooltip={pointTooltip} highlightedId={binned ? undefined : hoveredId} onHighlight={setHoveredId}
            underlay={({ sx, x0, x1, plot }) => bandStrips(bands, x0, x1).map((band) => {
              const width = sx(band.right) - sx(band.left);
              return <g key={band.band} className="band-strip">
                <rect x={sx(band.left)} y={plot.top} width={width} height={plot.height} opacity={band.band % 2 ? 0.5 : 0.15} />
                {width >= 48 && <text x={sx(band.left) + width / 2} y={plot.top + 12} textAnchor="middle">Band {band.band}</text>}
              </g>;
            })} />
        </figure>
        <figure>
          <div className="chart-heading"><h3>Light curve</h3><span>Brightness against time</span></div>
          <Chart points={lightCurve} xLabel="Date (UTC)" yLabel="Flux (mJy)" xFormat={mjdToDay}
            title="Light curve: flux against time" colour={byWavelength} tooltip={pointTooltip}
            highlightedId={binned ? undefined : hoveredId} onHighlight={binned ? () => {} : setHoveredId} />
        </figure>
      </div>
      <p className="hint">
        Each exposure sees this point at a different wavelength, so in a wide wavelength range the light curve
        mixes colour with change. Narrow the range to compare like with like.
      </p>
      <details className="phot-method"><summary>How this is measured</summary>
      <p className="hint legend">
        <span className="key measured" /> measured, with ±1σ error bar (on the spectrum, the horizontal bar is
        the bandpass)
        {unmeasured > 0 && (
          <>
            {" "}
            <span className="key unmeasured" /> not measured ({unmeasured}): the aperture holds flagged or missing
            pixels, for example a saturated star core. No value is shown rather than a wrong one. Hover a point for
            its date, wavelength, value or reason.
          </>
        )}
      </p>
      <p className="hint">
        Quick estimates: aperture of 3 pixels (18.5″) radius, background from the median of a ring from 5 to 7.5
        pixels, error from the scatter in that ring. The error bars cover background noise only: for bright
        sources the scatter between exposures is larger (3.8% for a 0.14 Jy check star), so treat smaller changes
        as not significant. For precise values use IRSA's{" "}
        <a href={SPECTROPHOTOMETRY_TOOL} target="_blank" rel="noreferrer">
          SPHEREx Spectrophotometry Tool
        </a>
        .
      </p>
      </details>
    </>
  );
}


function pointTooltip(p: PlotPoint) {
  return <>
    {p.mjd !== undefined && <div>{mjdToDay(p.mjd)} · MJD {p.mjd.toFixed(2)}</div>}
    <div>{(p.wavelength ?? p.x).toFixed(3)}{p.bandpass !== undefined && ` ± ${p.bandpass.toFixed(3)}`} µm</div>
    {p.y !== null ? <div>{p.y.toPrecision(3)} ± {(p.err ?? 0).toPrecision(2)} mJy</div>
      : <div>Not measured: {p.reason ?? "flagged or missing pixels in the aperture"}</div>}
    {p.detector !== undefined && <div>Detector {p.detector}</div>}
    {p.id && <small>{p.id}</small>}
  </>;
}
