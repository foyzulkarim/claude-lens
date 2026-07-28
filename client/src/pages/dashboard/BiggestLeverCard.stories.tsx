import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { BiggestLeverView } from "../../../../shared/scorecard-contract.js";
import { BiggestLeverCard } from "./BiggestLeverCard.js";

// BiggestLeverCard fetches via getBiggestLever (window.fetch) and reads the
// global filter bar through useFilters (needs a Router) — same withFetch +
// Router decorator pattern as AnomalyFeed.stories.tsx.
function withFetch(impl: () => Promise<Response> | Promise<never>) {
  return function Decorator(Story: () => ReactElement) {
    const { hook, searchHook } = memoryLocation({ path: "/", static: true });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    window.fetch = impl as typeof window.fetch;
    return (
      <QueryClientProvider client={queryClient}>
        <Router hook={hook} searchHook={searchHook}>
          <Story />
        </Router>
      </QueryClientProvider>
    );
  };
}

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

const eventLever: BiggestLeverView = {
  state: "event",
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
  tokensRewritten: 90_000,
  costEstimate: 0.34,
  costBasis: "computed",
  deepLink: "/sessions/session-aaaa1111#cache-scorecard",
  sessionId: "session-aaaa1111",
  sessionProject: "/repo/alpha",
  evaluatedAt: "2026-07-20T12:30:00.000Z",
};

const unexplainedLever: BiggestLeverView = {
  ...eventLever,
  eventId: "m50",
  callId: "m50",
  kind: "unattributed",
  attribution: "unknown",
  costEstimate: null,
  costBasis: "unavailable",
};

const healthyLever: BiggestLeverView = {
  state: "healthy",
  firstWriteTokens: 480_000,
  totalCreationTokens: 500_000,
  firstWriteShare: 0.96,
  evaluatedAt: "2026-07-20T12:30:00.000Z",
};

const noActivityLever: BiggestLeverView = {
  state: "no-cache-activity",
  firstWriteTokens: 0,
  totalCreationTokens: 0,
  firstWriteShare: null,
  evaluatedAt: "2026-07-20T12:30:00.000Z",
};

const meta: Meta<typeof BiggestLeverCard> = {
  title: "Dashboard/BiggestLeverCard",
  component: BiggestLeverCard,
};

export default meta;
type Story = StoryObj<typeof BiggestLeverCard>;

export const EventState: Story = {
  decorators: [withFetch(() => jsonResponse(eventLever))],
};

export const UnexplainedEvent: Story = {
  decorators: [withFetch(() => jsonResponse(unexplainedLever))],
};

export const HealthyState: Story = {
  decorators: [withFetch(() => jsonResponse(healthyLever))],
};

export const NoCacheActivity: Story = {
  decorators: [withFetch(() => jsonResponse(noActivityLever))],
};

export const Loading: Story = {
  decorators: [withFetch(() => new Promise(() => {}))],
};

export const ErrorState: Story = {
  decorators: [
    withFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "from and to are required" }), { status: 400 }),
      ),
    ),
  ],
};
