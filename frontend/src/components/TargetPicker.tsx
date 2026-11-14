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
        <p className="hint">
          <strong>{active.kind}.</strong>{" "}
          {active.id === "wise-0855"
            ? "Moves 8.1 arcseconds a year, so it is about two arcminutes from the 2010 position given in the challenge text. Too faint for a single exposure; it needs many exposures stacked at 4.4 to 5.0 micrometres, and tracking its motion sharpens the stack slightly."
            : active.note}
        </p>
      )}
    </div>
  );
}
