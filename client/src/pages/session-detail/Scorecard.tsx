import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { WASTE_EVENT_KINDS } from "../../../../shared/scorecard-contract.js";
import type {
  SessionScorecardView,
  WasteEventView,
} from "../../../../shared/scorecard-contract.js";
import { qk } from "../../api/queryKeys.js";
import { getSessionScorecard } from "../../api/scorecard.js";
import { EmptyState } from "../../components/EmptyState.js";
import { GateStatusBadge } from "../../components/GateStatusBadge.js";
import { InfoButton } from "../../components/InfoButton.js";
import { useInView } from "../../hooks/useInView.js";
import {
  describeGradeBands,
  HYGIENE_SCORE_EXPLANATION,
  KIND_LABEL,
  METRIC_GLOSSARY,
  WASTE_EVENT_KIND_GLOSSARY,
} from "../../content/scorecardGlossary.js";
import { formatCost, formatPercent, formatTokens } from "./format.js";

export interface ScorecardProps {
  sessionId: string;
}

/**
 * Session Detail Cache Scorecard section (ARCH-124-cache-scorecard.md T8,
 * R6/R10). One lazy-mounted fetch against `/api/sessions/:id/scorecard`,
 * gated by `useInView(200px)` — mirrors `ReportCard.tsx`'s split so a
 * second per-session read doesn't block Session Detail's first paint.
 *
 * Render-only: every displayed value (grade, `kind`, cost, deep link) comes
 * straight off the wire (Module Boundaries — no cause/score/dollar logic
 * here). The heading ("Cache Hygiene"), badge label prefix ("Hygiene …"),
 * and separate bordered section keep this legible next to the adjacent
 * Report Card grade in the same page area (#3, high-risk callout).
 */
export function Scorecard({ sessionId }: ScorecardProps): React.JSX.Element {
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: "200px" }, "cache-scorecard");

  const query = useQuery({
    queryKey: qk.scorecard(sessionId),
    queryFn: ({ signal }) => getSessionScorecard(sessionId, signal),
    enabled: inView,
    staleTime: 60 * 1000,
  });

  return (
    <div ref={ref}>
      {!inView ? (
        <div
          aria-hidden="true"
          data-testid="scorecard-placeholder"
          className="h-32 rounded-md border border-slate-200 bg-white dark:border-[#232B36] dark:bg-[#151A21]"
        />
      ) : query.isPending ? (
        <p
          role="status"
          className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-500 dark:border-[#232B36] dark:bg-[#151A21] dark:text-[#8B98A9]"
        >
          Loading Cache Scorecard…
        </p>
      ) : query.isError ? (
        <EmptyState
          message={`Couldn't load Cache Scorecard: ${
            query.error instanceof Error ? query.error.message : "Unknown error"
          }`}
          action={{ label: "Retry", onClick: () => void query.refetch() }}
        />
      ) : (
        <ScorecardView data={query.data} />
      )}
    </div>
  );
}

function GradeBadge({ data }: { data: SessionScorecardView }): React.JSX.Element {
  switch (data.state) {
    case "graded":
      return (
        <span className="flex items-center gap-2">
          <GateStatusBadge
            letter={data.grade}
            label={`Hygiene ${data.grade}`}
            className="scorecard-grade-badge"
          />
          <InfoButton label="What does this grade mean?" title="Cache Hygiene grade">
            <p>{HYGIENE_SCORE_EXPLANATION}</p>
            <p className="mt-2">{describeGradeBands(data.bands)}</p>
          </InfoButton>
        </span>
      );
    case "too-short":
      return (
        <span
          data-testid="scorecard-ungraded-reason"
          className="rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:border-[#232B36] dark:text-[#8B98A9]"
        >
          not graded — too short ({data.mainThreadCalls}/{data.floorCalls} calls)
        </span>
      );
    case "no-main-thread-calls":
      return (
        <span
          data-testid="scorecard-ungraded-reason"
          className="rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:border-[#232B36] dark:text-[#8B98A9]"
        >
          no scorecard — no main-thread API calls
        </span>
      );
    case "no-scoreable-creation":
      return (
        <span
          data-testid="scorecard-ungraded-reason"
          className="rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:border-[#232B36] dark:text-[#8B98A9]"
        >
          not graded — no scoreable cache creation
        </span>
      );
  }
}

export interface ScorecardViewProps {
  data: SessionScorecardView;
}

/**
 * Pure presentational body — exported alongside `Scorecard` (its fetch
 * wrapper) so stories/tests can inject `data` directly instead of driving
 * the `useInView`/`useQuery` gate, mirroring `ReportCard`/`ReportCardView`'s
 * split without a second file (T8's footprint is one component file).
 * `id="cache-scorecard"` is the R6/#3 deep-link anchor every null-turn
 * `WasteEventView.deepLink` degrades to (`/sessions/:id#cache-scorecard`,
 * plural — `/session/:id/turn/:n` is Turn Inspector).
 */
export function ScorecardView({ data }: ScorecardViewProps): React.JSX.Element {
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    if (hash !== "cache-scorecard") return;
    const node = sectionRef.current;
    if (node && typeof node.focus === "function") node.focus();
  }, []);

  const { core } = data;

  return (
    <section
      ref={sectionRef}
      id="cache-scorecard"
      tabIndex={-1}
      data-testid="cache-scorecard"
      data-state={data.state}
      aria-label={`Cache Hygiene Scorecard for session ${core.sessionId}`}
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#96631E] dark:border-[#232B36] dark:bg-[#151A21] dark:focus-visible:ring-[#E8A33D]"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Cache Hygiene</h2>
        <GradeBadge data={data} />
      </header>

      <dl
        className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3"
        aria-label="Scorecard metrics"
      >
        <Metric label="cache reads" value={formatTokens(core.cacheReadTokens)} />
        <Metric
          label="warmup"
          value={formatTokens(core.decomposition.warmup)}
          description={METRIC_GLOSSARY.warmup}
        />
        <Metric
          label="incremental"
          value={formatTokens(core.decomposition.incremental)}
          description={METRIC_GLOSSARY.incremental}
        />
        <Metric
          label="rewritten"
          value={formatTokens(core.decomposition.rewritten)}
          description={METRIC_GLOSSARY.rewritten}
        />
        <Metric
          label="waste ratio"
          value={formatPercent(core.wasteRatio)}
          description={METRIC_GLOSSARY.wasteRatio}
        />
        <Metric
          label="hit ratio"
          value={formatPercent(core.hitRatio)}
          description={METRIC_GLOSSARY.hitRatio}
        />
      </dl>

      <div>
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-semibold text-slate-700 dark:text-[#B8C3CC]">Waste events</h3>
          <InfoButton label="What do waste event kinds mean?" title="Waste event kinds">
            {WASTE_EVENT_KINDS.map((kind) => (
              <p key={kind} className="mt-2 first:mt-0">
                <span className="font-mono font-semibold">{KIND_LABEL[kind]}</span>
                {" — "}
                {WASTE_EVENT_KIND_GLOSSARY[kind]}
              </p>
            ))}
          </InfoButton>
        </div>
        {data.events.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500 dark:text-[#8A96A5]">No waste events.</p>
        ) : (
          <ul aria-label="Waste events" className="mt-2 flex flex-col gap-2">
            {data.events.map((event) => (
              <WasteEventRow key={event.eventId} event={event} />
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-slate-500 dark:text-[#8A96A5]">Evaluated at {data.evaluatedAt}</p>
    </section>
  );
}

function Metric({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description?: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col">
      <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500 dark:text-[#8A96A5]">
        {label}
        {description !== undefined ? (
          <InfoButton label={`What does "${label}" mean?`} title={label}>
            <p>{description}</p>
          </InfoButton>
        ) : null}
      </dt>
      <dd className="font-mono text-slate-900 dark:text-[#E8EDF2]">{value}</dd>
    </div>
  );
}

function WasteEventRow({ event }: { event: WasteEventView }): React.JSX.Element {
  const isTurnLink = event.turnNumber !== null;
  return (
    <li
      data-testid={`waste-event-${event.eventId}`}
      data-kind={event.kind}
      className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 text-[11px] last:border-b-0 dark:border-[#232B36]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-slate-500 dark:text-[#8A96A5]">{event.timestamp}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700 dark:bg-[#232B36] dark:text-[#B8C3CC]">
          {KIND_LABEL[event.kind]}
        </span>
        <span className="font-mono text-slate-700 dark:text-[#B8C3CC]">
          {formatTokens(event.tokensRewritten)} rewritten
        </span>
        <span className="font-mono text-slate-700 dark:text-[#B8C3CC]">
          {event.costEstimate === null ? "unavailable" : formatCost(event.costEstimate)}
        </span>
      </div>
      <Link
        href={event.deepLink}
        aria-label={
          isTurnLink
            ? `Open turn ${event.turnNumber} in Turn Inspector`
            : // A session can have several null-turn waste events in the same
              // list (#124 review finding #20) — key the label on kind +
              // timestamp so a links-list screen reader hears distinct names
              // instead of the same "Open this session's Cache Scorecard
              // section" repeated once per event.
              `Open the Cache Scorecard section for the ${KIND_LABEL[event.kind]} event at ${event.timestamp}`
        }
        className="text-xs font-medium text-[#96631E] dark:text-[#E8A33D]"
      >
        {isTurnLink ? `View turn ${event.turnNumber} →` : "View scorecard →"}
      </Link>
    </li>
  );
}
