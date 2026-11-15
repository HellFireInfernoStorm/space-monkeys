import type { Target } from "../api";
import { viewForTarget } from "../targetView";
import type { ViewState } from "../urlState";

interface Props {
  targets: Target[];
  view: ViewState;
  onPick: (change: Partial<ViewState>) => void;
}

/**
 * The built-in test targets. Picking one fills in its position, motion and epoch, and for
 * its default wavelength range.
 */
export default function TargetPicker({ targets, view, onPick }: Props) {
  const active = targets.find((target) => target.name === view.name);
  return (
    <div>
      <label className="phone-target">
        <span className="sr-only">Target</span>
        <select value={active?.id ?? ""} onChange={(event) => {
          const target = targets.find((item) => item.id === event.target.value);
          if (target) onPick(viewForTarget(target));
        }}>
          <option value="" disabled>Choose a preset</option>
          {targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
        </select>
      </label>
      <div className="targets">
        {targets.map((target) => (
          <button
            key={target.id}
            type="button"
            className={target === active ? "chip active" : "chip"}
            aria-pressed={target === active}
            aria-label={target.name}
            onClick={() => onPick(viewForTarget(target))}
          >
            <span>{target.name}</span>
          </button>
        ))}
      </div>
      {active && (
        <details className="target-about"><summary>About this target</summary><p className="hint">
          <strong>{active.kind}.</strong>{" "}
          {active.note}
        </p></details>
      )}
    </div>
  );
}
