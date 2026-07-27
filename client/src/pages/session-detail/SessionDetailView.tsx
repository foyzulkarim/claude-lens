import type { ReactNode } from "react";
import type { SessionDetailResponse } from "../../../../shared/session-detail-contract.js";
import { CacheStrip } from "./CacheStrip.js";
import { ContextComposition } from "./ContextComposition.js";
import { CostTimeline } from "./CostTimeline.js";
import { Header } from "./Header.js";
import { PromptList } from "./PromptList.js";
import { ReportCard } from "./ReportCard.js";
import { Scorecard } from "./Scorecard.js";
import { TokenFunnel } from "./TokenFunnel.js";
import { ToolMix } from "./ToolMix.js";
import { TurnsSection } from "./TurnsSection.js";
import { WorkflowFunnel } from "./WorkflowFunnel.js";

export interface SessionDetailViewProps {
  data: SessionDetailResponse;
}

/**
 * Pure presentational composition of one session's detail response.
 * Owns no fetch/state — the page shell handles that. Each labelled
 * section corresponds to one binding spec section in
 * `claude-lens-pages.md` §3. Report Card (#P4-12) is lazy-mounted; its
 * component owns the gate fetch and the IntersectionObserver harness.
 */
export function SessionDetailView({ data }: SessionDetailViewProps): ReactNode {
  return (
    <section
      data-testid="session-detail-view"
      className="flex flex-col gap-6 p-6"
      aria-label={`Session ${data.header.sessionId}`}
    >
      <Header header={data.header} />
      <CostTimeline timeline={data.timeline} />
      <TurnsSection
        sessionId={data.header.sessionId}
        turns={data.turns}
        distribution={data.turnDistribution}
      />
      <ReportCard sessionId={data.header.sessionId} />
      <Scorecard sessionId={data.header.sessionId} />
      <CacheStrip cache={data.cache} />
      <ToolMix toolMix={data.toolMix} toolTimeline={data.toolTimeline} />
      <PromptList prompts={data.prompts} />
      <WorkflowFunnel workflow={data.workflow} />
      <TokenFunnel funnel={data.tokenFunnel} />
      <ContextComposition items={data.contextComposition} />
    </section>
  );
}
