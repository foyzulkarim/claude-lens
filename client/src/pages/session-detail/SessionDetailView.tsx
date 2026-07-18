import type { ReactNode } from "react";
import type { SessionDetailResponse } from "../../../../shared/session-detail-contract.js";
import { CostTimeline } from "./CostTimeline.js";
import { Header } from "./Header.js";

export interface SessionDetailViewProps {
  data: SessionDetailResponse;
}

/**
 * Pure presentational composition of one session's detail response.
 * Owns no fetch/state — the page shell handles that. Each labelled
 * section corresponds to one binding spec section in
 * `claude-lens-pages.md` §3.
 *
 * Section composition order follows the pages spec binding table:
 *   1. Header (#P4-5 T7)
 *   2. Cost timeline (#P4-5 T7)
 *   3. Turn analysis — bars, table, history distribution (#P4-5 T8)
 *   4. Cache strip (#P4-5 T8)
 *   5. Tool mix / timeline (#P4-5 T8)
 *   6. Prompt list (#P4-5 T9)
 *   7. Workflow funnel (#P4-5 T9)
 *   8. Token funnel (#P4-5 T10)
 *   9. Context composition (#P4-5 T10)
 */
export function SessionDetailView({ data }: SessionDetailViewProps): ReactNode {
  return (
    <div
      data-testid="session-detail-view"
      className="flex flex-col gap-6 p-6"
      aria-label={`Session ${data.header.sessionId}`}
    >
      <Header header={data.header} />
      <CostTimeline timeline={data.timeline} />

      <section aria-labelledby="session-detail-turns">
        <h2 id="session-detail-turns" className="sr-only">
          Turns
        </h2>
        {/* T8 fills this in. */}
        <div
          data-region="turns"
          className="rounded border border-dashed border-slate-300 p-4 text-sm"
        >
          {data.turns.length} logical turn(s).
        </div>
      </section>

      <section aria-labelledby="session-detail-prompts">
        <h2 id="session-detail-prompts" className="text-base font-semibold">
          Prompts
        </h2>
        {/* T9 fills this in. */}
        <div
          data-region="prompts"
          className="rounded border border-dashed border-slate-300 p-4 text-sm"
        >
          {data.prompts.length} prompt(s).
        </div>
      </section>

      <section aria-labelledby="session-detail-tokens">
        <h2 id="session-detail-tokens" className="text-base font-semibold">
          Token &amp; Context
        </h2>
        {/* T10 fills this in. */}
        <div
          data-region="tokens"
          className="rounded border border-dashed border-slate-300 p-4 text-sm"
        >
          {data.contextComposition.length} context item(s).
        </div>
      </section>
    </div>
  );
}
