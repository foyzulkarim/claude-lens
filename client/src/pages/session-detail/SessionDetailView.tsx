import type { ReactNode } from "react";
import type { SessionDetailResponse } from "../../../../shared/session-detail-contract.js";
import { CacheStrip } from "./CacheStrip.js";
import { CostTimeline } from "./CostTimeline.js";
import { Header } from "./Header.js";
import { ToolMix } from "./ToolMix.js";
import { TurnsSection } from "./TurnsSection.js";

export interface SessionDetailViewProps {
  data: SessionDetailResponse;
}

/**
 * Pure presentational composition of one session's detail response.
 * Owns no fetch/state — the page shell handles that. Each labelled
 * section corresponds to one binding spec section in
 * `claude-lens-pages.md` §3.
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
      <TurnsSection turns={data.turns} distribution={data.turnDistribution} />
      <CacheStrip cache={data.cache} />
      <ToolMix toolMix={data.toolMix} toolTimeline={data.toolTimeline} />

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
