import type { TurnInspectorResponse } from "../../../../shared/turn-inspector-contract.js";
import { CacheNarrative } from "./CacheNarrative.js";
import { SidechainBreakdown } from "./SidechainBreakdown.js";
import { TranscriptPeek } from "./TranscriptPeek.js";
import { TurnSummary } from "./TurnSummary.js";
import { Waterfall } from "./Waterfall.js";

export interface TurnInspectorViewProps {
  data: TurnInspectorResponse;
}

/**
 * Pure presentational composition of one turn's inspector response. Owns
 * no fetch/state — the page shell handles that (mirrors
 * `session-detail/SessionDetailView.tsx`). Each section corresponds to one
 * binding spec section in `claude-lens-pages.md` §4.
 */
export function TurnInspectorView({ data }: TurnInspectorViewProps): React.JSX.Element {
  return (
    <section
      data-testid="turn-inspector-view"
      className="flex flex-col gap-6 p-6"
      aria-label={`Turn ${data.summary.turnNumber} of session ${data.summary.sessionId}`}
    >
      <TurnSummary summary={data.summary} nav={data.nav} />
      <Waterfall calls={data.waterfall.calls} />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <CacheNarrative points={data.cacheNarrative} />
        <SidechainBreakdown breakdown={data.sidechainBreakdown} />
      </div>
      <TranscriptPeek sessionId={data.summary.sessionId} turnNumber={data.summary.turnNumber} />
    </section>
  );
}
