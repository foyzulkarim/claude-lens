import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type {
  CacheScorecardCore,
  ScorecardThresholds,
  SessionScorecardView,
  WasteEventView,
} from "../../../../shared/scorecard-contract.js";
import { Scorecard, ScorecardView } from "./Scorecard.js";

const THRESHOLDS: ScorecardThresholds = {
  floorCalls: 10,
  calibrationMinSessions: 20,
  A: 95,
  B: 85,
  C: 70,
  D: 50,
};

function buildCore(overrides: Partial<CacheScorecardCore> = {}): CacheScorecardCore {
  return {
    sessionId: "s1",
    mainThreadCalls: 24,
    cacheReadTokens: 480_000,
    writes: [],
    decomposition: { warmup: 100_000, incremental: 320_000, rewritten: 40_000 },
    wasteRatio: 0.087,
    hitRatio: 0.72,
    scoreInputs: { confirmedFixableWaste: 40_000, scoreableCreation: 460_000 },
    hygieneScore: 0.91,
    ...overrides,
  };
}

function buildEvent(overrides: Partial<WasteEventView> = {}): WasteEventView {
  return {
    eventId: "m42",
    callId: "m42",
    promptId: "p9",
    turnNumber: 6,
    timestamp: "2026-07-20T12:04:00.000Z",
    model: "claude-sonnet-5",
    project: "/repo/alpha",
    branch: "main",
    kind: "prefix-bust",
    baseCause: "unexplained",
    attribution: "prefix-change",
    tokensRewritten: 40_000,
    costEstimate: 0.14,
    costBasis: "computed",
    deepLink: "/session/s1/turn/6",
    ...overrides,
  };
}

const meta: Meta<typeof ScorecardView> = {
  title: "SessionDetail/Scorecard",
  component: ScorecardView,
};

export default meta;
type Story = StoryObj<typeof ScorecardView>;

export const Graded: Story = {
  args: {
    data: {
      state: "graded",
      grade: "B",
      hygieneScore: 0.91,
      bands: { A: 95, B: 85, C: 70, D: 50, source: "fixed" },
      core: buildCore(),
      events: [buildEvent()],
      thresholdsUsed: THRESHOLDS,
      evaluatedAt: "2026-07-20T12:30:00.000Z",
    } satisfies SessionScorecardView,
  },
};

export const UnexplainedEvent: Story = {
  args: {
    data: {
      state: "graded",
      grade: "D",
      hygieneScore: 0.55,
      bands: { A: 95, B: 85, C: 70, D: 50, source: "fixed" },
      core: buildCore({
        decomposition: { warmup: 50_000, incremental: 50_000, rewritten: 90_000 },
      }),
      events: [
        buildEvent({
          eventId: "m50",
          callId: "m50",
          kind: "unattributed",
          attribution: "unknown",
          tokensRewritten: 90_000,
          costEstimate: null,
          costBasis: "unavailable",
          turnNumber: null,
          deepLink: "/sessions/s1#cache-scorecard",
        }),
      ],
      thresholdsUsed: THRESHOLDS,
      evaluatedAt: "2026-07-20T12:30:00.000Z",
    } satisfies SessionScorecardView,
  },
};

export const TooShort: Story = {
  args: {
    data: {
      state: "too-short",
      mainThreadCalls: 4,
      floorCalls: 10,
      core: buildCore({ mainThreadCalls: 4 }),
      events: [],
      thresholdsUsed: THRESHOLDS,
      evaluatedAt: "2026-07-20T12:30:00.000Z",
    } satisfies SessionScorecardView,
  },
};

export const NoMainThreadCalls: Story = {
  args: {
    data: {
      state: "no-main-thread-calls",
      core: buildCore({
        mainThreadCalls: 0,
        cacheReadTokens: 0,
        decomposition: { warmup: 0, incremental: 0, rewritten: 0 },
        wasteRatio: null,
        hitRatio: 0,
        scoreInputs: { confirmedFixableWaste: 0, scoreableCreation: 0 },
        hygieneScore: null,
      }),
      events: [],
      thresholdsUsed: THRESHOLDS,
      evaluatedAt: "2026-07-20T12:30:00.000Z",
    } satisfies SessionScorecardView,
  },
};

export const NoScoreableCreation: Story = {
  args: {
    data: {
      state: "no-scoreable-creation",
      core: buildCore({
        decomposition: { warmup: 0, incremental: 0, rewritten: 0 },
        wasteRatio: null,
        scoreInputs: { confirmedFixableWaste: 0, scoreableCreation: 0 },
        hygieneScore: null,
      }),
      events: [],
      thresholdsUsed: THRESHOLDS,
      evaluatedAt: "2026-07-20T12:30:00.000Z",
    } satisfies SessionScorecardView,
  },
};

// The fetch-driven wrapper's loading/error states — same "stub
// window.fetch" convention as LeverageRatio.stories.tsx. These use a
// custom `render` (rather than `args`) since they exercise `Scorecard`
// (the fetch wrapper), not `ScorecardView` (this file's default
// component); the story canvas' IntersectionObserver fires on mount so
// `useInView`'s lazy-mount gate doesn't need a separate stub.
function withFetch(impl: () => Promise<Response> | Promise<never>) {
  return function Decorator(Story: () => ReactElement) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    window.fetch = impl as typeof window.fetch;
    return (
      <QueryClientProvider client={queryClient}>
        <Story />
      </QueryClientProvider>
    );
  };
}

export const Loading: Story = {
  render: () => <Scorecard sessionId="s1" />,
  decorators: [withFetch(() => new Promise(() => {}))],
};

export const ErrorState: Story = {
  render: () => <Scorecard sessionId="s1" />,
  decorators: [
    withFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "session not found" }), { status: 404 }),
      ),
    ),
  ],
};
