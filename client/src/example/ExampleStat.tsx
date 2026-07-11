import clsx from "clsx";

// Storybook workbench smoke-test component — proves Tailwind + the dark/light
// toggle are wired correctly. Replaced by the real stat-card primitive (#P4-1).
export interface ExampleStatProps {
  label: string;
  value: string;
  accent?: "money" | "cache";
}

// Matches --money/--cache from specs/pages/_chrome.css — same hex in both
// themes, since accent colors are brand colors, not neutral text.
const ACCENT_CLASS: Record<NonNullable<ExampleStatProps["accent"]>, string> = {
  money: "text-[#E8A33D]",
  cache: "text-[#4FC3D9]",
};

export function ExampleStat({ label, value, accent }: ExampleStatProps) {
  return (
    <div className="inline-flex flex-col gap-1 rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-[#5A6675]">
        {label}
      </span>
      <span
        className={clsx(
          "font-mono text-2xl font-medium",
          accent ? ACCENT_CLASS[accent] : "text-slate-900 dark:text-[#E8EDF2]",
        )}
      >
        {value}
      </span>
    </div>
  );
}
