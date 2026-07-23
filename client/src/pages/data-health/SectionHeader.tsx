import type { ReactNode } from "react";

export interface SectionHeaderProps {
  title: string;
  /** Free-form right-aligned text — typically a TierBadge or stat count. */
  right?: ReactNode;
  /** One-line description rendered below the title. */
  description?: string;
  /** id applied to the `<h2>` so the parent `<section>`'s
   *  `aria-labelledby` resolves to the visible heading. Always
   *  supplied by `<Panel>`; left undefined only for tests that
   *  render the header standalone. */
  headingId?: string;
}

/**
 * The Data Health page's section header — title on the left, tier or
 * count badge on the right, optional one-line description below. Used
 * identically by every section so the page has one visual rhythm.
 */
export function SectionHeader({ title, right, description, headingId }: SectionHeaderProps) {
  return (
    <div className="flex flex-col gap-1 pb-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
          {title}
        </h2>
        {right}
      </div>
      {description ? (
        <p className="text-xs text-slate-500 dark:text-[#8A95A3]">{description}</p>
      ) : null}
    </div>
  );
}
