import clsx from "clsx";
import type { ReactNode } from "react";

export type BadgeVariant = "neutral" | "pass" | "warn" | "fail" | "computed" | "premium";

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  /**
   * Optional `aria-label` for screen readers. The visible text is a
   * one- or two-character chip ("A", "F", "$1.23"); an explicit
   * `aria-label` lets callers provide a fuller announcement
   * (e.g. "Score: F, Gate status: fail") that screen readers will
   * read in place of the visible glyphs.
   */
  "aria-label"?: string;
}

// Matches `.badge` + `.badge.<variant>` from specs/pages/_chrome.css:37-42.
// The mockup's hex values are dark-theme contrast only (~2-3.8:1 on white);
// light theme uses a darker same-hue shade to clear WCAG AA 4.5:1 text /
// 3:1 boundary contrast, while dark theme keeps the mockup value verbatim.
const VARIANT_CLASS: Record<BadgeVariant, string> = {
  neutral: "text-slate-600 border-slate-400 dark:text-[#8B98A9] dark:border-[#232B36]",
  pass: "text-[#1E7F49] border-[#1E7F49]/70 dark:text-[#55B87A] dark:border-[#55B87A]/40",
  warn: "text-[#8A6D1B] border-[#8A6D1B]/70 dark:text-[#D9B44F] dark:border-[#D9B44F]/40",
  fail: "text-[#B23A3A] border-[#B23A3A]/70 dark:text-[#E05252] dark:border-[#E05252]/40",
  computed: "text-[#96631E] border-[#96631E]/60 dark:text-[#E8A33D] dark:border-[#E8A33D]/35",
  premium: "text-[#0E7A8C] border-[#0E7A8C]/60 dark:text-[#4FC3D9] dark:border-[#4FC3D9]/35",
};

export function Badge({ variant = "neutral", children, "aria-label": ariaLabel }: BadgeProps) {
  // `aria-label` is applied via `role="img"` so screen readers treat the
  // chip as a labelled graphic rather than reading the bare letter
  // (`#P4-12 review finding #23`). A bare `<span>` doesn't support
  // `aria-label` per the ARIA-in-HTML spec; pairing with `role="img"`
  // makes the aria-label valid. We always set `role="img"` for the
  // labelled branch and leave the no-label branch role-less.
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px]",
        VARIANT_CLASS[variant],
      )}
      {...(ariaLabel !== undefined ? { role: "img" as const, "aria-label": ariaLabel } : {})}
    >
      {children}
    </span>
  );
}
