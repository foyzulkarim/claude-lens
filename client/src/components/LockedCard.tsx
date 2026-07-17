import type { ReactNode } from "react";
import { Link } from "wouter";

export interface LockedCardProps {
  title: string;
  message: string;
  ctaLabel?: string;
  ctaHref?: string;
  children?: ReactNode;
}

/** The 🔴-tier panel: a premium feature with no data source available yet.
 * Mockup `.locked`/`.veil` (specs/pages/_chrome.css:57-60) is dark-only, so
 * the light-theme veil is an explicit equivalent defined here. */
export function LockedCard({
  title,
  message,
  ctaLabel = "Set up cost capture →",
  ctaHref = "/settings",
  children,
}: LockedCardProps) {
  return (
    <div className="relative overflow-hidden rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">{title}</h2>
      {children ? (
        // `inert` (A3) removes the veiled ghost content from the tab order and
        // the accessibility tree — visually present but never focusable/announced,
        // so only the title, message, and CTA below are reachable.
        <div className="mt-3" inert>
          {children}
        </div>
      ) : null}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/75 backdrop-blur-[2px] dark:bg-[rgba(14,17,22,0.72)]">
        <p className="text-xs text-slate-500 dark:text-[#8B98A9]">{message}</p>
        <Link
          href={ctaHref}
          className="rounded border border-[#96631E]/70 px-3 py-1.5 text-xs text-[#96631E] dark:border-[#E8A33D]/40 dark:text-[#E8A33D]"
        >
          {ctaLabel}
        </Link>
      </div>
    </div>
  );
}
