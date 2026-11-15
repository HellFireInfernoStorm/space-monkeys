import { useEffect, useId, useRef, useState } from "react";

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
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = options.findIndex((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelectorAll<HTMLElement>('[role="option"]')[active]?.focus();
  }, [open, active]);

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
        <ul id={`${id}-list`} role="listbox" aria-label={label} className="map-options"
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
              onFocus={() => setActive(index)} onClick={() => { onChange(option.value); close(); }}>
              {option.label}
              <span role="tooltip" id={`${id}-${index}-help`} className="option-help">{option.help}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
