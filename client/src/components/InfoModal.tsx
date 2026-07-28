import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface InfoModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Dependency-free modal primitive — no dialog/portal library exists in this
 * codebase yet. Rendered via `createPortal` to `document.body` so it isn't
 * clipped by an ancestor's `overflow`/`transform`. `role="dialog"` +
 * `aria-modal` + `aria-labelledby` per the WAI-ARIA dialog pattern; Escape
 * and a backdrop click both close; Tab/Shift+Tab wrap focus inside the
 * panel. Restoring focus to the trigger on close is the caller's job
 * (`InfoButton` owns the trigger ref) — this component doesn't know what
 * opened it.
 */
export function InfoModal({ open, onClose, title, children }: InfoModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: click-outside backdrop, not a keyboard target — Escape is the keyboard equivalent (handled above)
    // biome-ignore lint/a11y/useKeyWithClickEvents: same — mouse-only affordance, Escape already closes
    <div
      data-testid="info-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 dark:bg-black/60"
      onClick={onClose}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only, not a user action */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-md border border-slate-200 bg-white p-4 shadow-lg dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
            {title}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-500 hover:text-slate-900 dark:text-[#8A96A5] dark:hover:text-[#E8EDF2]"
          >
            ✕
          </button>
        </div>
        <div className="text-xs leading-relaxed text-slate-700 dark:text-[#B8C3CC]">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
