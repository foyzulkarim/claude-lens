import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "wouter";
import type { BiggestLeverView } from "../../../../shared/scorecard-contract.js";
import { getBiggestLever, type BiggestLeverParams } from "../../api/scorecard.js";
import { qk } from "../../api/queryKeys.js";
import { formatUnitValue } from "../../charts/units.js";
import { KIND_LABEL } from "../../content/scorecardGlossary.js";
import { resolveRange } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";
import { useStableNow } from "./useStableNow.js";

export interface BiggestLeverCardProps {
  /** Injection seam for stories/tests; defaults to the real current time. */
  now?: Date;
}

function shortId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

/**
 * Dashboard "Biggest lever this week" card (ARCH-124-cache-scorecard.md
 * T9, R7/R8): the single largest cache-waste event in the active global
 * range + filters, or a positive first-write-share summary when the
 * period has creation but no waste, or a distinct no-cache-activity state.
 * Reuses the existing global filter-bar state (`useFilters`) — no second
 * filter source — matching `AnomalyFeed`/`RecordsStrip`'s section-owned
 * query pattern.
 */
export function BiggestLeverCard({
  now: injectedNow,
}: BiggestLeverCardProps = {}): React.JSX.Element {
  const { filters } = useFilters();
  const now = useStableNow(injectedNow);
  const range = resolveRange(filters.range, now);

  // biome-ignore lint/correctness/useExhaustiveDependencies: range/filters covered via their JSON identity below (mirrors AnomalyFeed.tsx)
  const params = useMemo<BiggestLeverParams>(
    () => ({
      from: range.from,
      to: range.to,
      project: filters.project,
      model: filters.model,
      branch: filters.branch,
      host: filters.host,
    }),
    [range.from, range.to, JSON.stringify(filters)],
  );

  const query = useQuery({
    queryKey: qk.biggestLever(params),
    queryFn: ({ signal }) => getBiggestLever(params, signal),
    placeholderData: keepPreviousData,
  });

  return (
    <div
      data-testid="biggest-lever-card"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
        Biggest lever this week
      </h2>

      {query.isPending ? (
        <p role="status" className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">
          Loading…
        </p>
      ) : query.isError ? (
        <p role="alert" className="mt-3 text-sm text-[#B23A3A] dark:text-[#E05252]">
          {query.error instanceof Error ? query.error.message : "Couldn't load Biggest Lever"}
        </p>
      ) : (
        <BiggestLeverBody data={query.data} />
      )}
    </div>
  );
}

function BiggestLeverBody({ data }: { data: BiggestLeverView }): React.JSX.Element {
  switch (data.state) {
    case "event":
      return (
        <div data-testid="biggest-lever-event" className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700 dark:bg-[#232B36] dark:text-[#B8C3CC]">
              {KIND_LABEL[data.kind]}
            </span>
            <span className="font-mono text-slate-700 dark:text-[#B8C3CC]">
              {formatUnitValue(data.tokensRewritten, "tokens")} rewritten
            </span>
            <span className="font-mono text-slate-700 dark:text-[#B8C3CC]">
              {data.costEstimate === null ? "unavailable" : formatUnitValue(data.costEstimate, "$")}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-[#8A96A5]">
            {data.sessionProject} · session {shortId(data.sessionId)}
          </p>
          <Link
            href={data.deepLink}
            aria-label="Investigate this session's Cache Scorecard section"
            className="text-xs font-medium text-[#96631E] dark:text-[#E8A33D]"
          >
            Investigate →
          </Link>
        </div>
      );
    case "healthy": {
      const sharePct =
        data.firstWriteShare === null ? null : Math.round(data.firstWriteShare * 100);
      return (
        <div data-testid="biggest-lever-healthy" className="mt-3 flex flex-col gap-1">
          <p className="text-sm text-slate-700 dark:text-[#B8C3CC]">
            No waste events this period — {sharePct ?? "—"}% first-write share of{" "}
            {formatUnitValue(data.totalCreationTokens, "tokens")} created.
          </p>
        </div>
      );
    }
    case "no-cache-activity":
      return (
        <div data-testid="biggest-lever-no-activity" className="mt-3 flex flex-col gap-1">
          <p className="text-sm text-slate-500 dark:text-[#8B98A9]">
            No cache activity in the selected period.
          </p>
        </div>
      );
  }
}
