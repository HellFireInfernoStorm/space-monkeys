import { useEffect, useMemo, useState } from "react";

import { getPhotometry, type Band, type PhotometryResult } from "../api";
import {
  CHART_HEIGHT,
  summarise, verdict, magnitudePoints, toAbMag, WISE_BANDS,
  binCount, binWidth, correctedPoints, visitMeans, changeVerdict, NOISE_FLOOR, SIGNAL_THRESHOLD, MIN_POINTS_PER_VISIT,
  APERTURE_RADIUS_PIXELS, BACKGROUND_RADII_PIXELS, PIXEL_SCALE_ARCSEC,
  pointDetails,
  selectChartPoint,
  type ChartSelections,
  type SelectionKind,
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
const CORRECTION_UNAVAILABLE = "Corrected view needs a clearer spectrum: at least 3 exposures where the binned spectrum reaches S/N 5.";
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
        <div className="plots" aria-hidden="true" style={{ "--chart-height": `${CHART_HEIGHT}px` } as React.CSSProperties}><div className="chart-placeholder" /><div className="chart-placeholder" /></div>
        </>
      )}
      {state.status === "error" && <p className="notice error">Could not measure: {state.message}</p>}
      {state.status === "ready" && <Body data={state.data} binned={view.bin} unit={view.unit} lc={view.lc} onChange={onChange} bands={bands} />}

    </div>
  );
}

function Body({
  data,
  binned,
  unit,
  lc,
  onChange,
  bands,
}: {
  bands: Band[];
  data: PhotometryResult;
  binned: boolean;
  unit: ViewState["unit"];
  lc: ViewState["lc"];
  onChange: (change: Partial<ViewState>) => void;
}) {
  const [selections, setSelections] = useState<ChartSelections>({});
  useEffect(() => setSelections({}), [data]);
  const selection = selections.pointer ?? selections.keyboard;
  const chartSelection = (chart: string) => ({
    selectedKey: selection?.chart === chart ? selection.key : undefined,
    highlightedId: selection?.key,
    onSelect: (kind: SelectionKind, key?: string) => setSelections((state) => selectChartPoint(state, chart, kind, key)),
  });
  const spectrum = useMemo(() => toPlotPoints(data.points, data.flux_unit, (p) => p.wavelength, { bandpass: true }), [data]);
  const summary = useMemo(() => summarise(spectrum), [spectrum]);
  const signal = verdict(summary, { mock: data.mode === "mock", warned: !!data.warnings?.length });
  const measured = summary.measured;
  const bins = summary.bins;
  const ab = unit === "ab";
  const displayedSpectrum = useMemo(() => ab ? magnitudePoints(spectrum) : spectrum, [spectrum, ab]);
  const displayedBins = useMemo(() => (ab ? magnitudePoints(bins) : bins).filter((p) => p.y !== null), [bins, ab]);
  // Flux-space light curve: the correction always divides fluxes, never magnitudes.
  const fluxCurve = useMemo(() => toPlotPoints(data.points, data.flux_unit, (p) => p.mjd), [data]);
  const lightCurve = useMemo(() => ab ? magnitudePoints(fluxCurve) : fluxCurve, [fluxCurve, ab]);
  const corrected = useMemo(
    () => correctedPoints(fluxCurve, bins, binWidth(spectrum, binCount(summary.snrMeasured))),
    [fluxCurve, bins, spectrum, summary.snrMeasured],
  );
  const visits = useMemo(() => visitMeans(corrected), [corrected]);
  // Offered only when the whole set has signal and enough exposures fall where the binned spectrum is clear.
  const correctable = summary.combinedSnr !== undefined && summary.combinedSnr >= SIGNAL_THRESHOLD
    && corrected.filter((p) => p.y !== null).length >= MIN_POINTS_PER_VISIT;
  const correctedY = useMemo(() => [1 - NOISE_FLOOR, 1 + NOISE_FLOOR, ...visits.flatMap((v) => [v.r - v.err, v.r + v.err])], [visits]);
  const showCorrected = correctable && lc === "rel";
  const change = changeVerdict(visits, { warned: !!data.warnings?.length, mock: data.mode === "mock", available: correctable });
  const meanMag = summary.mean && toAbMag(summary.mean.y, summary.mean.err);
  const meanText = !summary.mean ? "—" : ab
    ? meanMag ? `${meanMag.mag.toFixed(2)} ± ${meanMag.err.toFixed(2)} AB mag` : "—"
    : `${summary.mean.y.toPrecision(3)} ± ${summary.mean.err.toPrecision(2)} mJy`;
  const yLabel = ab ? "AB magnitude" : "Flux (mJy)";
  const laneLabel = ab ? "No magnitude" : "Not measured";
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
  const wlLo = summary.wlMin!;
  const wlHi = summary.wlMax!;
  const byWavelength = (p: PlotPoint) => wavelengthColour(p.wavelength ?? p.x, wlLo, wlHi);
  const unmeasured = spectrum.length - measured;

  return (
    <>
      {data.mode === "mock" && (
        <p className="notice">Mock mode: these numbers are synthetic, not measurements of the real sky.</p>
      )}
      {warnings}
      <div className="phot-tiles">
        <div className="phot-tile"><span>Measured</span><strong>{measured} of {data.returned}</strong><small>{data.capped ? `of ${data.returned} returned; ${data.total.toLocaleString("en-US")} match, spread evenly over time` : "exposures"}</small></div>
        <div className="phot-tile"><span>Wavelengths</span><strong>{wlLo.toFixed(2)}–{wlHi.toFixed(2)} µm</strong><small className="ramp-legend">{wlLo.toFixed(2)} µm <span className="ramp" style={{ background: WAVELENGTH_GRADIENT }} /> {wlHi.toFixed(2)} µm</small></div>
        <div className="phot-tile"><span>Dates</span><strong className="phot-dates">{summary.firstMjd === undefined ? "—" : mjdToDay(summary.firstMjd)} – {summary.lastMjd === undefined ? "—" : mjdToDay(summary.lastMjd)}</strong><small>{summary.visits.length} {summary.visits.length === 1 ? "visit" : "visits"}</small></div>
        {summary.mean && <div className="phot-tile"><span>Mean flux</span><strong>{meanText}</strong><small>weighted, whole range</small></div>}
        <div className="phot-tile"><span>Brightest at</span><strong>{summary.brightest === undefined ? "—" : `${summary.brightest.toFixed(2)} µm`}</strong><small>{summary.brightest === undefined ? "signal too weak" : "weighted bin"}</small></div>
        <div className={`phot-tile change-tile ${change.tone}`} title={`Changed? ${change.value}: ${change.detail}`}><span>Changed?</span><strong>{change.value}</strong><small>{change.detail}</small></div>
      </div>
      {summary.snrMeasured > 0 && summary.snrMeasured < measured && <p className="hint">Mean flux, combined and typical single-exposure S/N, Brightest at and the binned line use {summary.snrMeasured} of {measured} measured exposures with positive errors.</p>}
      <p className={`phot-verdict ${signal.tone}`}><span aria-hidden="true" />{signal.text}</p>
      <div className="plots">
        <figure>
          <div className="chart-heading"><h3>Spectrum</h3><span>Brightness against wavelength</span>
            <div className="phot-units">{(["mjy", "ab"] as const).map((value) => <button key={value} type="button" aria-pressed={unit === value} onClick={() => onChange({ unit: value })}>{value === "mjy" ? "mJy" : "AB mag"}</button>)}</div>
            <label className="check inline"><input type="checkbox" checked={binned} onChange={(e) => onChange({ bin: e.target.checked })} />Binned line</label>
          </div>
          <Chart {...chartSelection("spectrum")} points={displayedSpectrum} pointOpacity={binned ? 0.45 : 1} invertY={ab} laneLabel={laneLabel} xLabel="Wavelength (µm)" yLabel={yLabel} xFormat={(x) => x.toFixed(2)}
            title={ab ? "Spectrum: AB magnitude against wavelength" : "Spectrum: flux against wavelength"} colour={byWavelength}
            tooltip={pointTooltip}
            underlay={({ sx, x0, x1, plot }) => <>
              {bandStrips(bands, x0, x1).map((band) => {
                const width = sx(band.right) - sx(band.left);
                return <g key={band.band} className="band-strip">
                  <rect x={sx(band.left)} y={plot.top} width={width} height={plot.height} opacity={band.band % 2 ? 0.5 : 0.15} />
                  {width >= 48 && <text x={sx(band.left) + width / 2} y={plot.top + 12} textAnchor="middle">Band {band.band}</text>}
                </g>;
              })}
              {WISE_BANDS.filter((band) => band.wavelength >= x0 && band.wavelength <= x1).map((band) => {
                const x = sx(band.wavelength);
                const nearRight = x > plot.left + plot.width - 60;
                return <g key={band.name} className="wise-marker">
                  <line x1={x} x2={x} y1={plot.top} y2={plot.top + plot.height} />
                  <text x={x + (nearRight ? -4 : 4)} y={plot.top + 26} textAnchor={nearRight ? "end" : "start"}>{band.name}</text>
                </g>;
              })}
            </>}
            overlay={({ sx, sy }) => binned && <g className="binned-overlay">
              {displayedBins.length >= 2 && <>
                <path className="bin-band" d={`M${displayedBins.map((p) => `${sx(p.x)},${sy(p.y! + p.err!)}`).join(" L")} L${[...displayedBins].reverse().map((p) => `${sx(p.x)},${sy(p.y! - p.err!)}`).join(" L")} Z`} />
                <path className="bin-line" d={`M${displayedBins.map((p) => `${sx(p.x)},${sy(p.y!)}`).join(" L")}`} />
              </>}
              {displayedBins.map((p) => <circle key={p.x} cx={sx(p.x)} cy={sy(p.y!)} r={3.5} />)}
            </g>} />
        </figure>
        <figure>
          <div className="chart-heading"><h3>Light curve</h3><span>Brightness against time</span>
            <div className="phot-units">{(["raw", "rel"] as const).map((value) => <button key={value} type="button"
              aria-pressed={(showCorrected ? "rel" : "raw") === value} disabled={value === "rel" && !correctable}
              title={value === "rel" && !correctable ? CORRECTION_UNAVAILABLE : undefined}
              onClick={() => onChange({ lc: value })}>{value === "raw" ? "Raw" : "Corrected"}</button>)}</div>
          </div>
          {!correctable && <p className="hint">{CORRECTION_UNAVAILABLE}</p>}
          {showCorrected ? (
            <Chart {...chartSelection("lightCurve")} points={corrected} pointOpacity={0.4} extraY={correctedY} xLabel="Date (UTC)"
              yLabel="Relative to normal" xFormat={mjdToDay} title="Light curve: brightness relative to normal for each wavelength, against time"
              colour={byWavelength} tooltip={pointTooltip}
              underlay={({ sy, plot }) => <g className="noise-band">
                <rect x={plot.left} width={plot.width} y={sy(1 + NOISE_FLOOR)} height={sy(1 - NOISE_FLOOR) - sy(1 + NOISE_FLOOR)} />
                <line x1={plot.left} x2={plot.left + plot.width} y1={sy(1)} y2={sy(1)} />
                <text x={plot.left + plot.width - 4} y={Math.max(plot.top + 11, sy(1 + NOISE_FLOOR) - 4)} textAnchor="end">±3.8% scatter of a steady check star</text>
              </g>}
              overlay={({ sx, sy }) => <g className="visit-overlay" aria-hidden="true">
                {visits.map((v) => <g key={v.start} className={v.count < MIN_POINTS_PER_VISIT ? "few" : undefined}>
                  <line x1={sx(v.mjd)} x2={sx(v.mjd)} y1={sy(v.r - v.err)} y2={sy(v.r + v.err)} className="visit-error" />
                  <line x1={sx(v.mjd) - 5} x2={sx(v.mjd) + 5} y1={sy(v.r - v.err)} y2={sy(v.r - v.err)} className="visit-cap" />
                  <line x1={sx(v.mjd) - 5} x2={sx(v.mjd) + 5} y1={sy(v.r + v.err)} y2={sy(v.r + v.err)} className="visit-cap" />
                  <circle cx={sx(v.mjd)} cy={sy(v.r)} r={6} />
                </g>)}
              </g>} />
          ) : (
            <Chart {...chartSelection("lightCurve")} points={lightCurve} invertY={ab} laneLabel={laneLabel} xLabel="Date (UTC)" yLabel={yLabel} xFormat={mjdToDay}
              title={ab ? "Light curve: AB magnitude against time" : "Light curve: flux against time"} colour={byWavelength} tooltip={pointTooltip} />
          )}
        </figure>
      </div>
      <p className="hint">
        Each exposure sees this point at a different wavelength, so in a wide wavelength range the light curve
        mixes colour with change. Narrow the range to compare like with like.
      </p>
      {showCorrected && <p className="hint">Corrected: each exposure is divided by the binned spectrum at its wavelength, so colour is removed and 1.0 means usual brightness.</p>}
      <p className="hint error-caveat">The error bars cover background noise only: for bright sources the scatter between exposures is larger (3.8% for a 0.14 Jy check star), so treat smaller changes as not significant.</p>
      <details className="phot-method"><summary>How this is measured</summary>
      <ApertureDiagram />
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
        Quick estimates: aperture of {APERTURE_RADIUS_PIXELS} pixels ({(APERTURE_RADIUS_PIXELS * PIXEL_SCALE_ARCSEC).toFixed(1)}″) radius, background from the median of a ring from {BACKGROUND_RADII_PIXELS[0]} to {BACKGROUND_RADII_PIXELS[1]}{" "}
        pixels, error from the scatter in that ring. The error bars cover background noise only: for bright
        sources the scatter between exposures is larger (3.8% for a 0.14 Jy check star), so treat smaller changes
        as not significant. For precise values use IRSA's{" "}
        <a href={SPECTROPHOTOMETRY_TOOL} target="_blank" rel="noreferrer">
          SPHEREx Spectrophotometry Tool
        </a>
        .
      </p>
      <p className="hint">S/N here is the aperture flux divided by its background-noise error. It overstates the significance for bright sources (see the error-bar note).</p>
      <p className="hint">The binned line is the inverse-variance weighted mean of the points in equal-width wavelength bins, with its ±1σ error as the shaded band.</p>
      <p className="hint">AB magnitude = −2.5 log10(flux / 3631 Jy) (Oke &amp; Gunn 1983).</p>
      <p className="hint">Corrected light curve: each exposure's flux is divided by the binned spectrum at its wavelength (linear between bins, used only where the spectrum's S/N is at least 5). Exposures are grouped into visits more than 60 days apart and averaged with inverse-variance weights. Each visit's error includes the 3.8% exposure-to-exposure scatter of a steady check star, not reduced by averaging.</p>
      <p className="hint">Changed? compares the visit averages: a difference of at least 5 times the combined error is reported as a change. Not judged when the API warns about the aperture or the data. Now: {change.value}, {change.detail}.</p>
      </details>
    </>
  );
}


function pointTooltip(p: PlotPoint) {
  const details = pointDetails(p);
  return <>{Object.entries(details).map(([field, text]) => field === "exposure"
    ? <small key={field}>{text}</small> : <div key={field}>{text}</div>)}</>;
}

/** Labelled fallback, not an image of the sky; the full background ring remains visible. */
function ApertureDiagram() {
  const extentPixels = 2 * BACKGROUND_RADII_PIXELS[1] + 1;
  const extentArcsec = extentPixels * PIXEL_SCALE_ARCSEC;
  const scale = 120 / extentArcsec;
  const caption = `Diagram: aperture ${APERTURE_RADIUS_PIXELS} pixels (${(APERTURE_RADIUS_PIXELS * PIXEL_SCALE_ARCSEC).toFixed(1)}″), background ring ${BACKGROUND_RADII_PIXELS[0]} to ${BACKGROUND_RADII_PIXELS[1]} pixels.`;
  return <figure className="aperture-diagram">
    <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label={caption}>
      <rect width="120" height="120" fill="var(--panel)" />
      {Array.from({ length: extentPixels + 1 }, (_, i) => <g key={i} stroke="var(--line)">
        <line x1={i * 120 / extentPixels} x2={i * 120 / extentPixels} y1="0" y2="120" />
        <line y1={i * 120 / extentPixels} y2={i * 120 / extentPixels} x1="0" x2="120" />
      </g>)}
      <circle cx="60" cy="60" r={APERTURE_RADIUS_PIXELS * PIXEL_SCALE_ARCSEC * scale} fill="none" stroke="var(--accent)" />
      {BACKGROUND_RADII_PIXELS.map((radius) => <circle key={radius} cx="60" cy="60" r={radius * PIXEL_SCALE_ARCSEC * scale} fill="none" stroke="var(--muted)" strokeDasharray="3 3" />)}
    </svg>
    <figcaption>{caption}</figcaption>
  </figure>;
}
