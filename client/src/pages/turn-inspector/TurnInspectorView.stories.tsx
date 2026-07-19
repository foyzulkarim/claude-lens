import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { TurnInspectorResponse } from "../../../../shared/turn-inspector-contract.js";
import { TurnInspectorView } from "./TurnInspectorView.js";

// TurnInspectorView renders wouter <Link> nav (TurnSummary) and a
// TanStack Query-backed TranscriptPeek panel, so every story needs both a
// Router and a QueryClientProvider — same decorator pattern as
// SessionDetail.stories.tsx, plus the query client TranscriptPeek needs.
function withProviders(Story: () => ReactElement) {
  const { hook, searchHook } = memoryLocation({ path: "/session/s1/turn/2", static: true });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <Story />
      </Router>
    </QueryClientProvider>
  );
}

function baseResponse(overrides: Partial<TurnInspectorResponse> = {}): TurnInspectorResponse {
  return {
    summary: {
      sessionId: "11111111-1111-4111-8111-111111111111",
      turnNumber: 2,
      totalTurns: 5,
      promptId: "prompt-2",
      promptText: "refactor the statusline wrapper to buffer samples and flush on exit",
      startedAt: "2026-07-03T04:47:00.000Z",
      endedAt: "2026-07-03T04:53:41.000Z",
      cost: 3.12,
      tokens: 840_000,
      callCount: 9,
      models: ["claude-opus-4-8"],
      primaryModel: "claude-opus-4-8",
      fleetPercentile: 97,
      isAnomaly: true,
    },
    waterfall: {
      calls: [
        {
          callIndex: 0,
          messageId: "msg-1",
          timestamp: "2026-07-03T04:47:00.000Z",
          offsetMs: 0,
          tokens: 1200,
          cost: 0.02,
          tools: [],
          isSidechain: false,
          cacheReadTokens: 0,
          cacheCreateTokens: 300,
        },
        {
          callIndex: 1,
          messageId: "msg-2",
          timestamp: "2026-07-03T04:47:12.000Z",
          offsetMs: 12_000,
          tokens: 212_000,
          cost: 1.1,
          tools: [{ name: "Read", inputBytes: 41_203 }],
          isSidechain: false,
          cacheReadTokens: 208_000,
          cacheCreateTokens: 0,
        },
        {
          callIndex: 2,
          messageId: "msg-3",
          timestamp: "2026-07-03T04:48:20.000Z",
          offsetMs: 80_000,
          tokens: 156_000,
          cost: 0.95,
          tools: [{ name: "Edit", inputBytes: 4_120 }],
          isSidechain: false,
          cacheReadTokens: 5_000,
          cacheCreateTokens: 28_600,
        },
        {
          callIndex: 3,
          messageId: "msg-4",
          timestamp: "2026-07-03T04:50:05.000Z",
          offsetMs: 185_000,
          tokens: 87_000,
          cost: 0.41,
          tools: [{ name: "Agent", inputBytes: 900 }],
          isSidechain: true,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
        },
      ],
    },
    cacheNarrative: [
      {
        callIndex: 0,
        cause: "first-call",
        isWriteSpike: false,
        hitRate: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 300,
      },
      {
        callIndex: 1,
        cause: "unexplained",
        isWriteSpike: false,
        hitRate: 0.98,
        cacheReadTokens: 208_000,
        cacheCreateTokens: 0,
      },
      {
        callIndex: 2,
        cause: "unexplained",
        isWriteSpike: true,
        hitRate: 0.15,
        cacheReadTokens: 5_000,
        cacheCreateTokens: 28_600,
        narrative: "28.6k tokens re-written — cause: unexplained",
      },
    ],
    sidechainBreakdown: {
      mainCost: 2.71,
      mainTokens: 753_000,
      mainCallCount: 8,
      sidechains: [
        {
          agentId: "agent-1",
          cost: 0.41,
          tokens: 87_000,
          callCount: 3,
          primaryModel: "claude-sonnet-5",
        },
      ],
    },
    nav: { prevTurnNumber: 1, nextTurnNumber: 3, totalTurns: 5 },
    meta: { costBasis: "computed", availability: [], fleetBaselineSize: 480 },
    ...overrides,
  };
}

const meta: Meta<typeof TurnInspectorView> = {
  title: "TurnInspector/TurnInspectorView",
  component: TurnInspectorView,
  decorators: [withProviders],
};

export default meta;
type Story = StoryObj<typeof TurnInspectorView>;

/** Standard state: mid-session anomalous turn with a sidechain and a
 * K2-style unexplained cache write spike. */
export const Normal: Story = {
  args: { data: baseResponse() },
};

/** First turn of a session: no prev nav, no sidechain, no notable cache
 * narrative — every section's honest "nothing here" state. */
export const FirstTurnNoSidechain: Story = {
  args: {
    data: baseResponse({
      summary: {
        ...baseResponse().summary,
        turnNumber: 1,
        fleetPercentile: 40,
        isAnomaly: false,
      },
      cacheNarrative: [],
      sidechainBreakdown: { mainCost: 0.22, mainTokens: 7590, mainCallCount: 2, sidechains: [] },
      nav: { prevTurnNumber: null, nextTurnNumber: 2, totalTurns: 5 },
    }),
  },
};

/** Last turn, empty waterfall — a known-but-empty turn (e.g. a still-
 * draining logical turn with zero completed calls). */
export const EmptyWaterfall: Story = {
  args: {
    data: baseResponse({
      summary: {
        ...baseResponse().summary,
        turnNumber: 5,
        cost: 0,
        tokens: 0,
        callCount: 0,
        fleetPercentile: null,
        isAnomaly: false,
      },
      waterfall: { calls: [] },
      cacheNarrative: [],
      sidechainBreakdown: { mainCost: 0, mainTokens: 0, mainCallCount: 0, sidechains: [] },
      nav: { prevTurnNumber: 4, nextTurnNumber: null, totalTurns: 5 },
    }),
  },
};
