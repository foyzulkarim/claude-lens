import { useState } from "react";
import clsx from "clsx";
import { type FacetDimension, useFacets } from "./useFacets.js";
import { type FilterRange, type RangePreset, resolveRange } from "./state.js";
import { useFilters } from "./useFilters.js";

const PRESETS: { preset: RangePreset; label: string }[] = [
  { preset: "1d", label: "1D" },
  { preset: "7d", label: "7D" },
  { preset: "30d", label: "30D" },
  { preset: "90d", label: "90D" },
];

const CHIPS: { dim: FacetDimension; label: string }[] = [
  { dim: "project", label: "Project" },
  { dim: "model", label: "Model" },
  { dim: "branch", label: "Branch" },
  { dim: "host", label: "Host" },
];

const TOGGLE_CLASS =
  "rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-[#8A96A5] dark:hover:bg-[#151A21]";
const TOGGLE_ACTIVE_CLASS = "bg-slate-900 text-white dark:bg-[#E8EDF2] dark:text-[#0B0F14]";
const DATE_INPUT_CLASS =
  "rounded border border-slate-200 px-1 py-0.5 text-xs dark:border-[#232B36] dark:bg-[#0B0F14]";

function ChipDropdown({
  dim,
  label,
  selected,
  range,
  onChange,
}: {
  dim: FacetDimension;
  label: string;
  selected: string[];
  range: FilterRange;
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const { options, isPending, isError } = useFacets(dim, range, open);

  function toggleValue(value: string): void {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <details className="relative" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary
        className={clsx(
          "cursor-pointer select-none rounded border px-2 py-1 text-xs",
          selected.length > 0
            ? "border-slate-400 bg-slate-100 font-medium dark:border-[#3A4756] dark:bg-[#151A21]"
            : "border-slate-200 text-slate-600 dark:border-[#232B36] dark:text-[#8A96A5]",
        )}
      >
        {label}
        {selected.length > 0 ? ` (${selected.length})` : ""}
      </summary>
      <div className="absolute z-10 mt-1 min-w-40 rounded border border-slate-200 bg-white p-2 shadow-md dark:border-[#232B36] dark:bg-[#151A21]">
        {isPending && <p className="text-xs text-slate-400">Loading…</p>}
        {isError && <p className="text-xs text-red-500">Couldn't load options</p>}
        {!isPending && !isError && options.length === 0 && (
          <p className="text-xs text-slate-400">No values found</p>
        )}
        {options.map((option) => (
          <label key={option} className="flex items-center gap-2 py-0.5 text-xs">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={() => toggleValue(option)}
            />
            {option}
          </label>
        ))}
      </div>
    </details>
  );
}

// Global filter bar (plan #P3-3, pages spec §0): range presets/custom range
// plus project/model/branch/host chips. Mounted once in AppShell so it
// appears above every page; all state lives in the URL via useFilters (§11).
export function FilterBar() {
  const { filters, setChip, setRange } = useFilters();
  const range = filters.range;
  const activePreset = "preset" in range ? range.preset : null;
  const isCustom = activePreset === null;
  const customFrom = "from" in range ? range.from : "";
  const customTo = "from" in range ? range.to : "";

  function activateCustom(): void {
    if (isCustom) return;
    const resolved = resolveRange(range, new Date());
    setRange({ from: resolved.from.slice(0, 10), to: resolved.to.slice(0, 10) });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 dark:border-[#232B36] dark:bg-[#0B0F14]">
      <div className="flex items-center gap-1">
        {PRESETS.map(({ preset, label }) => (
          <button
            key={preset}
            type="button"
            onClick={() => setRange({ preset })}
            className={clsx(TOGGLE_CLASS, activePreset === preset && TOGGLE_ACTIVE_CLASS)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={activateCustom}
          className={clsx(TOGGLE_CLASS, isCustom && TOGGLE_ACTIVE_CLASS)}
        >
          Custom
        </button>
        {isCustom && (
          <>
            <input
              type="date"
              value={customFrom.slice(0, 10)}
              onChange={(e) => setRange({ from: e.target.value, to: customTo })}
              className={DATE_INPUT_CLASS}
            />
            <span className="text-xs text-slate-400">–</span>
            <input
              type="date"
              value={customTo.slice(0, 10)}
              onChange={(e) => setRange({ from: customFrom, to: e.target.value })}
              className={DATE_INPUT_CLASS}
            />
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        {CHIPS.map(({ dim, label }) => (
          <ChipDropdown
            key={dim}
            dim={dim}
            label={label}
            selected={filters[dim]}
            range={range}
            onChange={(values) => setChip(dim, values)}
          />
        ))}
      </div>
    </div>
  );
}
