// Storybook workbench smoke-test component — proves Tailwind + the dark/light
// toggle are wired correctly. Replaced by the real stat-card primitive (#P4-1).
export interface ExampleStatProps {
  label: string;
  value: string;
  accent?: "money" | "cache";
}

const ACCENT_CLASS: Record<NonNullable<ExampleStatProps["accent"]>, string> = {
  money: "text-amber-500 dark:text-amber-400",
  cache: "text-cyan-600 dark:text-cyan-400",
};

export function ExampleStat({ label, value, accent }: ExampleStatProps) {
  return (
    <div className="inline-flex flex-col gap-1 rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-[#5A6675]">
        {label}
      </span>
      <span
        className={`font-mono text-2xl font-medium text-slate-900 dark:text-[#E8EDF2] ${accent ? ACCENT_CLASS[accent] : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
