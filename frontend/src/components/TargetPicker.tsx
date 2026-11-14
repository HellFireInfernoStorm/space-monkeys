import type { Target } from "../api";
import type { ViewState } from "../urlState";

interface Props {
  targets: Target[];
  view: ViewState;
  onPick: (change: Partial<ViewState>) => void;
}

/** The built-in test targets. Picking one fills in its position, motion and epoch. */
export default function TargetPicker({ targets, view, onPick }: Props) {
  const active = targets.find((target) => target.name === view.name);
  return (
    <div>
      <div className="targets">
        {targets.map((target) => (
          <button
            key={target.id}
            type="button"
            className={target === active ? "chip active" : "chip"}
            onClick={() =>
              onPick({
                ra: target.ra,
                dec: target.dec,
                pmra: target.pmra,
                pmdec: target.pmdec,
                epoch: target.epoch,
                name: target.name,
              })
            }
          >
            {target.name}
          </button>
        ))}
      </div>
      {active && (
        <p className="hint">
          <strong>{active.kind}.</strong> {active.note}
        </p>
      )}
    </div>
  );
}
