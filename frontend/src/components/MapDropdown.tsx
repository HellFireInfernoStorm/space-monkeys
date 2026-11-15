import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

const HELP_WIDTH = 270;
const HELP_GAP = 12;
const EDGE = 8;

type HelpPlace = { side: "right" | "left"; width: number };

/**
 * Where the option explanations fit: beside the list on the side with more room inside the
 * sky map (and the window), narrowed if neither side has the full width.
 */
function placeHelp(list: HTMLElement): HelpPlace {
  const bounds = (list.closest(".sky-map") ?? document.documentElement).getBoundingClientRect();
  const right = Math.min(bounds.right, window.innerWidth) - EDGE;
  const left = Math.max(bounds.left, 0) + EDGE;
  const box = list.getBoundingClientRect();
  const roomRight = right - box.right - HELP_GAP;
  const roomLeft = box.left - left - HELP_GAP;
  const side = roomRight >= HELP_WIDTH || roomRight >= roomLeft ? "right" : "left";
  return { side, width: Math.max(140, Math.min(HELP_WIDTH, side === "right" ? roomRight : roomLeft)) };
}

export interface MapOption<T extends string> {
  value: T;
  label: string;
  help: string;
}

/** Small listbox so each option can expose its explanation on hover and keyboard focus. */
export default function MapDropdown<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: readonly MapOption<T>[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [help, setHelp] = useState<HelpPlace>({ side: "right", width: HELP_WIDTH });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = options.findIndex((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelectorAll<HTMLElement>('[role="option"]')[active]?.focus();
  }, [open, active]);

  useLayoutEffect(() => {
    if (open && list.current) setHelp(placeHelp(list.current));
  }, [open]);

  function close() { setOpen(false); trigger.current?.focus(); }
  function show(index = selected) { setActive(index); setOpen(true); }

  return (
    <div ref={root} className="map-dropdown" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button type="button" ref={trigger} aria-haspopup="listbox" aria-expanded={open}
        aria-controls={`${id}-list`} onClick={() => open ? close() : show()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); show();
          }
        }}>
        {label}: {options[selected].label} ▾
      </button>
      <span className="tooltip-anchor">
        <button type="button" className="info-button" aria-label={`About ${label.toLowerCase()}`}
          aria-describedby={`${id}-help`}>ⓘ</button>
        <span role="tooltip" id={`${id}-help`} className="tooltip">{options[selected].help}</span>
      </span>
      {open && (
        <ul ref={list} id={`${id}-list`} role="listbox" aria-label={label}
          className={`map-options${help.side === "left" ? " help-left" : ""}`}
          style={{ "--help-width": `${help.width}px` } as CSSProperties}
          onKeyDown={(event) => {
            const key = event.key;
            if (key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
            else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) {
              event.preventDefault();
              setActive(key === "Home" ? 0 : key === "End" ? options.length - 1
                : (active + (key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
            } else if (key === "Enter" || key === " ") {
              event.preventDefault(); onChange(options[active].value); close();
            } else if (key.length === 1) {
              const match = options.findIndex((option, index) => index > active && option.label.toLowerCase().startsWith(key.toLowerCase()));
              const first = options.findIndex((option) => option.label.toLowerCase().startsWith(key.toLowerCase()));
              if (match >= 0 || first >= 0) { event.preventDefault(); setActive(match >= 0 ? match : first); }
            }
          }}>
          {options.map((option, index) => (
            <li key={option.value} role="option" aria-selected={value === option.value}
              tabIndex={active === index ? 0 : -1} aria-describedby={`${id}-${index}-help`}
              onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)} onClick={() => { onChange(option.value); close(); }}>
              {option.label}
              <span role="tooltip" id={`${id}-${index}-help`} className="option-help">{option.help}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
