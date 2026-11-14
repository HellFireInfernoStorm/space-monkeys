import { useState, type FormEvent } from "react";

import type { Band } from "../api";
import { LIMITS, type ViewState } from "../urlState";

interface Props {
  view: ViewState;
  bands: Band[];
  onApply: (change: Partial<ViewState>) => void;
}

const text = (value: number | null) => (value === null ? "" : String(value));

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
  const [ra, setRa] = useState(text(view.ra));
  const [dec, setDec] = useState(text(view.dec));
  const [size, setSize] = useState(text(view.size));
  const [wlmin, setWlmin] = useState(text(view.wlmin));
  const [wlmax, setWlmax] = useState(text(view.wlmax));
  const [pmra, setPmra] = useState(text(view.pmra));
  const [pmdec, setPmdec] = useState(text(view.pmdec));
  const [epoch, setEpoch] = useState(text(view.epoch));
  const [plx, setPlx] = useState(text(view.plx));
  const [problem, setProblem] = useState<string | null>(null);

  const band = bands.find((b) => String(b.wl_min_um) === wlmin && String(b.wl_max_um) === wlmax);
  const bandValue = band ? String(band.band) : wlmin === "" && wlmax === "" ? "all" : "custom";

  function chooseBand(value: string) {
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
    if (nRa === null || nDec === null || nRa < 0 || nRa > 360 || nDec < -90 || nDec > 90) {
      setProblem("Enter RA from 0 to 360 and Dec from -90 to 90, in decimal degrees.");
      return;
    }
    if (nSize === null || nSize < LIMITS.size[0] || nSize > LIMITS.size[1]) {
      setProblem(`Size must be from ${LIMITS.size[0]} to ${LIMITS.size[1]} arcseconds.`);
      return;
    }
    if (nEpoch === null || nEpoch < LIMITS.epoch[0] || nEpoch > LIMITS.epoch[1]) {
      setProblem(`Epoch must be a year from ${LIMITS.epoch[0]} to ${LIMITS.epoch[1]}.`);
      return;
    }
    const nPlx = numberOrNull(plx) ?? 0;
    if (nPlx < LIMITS.plx[0] || nPlx > LIMITS.plx[1]) {
      setProblem(`Parallax must be from ${LIMITS.plx[0]} to ${LIMITS.plx[1]} mas.`);
      return;
    }
    const nMin = numberOrNull(wlmin);
    const nMax = numberOrNull(wlmax);
    if (nMin !== null && nMax !== null && nMin >= nMax) {
      setProblem("The shortest wavelength must be below the longest.");
      return;
    }
    setProblem(null);
    const changed = nRa !== view.ra || nDec !== view.dec;
    onApply({
      ra: nRa,
      dec: nDec,
      size: nSize,
      wlmin: nMin,
      wlmax: nMax,
      pmra: numberOrNull(pmra) ?? 0,
      pmdec: numberOrNull(pmdec) ?? 0,
      epoch: nEpoch,
      plx: nPlx,
      // A hand-typed position is no longer the named target.
      name: changed ? "" : view.name,
    });
  }

  return (
    <form className="form" onSubmit={submit}>
      <label>
        RA (degrees)
        <input value={ra} onChange={(e) => setRa(e.target.value)} inputMode="decimal" />
      </label>
      <label>
        Dec (degrees)
        <input value={dec} onChange={(e) => setDec(e.target.value)} inputMode="decimal" />
      </label>
      <label>
        Image width (arcsec)
        <input value={size} onChange={(e) => setSize(e.target.value)} inputMode="decimal" />
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
          {bandValue === "custom" && <option value="custom">Custom range</option>}
        </select>
      </label>
      <label>
        Shortest wavelength (µm)
        <input value={wlmin} onChange={(e) => setWlmin(e.target.value)} inputMode="decimal" />
      </label>
      <label>
        Longest wavelength (µm)
        <input value={wlmax} onChange={(e) => setWlmax(e.target.value)} inputMode="decimal" />
      </label>
      <label>
        Motion in RA (mas/yr)
        <input value={pmra} onChange={(e) => setPmra(e.target.value)} inputMode="decimal" />
      </label>
      <label>
        Motion in Dec (mas/yr)
        <input value={pmdec} onChange={(e) => setPmdec(e.target.value)} inputMode="decimal" />
      </label>
      <label>
        Position is for year
        <input value={epoch} onChange={(e) => setEpoch(e.target.value)} inputMode="decimal" />
      </label>
      <label>
        Parallax (mas)
        <input value={plx} onChange={(e) => setPlx(e.target.value)} inputMode="decimal" />
      </label>
      <label className="check">
        <input type="checkbox" checked={view.track} onChange={(e) => onApply({ track: e.target.checked })} />
        Follow the object (re-centre every frame)
      </label>
      {problem && <p className="notice error wide">{problem}</p>}
      <button type="submit" className="primary wide">
        Show
      </button>
    </form>
  );
}
