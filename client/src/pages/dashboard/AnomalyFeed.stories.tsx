import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { SessionListResponse } from "../../../../shared/sessions-contract.js";
import { AnomalyFeed, type AnomalyFeedItem } from "./AnomalyFeed.js";

// AnomalyFeed fetches via listSessions (window.fetch) when no `items` override
// is given — same withFetch decorator pattern as ChartCard.stories.tsx.
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

const emptySessionsResponse: SessionListResponse = {
  items: [],
  total: 0,
  meta: {
    matchedExtent: null,
    globalCapture: {
      hasCostSamples: false,
      hasTurnBoundaries: false,
      hasCostLog: false,
      costBasis: "computed",
    },
  },
};

const anomalyItems: AnomalyFeedItem[] = [
  {
    kind: "anomaly",
    sessionId: "session-aaaa1111",
    turnId: "turn-4",
    severity: "high",
    summary: "Turn cost $12.40 is 12.0x the session median ($1.03)",
    drill: "/sessions/session-aaaa1111",
  },
  {
    kind: "anomaly",
    sessionId: "session-bbbb2222",
    turnId: "turn-2",
    severity: "medium",
    summary: "Turn cost $6.10 is 6.1x the session median ($1.00)",
    drill: "/sessions/session-bbbb2222",
  },
];

const captureGapItems: AnomalyFeedItem[] = [
  {
    kind: "captureGap",
    sessionId: "session-cccc3333",
    severity: "low",
    summary: "Cost log missing for a 40-minute window — observed values unavailable",
    drill: "/sessions/session-cccc3333",
  },
];

const mixedItems: AnomalyFeedItem[] = [
  ...anomalyItems,
  {
    kind: "gateFailure",
    sessionId: "session-dddd4444",
    turnId: "turn-9",
    severity: "high",
    summary: "Gate check failed on turn 9 (lint)",
    drill: "/sessions/session-dddd4444",
  },
  ...captureGapItems,
];

const meta: Meta<typeof AnomalyFeed> = {
  title: "Dashboard/AnomalyFeed",
  component: AnomalyFeed,
};

export default meta;
type Story = StoryObj<typeof AnomalyFeed>;

// Default (no `items` override): the real fetch+detect path, with no
// sessions to analyze — renders the "gate data not available yet" stub.
export const Empty: Story = {
  decorators: [withFetch(() => jsonResponse(emptySessionsResponse))],
};

export const Populated: Story = {
  args: { items: mixedItems },
  decorators: [withFetch(() => jsonResponse(emptySessionsResponse))],
};

export const AnomalyOnly: Story = {
  args: { items: anomalyItems },
  decorators: [withFetch(() => jsonResponse(emptySessionsResponse))],
};

export const CaptureGapOnly: Story = {
  args: { items: captureGapItems },
  decorators: [withFetch(() => jsonResponse(emptySessionsResponse))],
};
