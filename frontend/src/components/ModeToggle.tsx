import type { ViewMode, ViewState } from "../urlState";

interface Props {
  mode: ViewMode;
  onChange: (change: Partial<ViewState>) => void;
}

const MODES: { mode: ViewMode; label: string; title: string }[] = [
  { mode: "blink", label: "Images", title: "The exposures one after another" },
  { mode: "diff", label: "Difference from first", title: "Each frame minus the first frame. Grey means no change." },
  {
    mode: "stack",
    label: "Stacked",
    title: "Many exposures added together, so faint objects appear",
  },
];

/** Switches between the blink player's two image types and the Stack view. */
export default function ModeToggle({ mode, onChange }: Props) {
  return (
    <div className="toggle" role="group" aria-label="View">
      {MODES.map((m) => (
        <button
          key={m.mode}
          type="button"
          className={mode === m.mode ? "chip active" : "chip"}
          onClick={() => onChange({ mode: m.mode })}
          title={m.title}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
