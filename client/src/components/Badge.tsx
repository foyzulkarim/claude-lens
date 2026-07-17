import clsx from "clsx";
import type { ReactNode } from "react";

export type BadgeVariant = "neutral" | "pass" | "warn" | "fail" | "computed" | "premium";

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
}

// Matches `.badge` + `.badge.<variant>` from specs/pages/_chrome.css:37-42 —
// same hex values in both themes since these are semantic, not neutral text.
const VARIANT_CLASS: Record<BadgeVariant, string> = {
  neutral: "text-slate-500 border-slate-200 dark:text-[#8B98A9] dark:border-[#232B36]",
  pass: "text-[#55B87A] border-[#55B87A]/40",
  warn: "text-[#D9B44F] border-[#D9B44F]/40",
  fail: "text-[#E05252] border-[#E05252]/40",
  computed: "text-[#E8A33D] border-[#E8A33D]/35",
  premium: "text-[#4FC3D9] border-[#4FC3D9]/35",
};

export function Badge({ variant = "neutral", children }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px]",
        VARIANT_CLASS[variant],
      )}
    >
      {children}
    </span>
  );
}
