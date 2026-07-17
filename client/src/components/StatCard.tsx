import clsx from "clsx";
import type { ReactNode } from "react";

export interface StatDelta {
  /** Pre-formatted, e.g. "189%" — formatting stays caller-side. */
  text: string;
  direction: "up" | "down" | "flat";
  /** Picks the color, independent of direction — spend-up is bad, cache-hit-up is good. */
  sentiment: "good" | "bad" | "neutral";
}

export interface StatCardProps {
  label: string;
  value: string;
  accent?: "money" | "cache";
  delta?: StatDelta;
  sparkline?: number[];
  sub?: string;
}

// Matches --money/--cache from specs/pages/_chrome.css — same hex in both
// themes, since accent colors are brand colors, not neutral text.
const ACCENT_CLASS: Record<NonNullable<StatCardProps["accent"]>, string> = {
  money: "text-[#E8A33D]",
  cache: "text-[#4FC3D9]",
};

const GLYPH: Record<StatDelta["direction"], string> = { up: "▲", down: "▼", flat: "—" };
const DIRECTION_LABEL: Record<StatDelta["direction"], string> = {
  up: "increased",
  down: "decreased",
  flat: "unchanged",
};

// .delta.up is red, .delta.upgood is green — sentiment, not direction, picks
// the color (mockup evidence: spend-up is bad, cache-hit-up is good).
const SENTIMENT_CLASS: Record<StatDelta["sentiment"], string> = {
  good: "text-[#55B87A]",
  bad: "text-[#E05252]",
  neutral: "text-slate-500 dark:text-[#8B98A9]",
};

function DeltaLabel({ delta }: { delta: StatDelta }) {
  return (
    <span className={clsx("font-mono text-[11px]", SENTIMENT_CLASS[delta.sentiment])}>
      <span aria-hidden="true">{GLYPH[delta.direction]} </span>
      <span className="sr-only">{DIRECTION_LABEL[delta.direction]} </span>
      {delta.text}
    </span>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const finite = points.filter((p) => Number.isFinite(p));
  if (finite.length < 2) return null;

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const range = max - min || 1;
  const width = 100;
  const height = 22;
  const step = width / (finite.length - 1);

  const coords = finite
    .map((value, i) => {
      const x = i * step;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="mt-1 h-[22px] w-full"
    >
      <polyline
        points={coords}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="text-slate-400 dark:text-[#5A6675]"
      />
    </svg>
  );
}

export function StatCard({ label, value, accent, delta, sparkline, sub }: StatCardProps) {
  return (
    <div className="bg-white p-3.5 dark:bg-[#151A21]">
      <span
        title={label}
        className="block truncate text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-[#5A6675]"
      >
        {label}
      </span>
      <div className="mt-1 flex min-w-0 items-baseline gap-2">
        <span
          title={value}
          className={clsx(
            "truncate font-mono text-[22px] font-medium",
            accent ? ACCENT_CLASS[accent] : "text-slate-900 dark:text-[#E8EDF2]",
          )}
        >
          {value}
        </span>
        {delta ? <DeltaLabel delta={delta} /> : null}
      </div>
      {sub ? (
        <span className="mt-0.5 block font-mono text-[11px] text-slate-400 dark:text-[#5A6675]">
          {sub}
        </span>
      ) : null}
      {sparkline ? <Sparkline points={sparkline} /> : null}
    </div>
  );
}

export interface StatRowProps {
  children: ReactNode;
  columns?: number;
}

const COLUMN_CLASS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
  5: "md:grid-cols-5",
  6: "md:grid-cols-6",
};

export function StatRow({ children, columns = 4 }: StatRowProps) {
  return (
    <div
      className={clsx(
        "grid grid-cols-1 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 dark:border-[#232B36] dark:bg-[#232B36]",
        COLUMN_CLASS[columns] ?? COLUMN_CLASS[4],
      )}
    >
      {children}
    </div>
  );
}
