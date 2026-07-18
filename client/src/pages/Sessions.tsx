import { useCallback } from "react";
import { useSearch } from "wouter";
import { useFilters } from "../filters/useFilters.js";
import { useStableNow } from "./dashboard/useStableNow.js";
import { CostDistributionCard } from "./sessions/CostDistributionCard.js";
import { EfficiencyScatterCard } from "./sessions/EfficiencyScatterCard.js";
import { PromptSearchSlot } from "./sessions/PromptSearchSlot.js";
import { SessionBrowser } from "./sessions/SessionBrowser.js";
import { SessionCompare } from "./sessions/SessionCompare.js";
import { SessionsFilters } from "./sessions/SessionsFilters.js";
import {
  pageOwnedKeys,
  parseSessionsPageState,
  serializeSessionsPageState,
  type SessionsPageState,
} from "./sessions/state.js";

/**
 * Sessions page composition (ARCH-sessions-page.md T8). Renders the 8
 * binding spec sections in order, all driven by a single URL state parsed
 * from `useSearch()`. Each section owns its own query/loading/error state
 * (ARCH section-owned queries / API-failure scenario) — one section's
 * outage doesn't unmount successful siblings.
 */
export function Sessions() {
  const search = useSearch();
  const { filters } = useFilters();
  const now = useStableNow();

  const state = parseSessionsPageState(search);

  // Centralized URL commit helper so every section writes its changes
  // through the same `window.history.pushState` + popstate dispatch (the
  // established FilterBar / ChartCard pattern). Delegates to the state
  // module's own parse/serialize round-trip (`pageOwnedKeys` +
  // `serializeSessionsPageState`) instead of a hand-duplicated copy of
  // that logic — the two drifting apart is exactly how a hidden field
  // (`includeTimeline`) could silently stop being wired through.
  const onStateChange = useCallback(
    (patch: Partial<SessionsPageState>) => {
      const merged: SessionsPageState = { ...state, ...patch };
      const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
      for (const key of pageOwnedKeys()) params.delete(key);

      const mergedSearch = serializeSessionsPageState(merged);
      if (mergedSearch) {
        for (const [k, v] of new URLSearchParams(mergedSearch)) params.set(k, v);
      }

      const next = params.toString();
      window.history.pushState({}, "", next ? `?${next}` : window.location.pathname);
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
    [search, state],
  );

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-[#E8EDF2]">Sessions</h1>

      {/* 1. Prompt search seam (ARCH R8) — placeholder for #P4-3. */}
      <PromptSearchSlot />

      {/* 2. Sessions filters (cost / entrypoint / drilldown). */}
      <SessionsFilters state={state} onStateChange={onStateChange} globalRange={filters.range} />

      {/* 3. Sessions table (sortable, tier-dependent columns, paging, drill). */}
      <SessionBrowser state={state} onStateChange={onStateChange} now={now} />

      {/* 4. Timeline/Gantt toggle uses the same response (ARCH R4) — toggling
          view is handled inside SessionBrowser, no separate query. */}

      {/* 5. Efficiency scatter (any-measure × any-measure, regression). */}
      <EfficiencyScatterCard state={state} onStateChange={onStateChange} now={now} />

      {/* 6. Cost distribution (histogram + p50/p90/p99). */}
      <CostDistributionCard state={state} onStateChange={onStateChange} now={now} />

      {/* 7. Compare mode (2–3 sessions side-by-side). */}
      <SessionCompare state={state} onStateChange={onStateChange} now={now} />

      {/* 8. Tags seam — rendered as a stub section until #P4-15 lands. */}
      <TagsStub />
    </div>
  );
}

function TagsStub() {
  return (
    <section
      data-testid="tags-stub"
      aria-label="Tags"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Tags</h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-[#8A96A5]">
        Manual tags light up once the local-store settings page (#P4-15) lands — this section
        reserves the mount point so the binding spec order stays stable.
      </p>
    </section>
  );
}
