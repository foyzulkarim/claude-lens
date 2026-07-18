import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { SessionDetailResponse } from "../../../../shared/session-detail-contract.js";
import { SessionDetailView } from "./SessionDetailView.js";

// SessionDetailView renders wouter <Link> drill links (TurnsSection), so
// every story needs a Router context — same decorator pattern as
// CaptureBanner.stories.tsx, minus the fetch stub since this component
// takes its data as a prop and performs no network calls.
function withRouter(Story: () => ReactElement) {
  const { hook, searchHook } = memoryLocation({ path: "/sessions/s1", static: true });
  return (
    <Router hook={hook} searchHook={searchHook}>
      <Story />
    </Router>
  );
}

const baseTier = {
  hasCostSamples: false,
  hasTurnBoundaries: false,
  hasCostLog: false,
  costBasis: "computed" as const,
};

function baseResponse(overrides: Partial<SessionDetailResponse> = {}): SessionDetailResponse {
  return {
    header: {
      sessionId: "11111111-1111-4111-8111-111111111111",
      project: "/Users/demo/projects/alpha",
      branch: "main",
      version: "2.1.199",
      models: ["claude-sonnet-5", "claude-fable-5"],
      firstAt: "2026-07-03T04:46:00.000Z",
      lastAt: "2026-07-03T04:47:04.000Z",
      logicalTurnCount: 2,
      callCount: 5,
      costComputed: 0.42,
      fleetCostMedian: 0.3,
      fleetCostRankPct: 65,
      tier: baseTier,
    },
    timeline: [
      {
        callIndex: 0,
        timestamp: "2026-07-03T04:46:01.000Z",
        cumulativeCost: 0.1,
        cumulativeTokens: 1350,
        cost: 0.1,
        tokens: 1350,
        contextPct: 0.02,
        turnNumber: 1,
        isTurnBoundary: true,
        isCompaction: false,
      },
      {
        callIndex: 1,
        timestamp: "2026-07-03T04:46:03.000Z",
        cumulativeCost: 0.22,
        cumulativeTokens: 7590,
        cost: 0.12,
        tokens: 6240,
        contextPct: 0.05,
        turnNumber: 1,
        isTurnBoundary: false,
        isCompaction: false,
      },
      {
        callIndex: 2,
        timestamp: "2026-07-03T04:47:01.000Z",
        cumulativeCost: 0.32,
        cumulativeTokens: 8520,
        cost: 0.1,
        tokens: 930,
        contextPct: 0.03,
        turnNumber: 2,
        isTurnBoundary: true,
        isCompaction: false,
      },
      {
        callIndex: 3,
        timestamp: "2026-07-03T04:47:03.000Z",
        cumulativeCost: 0.42,
        cumulativeTokens: 9040,
        cost: 0.1,
        tokens: 520,
        contextPct: 0.02,
        turnNumber: 2,
        isTurnBoundary: false,
        isCompaction: false,
      },
    ],
    turns: [
      {
        turnNumber: 1,
        promptId: "prompt-1",
        promptText: "List the files in this repo",
        startedAt: "2026-07-03T04:46:01.000Z",
        endedAt: "2026-07-03T04:46:03.000Z",
        cost: 0.22,
        mainCost: 0.22,
        sidechainCost: 0,
        tokens: 7590,
        inputTokens: 2200,
        outputTokens: 90,
        cacheReadTokens: 1000,
        cacheCreateTokens: 5300,
        callCount: 2,
        cacheHitPct: 0.13,
        tools: [{ name: "Bash", count: 1, inputBytes: 18 }],
        fleetPercentile: 40,
        isAnomaly: false,
        hasSidechain: false,
        primaryModel: "claude-sonnet-5",
        models: ["claude-sonnet-5"],
      },
      {
        turnNumber: 2,
        promptId: "prompt-2",
        promptText: "Now summarize it using a sub-agent",
        startedAt: "2026-07-03T04:47:01.000Z",
        endedAt: "2026-07-03T04:47:04.000Z",
        cost: 0.2,
        mainCost: 0.14,
        sidechainCost: 0.06,
        tokens: 1450,
        inputTokens: 1400,
        outputTokens: 50,
        cacheReadTokens: 200,
        cacheCreateTokens: 0,
        callCount: 3,
        cacheHitPct: 0.13,
        tools: [{ name: "Agent", count: 1, inputBytes: 62 }],
        fleetPercentile: 60,
        isAnomaly: false,
        hasSidechain: true,
        primaryModel: "claude-fable-5",
        models: ["claude-fable-5", "claude-sonnet-5"],
      },
    ],
    turnDistribution: {
      populationSize: 250,
      p50: 0.18,
      p90: 0.55,
      p99: 1.2,
      histogram: [
        { rangeStart: 0, rangeEnd: 0.2, count: 140 },
        { rangeStart: 0.2, rangeEnd: 0.4, count: 70 },
        { rangeStart: 0.4, rangeEnd: 0.6, count: 25 },
        { rangeStart: 0.6, rangeEnd: 1.2, count: 15 },
      ],
      basis: "all-history",
    },
    cache: [
      {
        callIndex: 0,
        timestamp: "2026-07-03T04:46:01.000Z",
        cacheReadTokens: 0,
        cacheCreateTokens: 300,
        hitRate: 0,
        cause: "first-call",
        isWriteSpike: false,
      },
      {
        callIndex: 1,
        timestamp: "2026-07-03T04:46:03.000Z",
        cacheReadTokens: 1000,
        cacheCreateTokens: 5000,
        hitRate: 0.14,
        cause: "unexplained",
        isWriteSpike: true,
      },
      {
        callIndex: 2,
        timestamp: "2026-07-03T04:47:01.000Z",
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        hitRate: 0,
        cause: "model-switch",
        isWriteSpike: false,
      },
      {
        callIndex: 3,
        timestamp: "2026-07-03T04:47:03.000Z",
        cacheReadTokens: 200,
        cacheCreateTokens: 0,
        hitRate: 1,
        cause: "unexplained",
        isWriteSpike: false,
      },
    ],
    toolMix: [
      { name: "Bash", callCount: 1, inputBytes: 18, resultBytes: 60, share: 0.6 },
      { name: "Agent", callCount: 1, inputBytes: 62, resultBytes: 40, share: 0.4 },
    ],
    toolTimeline: [
      { callIndex: 0, timestamp: "2026-07-03T04:46:01.000Z", toolName: "Bash", turnNumber: 1 },
      { callIndex: 2, timestamp: "2026-07-03T04:47:01.000Z", toolName: "Agent", turnNumber: 2 },
    ],
    prompts: [
      {
        turnNumber: 1,
        promptId: "prompt-1",
        timestamp: "2026-07-03T04:46:00.000Z",
        text: "List the files in this repo",
      },
      {
        turnNumber: 2,
        promptId: "prompt-2",
        timestamp: "2026-07-03T04:47:00.000Z",
        text: "Now summarize it using a sub-agent",
      },
    ],
    workflow: {
      baseEditCount: 0,
      readFirstCount: 0,
      plannedCount: 0,
      verifiedCount: 0,
      committedCount: 0,
      stages: [
        { id: "edit", label: "Edit cohort", count: 0 },
        { id: "read", label: "Read-first", count: 0 },
        { id: "plan", label: "Planned", count: 0 },
        { id: "verify", label: "Verified", count: 0 },
        { id: "commit", label: "Committed", count: 0 },
      ],
    },
    tokenFunnel: {
      contextOffered: 8850,
      cacheServed: 1200,
      freshBilled: 7650,
      output: 140,
    },
    contextComposition: [
      { toolName: "Bash", bytes: 60, share: 0.6 },
      { toolName: "Agent", bytes: 40, share: 0.4 },
    ],
    meta: {
      costBasis: "computed",
      isEmpty: false,
      isLive: false,
      availability: [],
      fleetBaselineSize: 250,
    },
    ...overrides,
  };
}

const meta: Meta<typeof SessionDetailView> = {
  title: "SessionDetail/SessionDetailView",
  component: SessionDetailView,
  decorators: [withRouter],
};

export default meta;
type Story = StoryObj<typeof SessionDetailView>;

/** Transcript-only: computed cost basis, no premium fields available —
 * the standard state for an install without C/B/L capture files. */
export const TranscriptOnly: Story = {
  args: { data: baseResponse() },
};

/** Premium-available: costObserved + drift + context sample present
 * (reserved fields populated), demonstrating the #P4-13 upgrade path
 * without implementing the parser here. */
export const PremiumAvailable: Story = {
  args: {
    data: baseResponse({
      header: {
        ...baseResponse().header,
        costObserved: 0.45,
        drift: { delta: 0.03, pct: 0.0714 },
        contextPctEstimated: 0.06,
        tier: { ...baseTier, hasCostSamples: true, costBasis: "observed" },
      },
      meta: {
        costBasis: "observed",
        isEmpty: false,
        isLive: false,
        availability: ["header.drift", "header.contextPct"],
        fleetBaselineSize: 250,
      },
    }),
  },
};

/** Partial/in-progress: an active session with only the first turn
 * completed and honest partial timeline/turn data — never a fabricated
 * "complete" appearance. */
export const PartialInProgress: Story = {
  args: {
    data: baseResponse({
      header: {
        ...baseResponse().header,
        logicalTurnCount: 1,
        callCount: 2,
        costComputed: 0.22,
        lastAt: "2026-07-03T04:46:03.000Z",
      },
      timeline: baseResponse().timeline.slice(0, 2),
      turns: baseResponse().turns.slice(0, 1),
      cache: baseResponse().cache.slice(0, 2),
      toolTimeline: baseResponse().toolTimeline.slice(0, 1),
      prompts: baseResponse().prompts.slice(0, 1),
      meta: {
        costBasis: "computed",
        isEmpty: false,
        isLive: true,
        availability: [],
        fleetBaselineSize: 250,
      },
    }),
  },
};

/** Empty: a known session with no completed calls yet — every section
 * shows its honest empty state rather than a fabricated zero/percentage. */
export const Empty: Story = {
  args: {
    data: baseResponse({
      header: {
        ...baseResponse().header,
        logicalTurnCount: 0,
        callCount: 0,
        costComputed: 0,
        fleetCostMedian: null,
        fleetCostRankPct: null,
        firstAt: "",
        lastAt: "",
      },
      timeline: [],
      turns: [],
      cache: [],
      toolMix: [],
      toolTimeline: [],
      prompts: [],
      workflow: {
        baseEditCount: 0,
        readFirstCount: 0,
        plannedCount: 0,
        verifiedCount: 0,
        committedCount: 0,
        stages: [
          { id: "edit", label: "Edit cohort", count: 0 },
          { id: "read", label: "Read-first", count: 0 },
          { id: "plan", label: "Planned", count: 0 },
          { id: "verify", label: "Verified", count: 0 },
          { id: "commit", label: "Committed", count: 0 },
        ],
      },
      tokenFunnel: { contextOffered: 0, cacheServed: 0, freshBilled: 0, output: 0 },
      contextComposition: [],
      turnDistribution: {
        populationSize: 0,
        p50: null,
        p90: null,
        p99: null,
        histogram: [],
        basis: "all-history",
      },
      meta: {
        costBasis: "computed",
        isEmpty: true,
        isLive: false,
        availability: [],
        fleetBaselineSize: 0,
      },
    }),
  },
};

/** Anomalous: turn 2 flagged as an outlier against the fleet baseline —
 * exercises the rose-colored anomaly bar/badge treatment. */
export const Anomalous: Story = {
  args: {
    data: baseResponse({
      turns: [
        baseResponse().turns[0]!,
        {
          ...baseResponse().turns[1]!,
          cost: 4.8,
          mainCost: 4.2,
          sidechainCost: 0.6,
          fleetPercentile: 99,
          isAnomaly: true,
        },
      ],
    }),
  },
};
