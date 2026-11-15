import { useEffect, useState } from "react";

import { getPhotometry, type PhotometryResult } from "../api";
import {
  binCount,
  binPoints,
  extent,
  mjdToDay,
  type PlotPoint,
  ticks,
  toPlotPoints,
} from "../photometry";
import type { ViewState } from "../urlState";

// The address recorded in docs/RESOURCES.md: IRSA's SPHEREx page, which links the tool.
const SPECTROPHOTOMETRY_TOOL = "https://irsa.ipac.caltech.edu/Missions/spherex.html";

interface Props {
  view: ViewState;
  onChange: (change: Partial<ViewState>) => void;
}

type State =
  | { status: "loading"; started: number }
  | { status: "ready"; data: PhotometryResult }
  | { status: "error"; message: string };

const W = 360;
const H = 220;
const M = { left: 52, right: 12, top: 12, bottom: 40 };

/** A scatter plot with error bars. Unmeasured points are hollow rings on the bottom axis. */
function Plot({
  points,
  xLabel,
  xFormat,
  title,
}: {
  points: PlotPoint[];
  xLabel: string;
  xFormat: (x: number) => string;
  title: string;
}) {
  const measured = points.filter((p) => p.y !== null);
  const [x0, x1] = extent(points.map((p) => p.x));
  const [y0, y1] = extent(
    measured.flatMap((p) => [(p.y as number) - (p.err ?? 0), (p.y as number) + (p.err ?? 0)]),
  );
  const sx = (x: number) => M.left + ((x - x0) / (x1 - x0)) * (W - M.left - M.right);
  const sy = (y: number) => H - M.bottom - ((y - y0) / (y1 - y0)) * (H - M.top - M.bottom);
  const xTicks = ticks(x0, x1, 4);
  const yTicks = ticks(y0, y1, 5);
  const floor = H - M.bottom;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="plot" role="img" aria-label={title}>
      <title>{title}</title>
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} className="grid" />
          <text x={M.left - 6} y={sy(t) + 4} textAnchor="end" className="tick">
            {t}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={`x${t}`} x={sx(t)} y={floor + 16} textAnchor="middle" className="tick">
          {xFormat(t)}
        </text>
      ))}
      {y0 < 0 && y1 > 0 && <line x1={M.left} x2={W - M.right} y1={sy(0)} y2={sy(0)} className="zero" />}
      <line x1={M.left} x2={W - M.right} y1={floor} y2={floor} className="axis" />
      <line x1={M.left} x2={M.left} y1={M.top} y2={floor} className="axis" />
      <text x={(M.left + W - M.right) / 2} y={H - 6} textAnchor="middle" className="label">
        {xLabel}
      </text>
      <text x={12} y={(M.top + floor) / 2} textAnchor="middle" className="label" transform={`rotate(-90 12 ${(M.top + floor) / 2})`}>
        Flux (mJy)
      </text>
      {measured.map((p, i) => (
        <g key={`m${i}`} className="point">
          {p.err !== null && (
            <line x1={sx(p.x)} x2={sx(p.x)} y1={sy((p.y as number) - p.err)} y2={sy((p.y as number) + p.err)} />
          )}
          <circle cx={sx(p.x)} cy={sy(p.y as number)} r={2.6} />
        </g>
      ))}
      {points
        .filter((p) => p.y === null)
        .map((p, i) => (
          <circle key={`u${i}`} cx={sx(p.x)} cy={floor - 5} r={3} className="unmeasured" />
        ))}
    </svg>
  );
}

/** Layer 3: quick-look spectrum and light curve of one point. */
export default function PhotometryPanel({ view, onChange }: Props) {
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
      <p className="caption">
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
      </p>
      {state.status === "loading" && (
        <p className="hint" role="status">
          Measuring every exposure… {Math.round((Date.now() - state.started) / 1000)} s. The first request for a
          position can take about a minute; after that it is saved.
        </p>
      )}
      {state.status === "error" && <p className="notice error">Could not measure: {state.message}</p>}
      {state.status === "ready" && <Body data={state.data} binned={view.bin} onChange={onChange} />}
      <p className="hint">
        Quick estimates: aperture of 3 pixels (18.5″) radius, background from the median of a ring from 5 to 7.5
        pixels, error from the scatter in that ring. The error bars cover background noise only: for bright
        sources the scatter between exposures is larger (3.8% for a 0.14 Jy check star), so treat smaller changes
        as not significant. For precise values use IRSA's{" "}
        <a href={SPECTROPHOTOMETRY_TOOL} target="_blank" rel="noreferrer">
          SPHEREx Spectrophotometry Tool (from its SPHEREx page)
        </a>
        .
      </p>
    </div>
  );
}

function Body({
  data,
  binned,
  onChange,
}: {
  data: PhotometryResult;
  binned: boolean;
  onChange: (change: Partial<ViewState>) => void;
}) {
  if (data.points.length === 0) {
    return <p className="notice">No exposures cover this point in this wavelength range.</p>;
  }
  const spectrum = toPlotPoints(data.points, data.flux_unit, (p) => p.wavelength);
  const lightCurve = toPlotPoints(data.points, data.flux_unit, (p) => p.mjd);
  const measured = spectrum.filter((p) => p.y !== null).length;
  const unmeasured = spectrum.length - measured;
  const shown = binned ? binPoints(spectrum, binCount(measured)) : spectrum;
  const days = (x: number) => mjdToDay(x).slice(2);

  return (
    <>
      {data.mode === "mock" && (
        <p className="notice">Mock mode: these numbers are synthetic, not measurements of the real sky.</p>
      )}
      {(data.warnings ?? []).map((warning) => (
        <p key={warning} className="notice">
          {warning}
        </p>
      ))}
      <p className="hint">
        {measured} of {data.returned} exposures measured
        {data.capped ? ` (${data.returned} of ${data.total} matching, spread evenly over time)` : ""}.
      </p>
      <div className="plots">
        <figure>
          <Plot
            points={shown}
            xLabel="Wavelength (µm)"
            xFormat={(x) => x.toFixed(2)}
            title={binned ? "Binned spectrum" : "Spectrum: flux against wavelength"}
          />
          <figcaption>
            {binned ? "Binned spectrum (weighted average per wavelength bin)" : "Spectrum"}
            <label className="check inline">
              <input type="checkbox" checked={binned} onChange={(e) => onChange({ bin: e.target.checked })} />
              Bin
            </label>
          </figcaption>
        </figure>
        <figure>
          <Plot points={lightCurve} xLabel="Date (UTC, yy-mm-dd)" xFormat={days} title="Light curve: flux against time" />
          <figcaption>Light curve</figcaption>
        </figure>
      </div>
      <p className="hint legend">
        <span className="key measured" /> measured, with ±1σ error bar
        {unmeasured > 0 && (
          <>
            {" "}
            <span className="key unmeasured" /> not measured ({unmeasured}): the aperture holds flagged or missing
            pixels, for example a saturated star core. No value is shown rather than a wrong one.
          </>
        )}
      </p>
      <p className="hint">
        Each exposure sees this point at a different wavelength, so in a wide wavelength range the light curve
        mixes colour with change. Narrow the range to compare like with like.
      </p>
    </>
  );
}
