import clsx from "clsx";
import { TOGGLE_ACTIVE_CLASS } from "../ui/toggleStyles.js";

export interface ChipProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}

// Matches `.mchip` from specs/pages/_chrome.css:49.
const BASE_CLASS =
  "inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:border-[#232B36] dark:text-[#8B98A9]";

export function Chip({ label, active, onClick, onRemove }: ChipProps) {
  const className = clsx(BASE_CLASS, active && TOGGLE_ACTIVE_CLASS);

  return (
    <span className="inline-flex items-center gap-1">
      {onClick ? (
        <button type="button" onClick={onClick} aria-pressed={active} className={className}>
          {label}
        </button>
      ) : (
        <span className={className}>{label}</span>
      )}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="rounded px-1 text-[10px] text-slate-600 hover:text-slate-800 dark:text-[#5A6675] dark:hover:text-[#8A96A5]"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
