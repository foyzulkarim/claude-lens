import type { FilterState } from "../../filters/state.js";
import { TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import type { SessionsPageState } from "./state.js";

export interface SessionsFiltersProps {
  state: SessionsPageState;
  onStateChange: (patch: Partial<SessionsPageState>) => void;
  /** Resolved global filter range — reserved for a future "range-aware" cost-bound hint. */
  globalRange: FilterState["range"];
}

/**
 * Page-only filters for the Sessions page (ARCH A2). The global FilterBar
 * already owns project/model/branch/host; this component handles the
 * page-only dimensions (cost bounds, entrypoint, drilldown) and the
 * forward-compatible gate/tag seams.
 *
 * State changes go through the same `onStateChange` setter every other
 * Sessions section uses (owned by the page composition shell), keeping
 * one URL-commit implementation instead of duplicating it per section.
 */
export function SessionsFilters({ state, onStateChange }: SessionsFiltersProps) {
  return (
    <section
      data-testid="sessions-filters"
      aria-label="Sessions page filters"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Filters</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        <CostBoundsControl state={state} onChange={onStateChange} />
        <EntrypointControl state={state} onChange={onStateChange} />
        <DrilldownControl state={state} onChange={onStateChange} />
      </div>
      <p className="mt-3 text-xs text-slate-500 dark:text-[#8A96A5]">
        Gate status filter will appear when Report Card lands (#P4-12). Tag filtering is in the Tags
        section below.
      </p>
    </section>
  );
}

interface SessionsFiltersChildProps {
  state: SessionsPageState;
  onChange: (patch: Partial<SessionsPageState>) => void;
}

function CostBoundsControl({ state, onChange }: SessionsFiltersChildProps) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor="min-cost"
        className="text-xs uppercase tracking-wider text-slate-500 dark:text-[#8A96A5]"
      >
        Min cost ($)
      </label>
      <input
        id="min-cost"
        type="number"
        min={0}
        step={0.01}
        value={state.minCostComputed ?? ""}
        onChange={(e) => {
          const v = e.target.value === "" ? undefined : Number(e.target.value);
          if (v === undefined || (Number.isFinite(v) && v >= 0)) {
            onChange({ minCostComputed: v });
          }
        }}
        className="rounded border border-slate-200 px-2 py-1 text-sm dark:border-[#232B36] dark:bg-[#0B0F14]"
      />
      <label
        htmlFor="max-cost"
        className="mt-1 text-xs uppercase tracking-wider text-slate-500 dark:text-[#8A96A5]"
      >
        Max cost ($)
      </label>
      <input
        id="max-cost"
        type="number"
        min={0}
        step={0.01}
        value={state.maxCostComputed ?? ""}
        onChange={(e) => {
          const v = e.target.value === "" ? undefined : Number(e.target.value);
          if (v === undefined || (Number.isFinite(v) && v >= 0)) {
            onChange({ maxCostComputed: v });
          }
        }}
        className="rounded border border-slate-200 px-2 py-1 text-sm dark:border-[#232B36] dark:bg-[#0B0F14]"
      />
    </div>
  );
}

function EntrypointControl({ state, onChange }: SessionsFiltersChildProps) {
  const value = state.entrypoint?.join(",") ?? "";
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor="entrypoint"
        className="text-xs uppercase tracking-wider text-slate-500 dark:text-[#8A96A5]"
      >
        Entrypoint (CSV)
      </label>
      <input
        id="entrypoint"
        type="text"
        placeholder="cli,sdk"
        value={value}
        onChange={(e) => {
          const raw = e.target.value.trim();
          if (raw === "") {
            onChange({ entrypoint: undefined });
            return;
          }
          const items = raw
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          onChange({ entrypoint: items.length > 0 ? items : undefined });
        }}
        className="rounded border border-slate-200 px-2 py-1 text-sm dark:border-[#232B36] dark:bg-[#0B0F14]"
      />
    </div>
  );
}

function DrilldownControl({ state, onChange }: SessionsFiltersChildProps) {
  const value = state.hasDrilldown;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-slate-500 dark:text-[#8A96A5]">
        Has drilldown
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange({ hasDrilldown: undefined })}
          aria-pressed={value === undefined}
          className={TOGGLE_CLASS}
        >
          Any
        </button>
        <button
          type="button"
          onClick={() => onChange({ hasDrilldown: true })}
          aria-pressed={value === true}
          className={TOGGLE_CLASS}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onChange({ hasDrilldown: false })}
          aria-pressed={value === false}
          className={TOGGLE_CLASS}
        >
          No
        </button>
      </div>
    </div>
  );
}
