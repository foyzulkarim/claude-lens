import type { ReactNode } from "react";
import type { SessionDetailResponse } from "../../../../shared/session-detail-contract.js";

export interface SessionDetailViewProps {
  data: SessionDetailResponse;
}

/**
 * Pure presentational composition of one session's detail response. This
 * initial version (#P4-5 T6) is intentionally a labeled region grid so the
 * later tasks (T7–T10) can drop in their component implementations
 * without re-shaping the layout. The route shell owns data fetching and
 * error states; this view only renders a validated `SessionDetailResponse`.
 */
export function SessionDetailView({ data }: SessionDetailViewProps): ReactNode {
  return (
    <div
      data-testid="session-detail-view"
      className="flex flex-col gap-6 p-6"
      aria-label={`Session ${data.header.sessionId}`}
    >
      <h1 className="text-xl font-semibold text-slate-900 dark:text-[#E8EDF2]">
        Session Detail — {data.header.sessionId}
      </h1>

      <section aria-labelledby="session-detail-header">
        <h2 id="session-detail-header" className="sr-only">
          Header
        </h2>
        {/* T7 fills this in with `Header` + `CostTimeline`. */}
        <div data-region="header" className="rounded border border-dashed border-slate-300 p-4 text-sm">
          <p>Header placeholder — populated in T7.</p>
          <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
            <dt>project:</dt>
            <dd>{data.header.project}</dd>
            <dt>branch:</dt>
            <dd>{data.header.branch}</dd>
            <dt>turns:</dt>
            <dd>{data.header.logicalTurnCount}</dd>
          </dl>
        </div>
      </section>

      <section aria-labelledby="session-detail-turns">
        <h2 id="session-detail-turns" className="text-base font-semibold">
          Turns
        </h2>
        {/* T8 fills this in. */}
        <div data-region="turns" className="rounded border border-dashed border-slate-300 p-4 text-sm">
          {data.turns.length} logical turn(s).
        </div>
      </section>

      <section aria-labelledby="session-detail-prompts">
        <h2 id="session-detail-prompts" className="text-base font-semibold">
          Prompts
        </h2>
        {/* T9 fills this in. */}
        <div data-region="prompts" className="rounded border border-dashed border-slate-300 p-4 text-sm">
          {data.prompts.length} prompt(s).
        </div>
      </section>

      <section aria-labelledby="session-detail-tokens">
        <h2 id="session-detail-tokens" className="text-base font-semibold">
          Token &amp; Context
        </h2>
        {/* T10 fills this in. */}
        <div data-region="tokens" className="rounded border border-dashed border-slate-300 p-4 text-sm">
          {data.contextComposition.length} context item(s).
        </div>
      </section>
    </div>
  );
}
