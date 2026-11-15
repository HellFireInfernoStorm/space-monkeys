import { useEffect, useRef, type ReactNode, type RefObject } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  trigger: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}

/** Native modal semantics provide focus containment and make the page behind it inert. */
export default function ControlsDrawer({ open, onClose, trigger, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) {
      element.close();
      trigger.current?.focus();
    }
  }, [open, trigger]);

  return (
    <dialog
      ref={dialog}
      id="controls-drawer"
      className="controls-drawer"
      aria-labelledby="controls-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        // Backdrop clicks target the dialog itself, but fall outside its rectangle.
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right ||
            event.clientY < box.top || event.clientY > box.bottom) onClose();
      }}
    >
      <div className="drawer-heading">
        <h2 id="controls-title">Controls</h2>
        <button type="button" autoFocus aria-label="Close controls" onClick={onClose}>✕</button>
      </div>
      {children}
    </dialog>
  );
}
