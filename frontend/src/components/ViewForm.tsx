import { useRef, useState, type FormEvent } from "react";

import type { Band } from "../api";
import { viewForTypedPosition } from "../targetView";
import { LIMITS, type ViewState } from "../urlState";

interface Props {
  view: ViewState;
  bands: Band[];
  onApply: (change: Partial<ViewState>) => void;
}

const text = (value: number | null) => (value === null ? "" : String(value));
const coordinateText = (value: number | null) => (value === null ? "" : String(Number(value.toFixed(7))));
type Field = "ra" | "dec" | "size" | "wlmin" | "wlmax" | "pmra" | "pmdec" | "epoch" | "plx";
type FormErrors = Partial<Record<Field, string>>;

function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Position, image size, wavelength range and motion: nothing changes until "Show" is pressed.
 * The "Follow the object" box is a view switch, not an input, so it applies at once.
 */
export default function ViewForm({ view, bands, onApply }: Props) {
  const [ra, setRa] = useState(coordinateText(view.ra));
  const [dec, setDec] = useState(coordinateText(view.dec));
  const [size, setSize] = useState(text(view.size));
  const [wlmin, setWlmin] = useState(text(view.wlmin));
  const [wlmax, setWlmax] = useState(text(view.wlmax));
  const [pmra, setPmra] = useState(text(view.pmra));
  const [pmdec, setPmdec] = useState(text(view.pmdec));
  const [epoch, setEpoch] = useState(text(view.epoch));
  const [plx, setPlx] = useState(text(view.plx));
  const [errors, setErrors] = useState<FormErrors>({});
  const advanced = useRef<HTMLDetailsElement>(null);

  const band = bands.find((b) => String(b.wl_min_um) === wlmin && String(b.wl_max_um) === wlmax);
  const [customBand, setCustomBand] = useState(false);
  const bandValue = customBand ? "custom" : band ? String(band.band) : wlmin === "" && wlmax === "" ? "all" : "custom";

  function chooseBand(value: string) {
    setCustomBand(value === "custom");
    if (value === "custom") {
      advanced.current?.querySelector<HTMLInputElement>("#field-wlmin")?.focus();
      return;
    }
    const chosen = bands.find((b) => String(b.band) === value);
    setWlmin(chosen ? String(chosen.wl_min_um) : "");
    setWlmax(chosen ? String(chosen.wl_max_um) : "");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const nRa = numberOrNull(ra);
    const nDec = numberOrNull(dec);
    const nSize = numberOrNull(size);
    const nEpoch = numberOrNull(epoch);
    const nMin = numberOrNull(wlmin);
    const nMax = numberOrNull(wlmax);
    const nPmra = numberOrNull(pmra);
    const nPmdec = numberOrNull(pmdec);
    const nPlx = numberOrNull(plx);
    const next: FormErrors = {};
    if (nRa === null || nRa < 0 || nRa > 360) next.ra = "Enter a number from 0 to 360°.";
    if (nDec === null || nDec < -90 || nDec > 90) next.dec = "Enter a number from −90 to 90°.";
    if (nSize === null || nSize < LIMITS.size[0] || nSize > LIMITS.size[1]) next.size = `Use ${LIMITS.size[0]} to ${LIMITS.size[1]} arcseconds.`;
    if (nEpoch === null || nEpoch < LIMITS.epoch[0] || nEpoch > LIMITS.epoch[1]) next.epoch = `Use a year from ${LIMITS.epoch[0]} to ${LIMITS.epoch[1]}.`;
    if (plx.trim() && (nPlx === null || nPlx < LIMITS.plx[0] || nPlx > LIMITS.plx[1])) next.plx = `Use ${LIMITS.plx[0]} to ${LIMITS.plx[1]} mas.`;
    if (wlmin.trim() && (nMin === null || nMin <= 0 || nMin > 100)) next.wlmin = "Enter a positive wavelength up to 100 µm.";
    if (wlmax.trim() && (nMax === null || nMax <= 0 || nMax > 100)) next.wlmax = "Enter a positive wavelength up to 100 µm.";
    if (!next.wlmin && !next.wlmax && nMin !== null && nMax !== null && nMin >= nMax) next.wlmax = "The longest wavelength must exceed the shortest.";
    if (pmra.trim() && (nPmra === null || Math.abs(nPmra) > 1e6)) next.pmra = "Enter motion between −1,000,000 and 1,000,000 mas/yr.";
    if (pmdec.trim() && (nPmdec === null || Math.abs(nPmdec) > 1e6)) next.pmdec = "Enter motion between −1,000,000 and 1,000,000 mas/yr.";
    setErrors(next);
    if (Object.keys(next).length > 0) {
      if (Object.keys(next).some((field) => field !== "ra" && field !== "dec")) {
        if (advanced.current) advanced.current.open = true;
      }
      const first = (Object.keys(next) as Field[])[0];
      window.requestAnimationFrame(() => document.getElementById(`field-${first}`)?.focus());
      return;
    }
    // Motion fields the user did not touch still hold the picked target's values.
    const typed: Partial<Pick<ViewState, "pmra" | "pmdec" | "plx" | "epoch">> = {};
    if (pmra !== text(view.pmra)) typed.pmra = nPmra ?? 0;
    if (pmdec !== text(view.pmdec)) typed.pmdec = nPmdec ?? 0;
    if (plx !== text(view.plx)) typed.plx = nPlx ?? 0;
    if (epoch !== text(view.epoch)) typed.epoch = nEpoch!;
    // A hand-typed position is no longer the picked target: its motion, parallax, epoch, name
    // and "follow the object" setting are dropped.
    onApply({
      ...viewForTypedPosition(
        view,
        ra === coordinateText(view.ra) ? view.ra! : nRa!,
        dec === coordinateText(view.dec) ? view.dec! : nDec!,
        typed,
      ),
      size: nSize!,
      wlmin: nMin,
      wlmax: nMax,
    });
  }

  return (
    <form
      className="form"
      onSubmit={submit}
      onChangeCapture={(event) => {
        const id = (event.target as HTMLElement).id;
        if (!id.startsWith("field-")) return;
        const field = id.slice(6) as Field;
        setErrors((current) => current[field] ? { ...current, [field]: undefined } : current);
      }}
    >
      <p className="form-intro">Use decimal degrees to visit any patch of sky.</p>
      <div className="form-primary">
      <label>
        Right ascension (RA) · degrees
        <input id="field-ra" value={ra} onChange={(e) => setRa(e.target.value)} inputMode="decimal" aria-invalid={!!errors.ra} aria-describedby={errors.ra ? "error-ra" : undefined} />
        {errors.ra && <span className="field-error" id="error-ra">{errors.ra}</span>}
      </label>
      <label>
        Declination (Dec) · degrees
        <input id="field-dec" value={dec} onChange={(e) => setDec(e.target.value)} inputMode="decimal" aria-invalid={!!errors.dec} aria-describedby={errors.dec ? "error-dec" : undefined} />
        {errors.dec && <span className="field-error" id="error-dec">{errors.dec}</span>}
      </label>
      </div>
      <details className="advanced" ref={advanced}>
        <summary>Wavelength, size &amp; motion</summary>
        <div className="form-advanced">
      <label>
        Image width (arcsec)
        <input id="field-size" value={size} onChange={(e) => setSize(e.target.value)} inputMode="decimal" aria-invalid={!!errors.size} aria-describedby={errors.size ? "error-size" : undefined} />
        {errors.size && <span className="field-error" id="error-size">{errors.size}</span>}
      </label>
      <label>
        Band
        <select value={bandValue} onChange={(e) => chooseBand(e.target.value)}>
          <option value="all">All bands</option>
          {bands.map((b) => (
            <option key={b.band} value={b.band}>
              Band {b.band} ({b.wl_min_um} to {b.wl_max_um} µm)
            </option>
          ))}
          <option value="custom">Custom range</option>
        </select>
      </label>
      <label>
        Shortest wavelength (µm)
        <input id="field-wlmin" value={wlmin} onChange={(e) => setWlmin(e.target.value)} inputMode="decimal" aria-invalid={!!errors.wlmin} aria-describedby={errors.wlmin ? "error-wlmin" : undefined} />
        {errors.wlmin && <span className="field-error" id="error-wlmin">{errors.wlmin}</span>}
      </label>
      <label>
        Longest wavelength (µm)
        <input id="field-wlmax" value={wlmax} onChange={(e) => setWlmax(e.target.value)} inputMode="decimal" aria-invalid={!!errors.wlmax} aria-describedby={errors.wlmax ? "error-wlmax" : undefined} />
        {errors.wlmax && <span className="field-error" id="error-wlmax">{errors.wlmax}</span>}
      </label>
      <label>
        Motion in RA (mas/yr)
        <input id="field-pmra" value={pmra} onChange={(e) => setPmra(e.target.value)} inputMode="decimal" aria-invalid={!!errors.pmra} aria-describedby={errors.pmra ? "error-pmra" : undefined} />
        {errors.pmra && <span className="field-error" id="error-pmra">{errors.pmra}</span>}
      </label>
      <label>
        Motion in Dec (mas/yr)
        <input id="field-pmdec" value={pmdec} onChange={(e) => setPmdec(e.target.value)} inputMode="decimal" aria-invalid={!!errors.pmdec} aria-describedby={errors.pmdec ? "error-pmdec" : undefined} />
        {errors.pmdec && <span className="field-error" id="error-pmdec">{errors.pmdec}</span>}
      </label>
      <label>
        Position is for year
        <input id="field-epoch" value={epoch} onChange={(e) => setEpoch(e.target.value)} inputMode="decimal" aria-invalid={!!errors.epoch} aria-describedby={errors.epoch ? "error-epoch" : undefined} />
        {errors.epoch && <span className="field-error" id="error-epoch">{errors.epoch}</span>}
      </label>
      <label>
        Parallax (mas)
        <input id="field-plx" value={plx} onChange={(e) => setPlx(e.target.value)} inputMode="decimal" aria-invalid={!!errors.plx} aria-describedby={errors.plx ? "error-plx" : undefined} />
        {errors.plx && <span className="field-error" id="error-plx">{errors.plx}</span>}
      </label>
      <label className="check">
        <input type="checkbox" checked={view.track} onChange={(e) => onApply({ track: e.target.checked })} />
        Follow the object (re-centre every frame)
      </label>
        </div>
      </details>
      <button type="submit" className="primary wide">
        Show sky
      </button>
    </form>
  );
}
