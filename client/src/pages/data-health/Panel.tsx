import type { ReactNode } from "react";
import { SectionHeader } from "./SectionHeader.js";

export interface PanelProps {
  /** Section title — also seeds the auto-derived `aria-labelledby` id. */
  title: string;
  /** Optional one-line description rendered under the title. */
  description?: string;
  /** Right-aligned slot — typically a `<TierBadge>` or stat count. */
  right?: ReactNode;
  /** Override the auto-derived `aria-labelledby` id (rare — only for tests
   *  that pin a specific id). */
  headingId?: string;
  children: ReactNode;
}

/** Stable, kebab-case slug from a section title — used to derive the
 *  `aria-labelledby` id without callers having to hand-author one.
 *  Public so test fixtures can mirror it. */
export function panelHeadingId(title: string): string {
  return `data-health-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}-title`;
}

/**
 * The Data Health page's panel chrome — `<section>` + className +
 * `aria-labelledby` + `<SectionHeader>` (review X-1 + X-4).
 *
 * Centralizing the section element + className means:
 *   • every panel's accessible name resolves correctly (the previous
 *     hand-written `aria-labelledby` strings pointed at ids that never
 *     existed on the matching `<h2>`, so screen readers saw empty
 *     section labels)
 *   • future theme tweaks land in one place
 *   • `SectionHeader` doesn't have to know whether it's the section's
 *     primary heading
 *
 * The `<section>` keeps an `aria-labelledby` even after the fix so the
 * landmark's accessible name is always the visible heading — not a
 * silent fallback to the section's first text node.
 */
export function Panel({ title, description, right, headingId, children }: PanelProps) {
  const id = headingId ?? panelHeadingId(title);
  return (
    <section
      aria-labelledby={id}
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <SectionHeader title={title} right={right} description={description} headingId={id} />
      {children}
    </section>
  );
}
