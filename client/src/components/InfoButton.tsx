import clsx from "clsx";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { InfoModal } from "./InfoModal.js";

export interface InfoButtonProps {
  /** Accessible name for the "?" trigger, e.g. "What does V1 check?". */
  label: string;
  /** Modal heading. */
  title: string;
  children: ReactNode;
  className?: string;
}

/**
 * Reusable "?" affordance — owns its own open state and renders the
 * trigger + `InfoModal` together so call sites don't each re-implement
 * open-state plumbing. Deliberately takes no Report-Card-specific props;
 * this is the piece meant to be reused on other pages later.
 */
export function InfoButton({ label, title, children, className }: InfoButtonProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Stable identity: InfoModal lists this in its effect deps, so a fresh
  // closure here would re-run that effect (and re-focus Close) on every
  // re-render of whatever renders this InfoButton while open.
  const handleClose = useCallback((): void => {
    setOpen(false);
    // WAI-ARIA dialog pattern: focus returns to the trigger on close.
    // `InfoModal` doesn't know what opened it, so this lives here.
    triggerRef.current?.focus();
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        className={clsx(
          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-400 text-[10px] font-semibold leading-none text-slate-500 hover:border-slate-600 hover:text-slate-900 dark:border-[#4A5568] dark:text-[#8A96A5] dark:hover:border-[#8A96A5] dark:hover:text-[#E8EDF2]",
          className,
        )}
      >
        ?
      </button>
      <InfoModal open={open} onClose={handleClose} title={title}>
        {children}
      </InfoModal>
    </>
  );
}
