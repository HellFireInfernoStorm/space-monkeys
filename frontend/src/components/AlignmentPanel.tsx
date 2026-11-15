import { useEffect, useState } from "react";
import { type AlignmentResult, type Frame } from "../api";
import { alignmentLabel, alignmentSpot } from "../alignment";
import { alignmentFrameKey, createAlignmentRequest, emptyAlignmentRequest } from "../alignmentRequest";

interface Props {
  mode: "mock" | "live";
  frame: Frame;
  extent: number;
  showMatches: boolean;
  onMatches: (show: boolean) => void;
  onResult: (result: AlignmentResult | null) => void;
}

/** Explicit checks avoid querying catalogues on every automatic blink transition. */
export default function AlignmentPanel({ frame, extent, showMatches, onMatches, onResult, mode }: Props) {
  const [state, setState] = useState(emptyAlignmentRequest);
  const [request] = useState(() => createAlignmentRequest(setState));
  const key = alignmentFrameKey(frame);
  const result = state.key === key ? state.result : null;
  const loading = state.key === key && state.loading;
  const error = state.key === key ? state.error : "";
  useEffect(() => {
    request.select(key);
    return request.cancel;
  }, [key, request]);
  useEffect(() => onResult(result), [result, onResult]);

  const visible = (result?.matches ?? []).filter((match) => {
    const cat = alignmentSpot(match.catalogue_ra, match.catalogue_dec, frame, extent);
    const obs = alignmentSpot(match.measured_ra, match.measured_dec, frame, extent);
    return cat.inside && obs.inside;
  });
  return <section className="alignment-panel" aria-label="Sky alignment and plate solving">
    <strong>Sky alignment / Plate solving</strong>
    <p role="status">{loading ? "Checking star matches… archive coordinates remain active" :
      !result && mode === "mock" ? "Mock demonstration — not checked" : alignmentLabel(result)}</p>
    {!result && <p className="hint">We match stars in this image to known sky positions to check where it points.</p>}
    <button type="button" disabled={loading} onClick={() => request.run(frame)}>{loading ? "Checking…" : "Check this frame"}</button>
    <label className="alignment-toggle"><input type="checkbox" checked={showMatches}
      onChange={(e) => onMatches(e.target.checked)} /> Show star matches</label>
    {error && <p role="alert">{error}. Showing unverified archive coordinates.</p>}
    {result && <>
      {!result.quality_passed && <p>{result.reason}</p>}
      <p>{(result.matched ?? 0) - (result.rejected ?? 0)} consistent reference stars · {result.rejected} rejected
        {result.rms_arcsec != null && <> · RMS offset {result.rms_arcsec.toFixed(2)}″ ({result.rms_pixels?.toFixed(2)} pixels)</>}
      </p>
      <p className="hint">+ catalogue prediction · ○ detected star · line = offset at true scale · dashed = rejected match.
        Target reticle is a predicted moving object, excluded from the fit.</p>
      <p className="hint">{visible.length} matches in this crop (up to 20 shown); native check patch: {Math.round(result.field_arcsec)}″ per side before detector-edge clipping.</p>
      <details><summary>Star matches and alignment details</summary>
        <p>{result.catalogue} · MJD {result.mjd?.toFixed(5) ?? "unknown"} · {result.solver_version} · {result.elapsed_s?.toFixed(2)} s</p>
        {result.catalogue_url && <a href={result.catalogue_url} target="_blank" rel="noreferrer">Reference catalogue and credits</a>}
        <p>No correction applied. These are archive coordinates; the translation fit is diagnostic.</p>
        <p>Total offset is the catalogue-to-detection distance. Inclusion uses distance from the median offset, shown separately.</p>
        {result.offset_east_arcsec != null && <p>Detected minus catalogue: {result.offset_east_arcsec.toFixed(2)}″ east,
          {" "}{result.offset_north_arcsec?.toFixed(2)}″ north. Leave-one-out fit RMS: {result.fit_rms_arcsec?.toFixed(2)}″.</p>}
        <div className="alignment-table" tabIndex={0} role="region" aria-label="Scrollable reference-star table"
          onKeyDown={(event) => {
            const distance = 40;
            const steps: Record<string, [number, number]> = {
              ArrowLeft: [-distance, 0], ArrowRight: [distance, 0],
              ArrowUp: [0, -distance], ArrowDown: [0, distance],
              " ": [0, event.shiftKey ? -event.currentTarget.clientHeight : event.currentTarget.clientHeight],
            };
            const step = steps[event.key];
            if (!step || event.altKey || event.ctrlKey || event.metaKey) return;
            // Native document-level playback shortcuts must not consume table navigation.
            event.preventDefault();
            event.currentTarget.scrollBy({ left: step[0], top: step[1] });
          }}><table><caption>Independent reference-star matches (ICRS degrees)</caption>
          <thead><tr><th>Source</th><th>Catalogue RA, Dec</th><th>Detected RA, Dec</th><th>Total offset</th><th>From median</th><th>Fit</th></tr></thead>
          <tbody>{(result.matches ?? []).map((match) => <tr key={match.source_id}>
            <td>{match.source_id}</td><td>{match.catalogue_ra.toFixed(6)}, {match.catalogue_dec.toFixed(6)}</td>
            <td>{match.measured_ra.toFixed(6)}, {match.measured_dec.toFixed(6)}</td>
            <td>{(match.offset_arcsec ?? match.residual_arcsec).toFixed(2)}″</td>
            <td>{match.fit_residual_arcsec == null ? "Unknown" : `${match.fit_residual_arcsec.toFixed(2)}″`}</td>
            <td>{match.inlier ? "Included" : "Rejected"}</td>
          </tr>)}</tbody>
        </table></div>
      </details>
    </>}
    <p className="alignment-compass">↑ North · ← East · Width {extent.toFixed(1)}″ · Centre {frame.center_ra.toFixed(6)}°, {frame.center_dec.toFixed(6)}°</p>
  </section>;
}

export function MatchOverlay({ result, frame, extent }: { result: AlignmentResult; frame: Frame; extent: number }) {
  if (result.exposure_id !== frame.exposure_id || result.center_ra !== frame.center_ra ||
    result.center_dec !== frame.center_dec || result.target_ra !== frame.target_ra ||
    result.target_dec !== frame.target_dec) return null;
  return <svg className="match-overlay" viewBox="0 0 100 100" aria-hidden="true">
    {(result.matches ?? []).filter((match) => {
      return alignmentSpot(match.catalogue_ra, match.catalogue_dec, frame, extent).inside &&
        alignmentSpot(match.measured_ra, match.measured_dec, frame, extent).inside;
    }).filter((_, index, all) => index % Math.ceil(all.length / 20) === 0).map((match) => {
      const cat = alignmentSpot(match.catalogue_ra, match.catalogue_dec, frame, extent);
      const obs = alignmentSpot(match.measured_ra, match.measured_dec, frame, extent);
      if (!cat.inside || !obs.inside) return null;
      return <g key={match.source_id} className={match.inlier ? "" : "rejected"}>
        <line x1={cat.x} y1={cat.y} x2={obs.x} y2={obs.y} />
        <path d={`M ${cat.x-1.2} ${cat.y} h 2.4 M ${cat.x} ${cat.y-1.2} v 2.4`} />
        <circle cx={obs.x} cy={obs.y} r="1.7" />
      </g>;
    })}
  </svg>;
}
