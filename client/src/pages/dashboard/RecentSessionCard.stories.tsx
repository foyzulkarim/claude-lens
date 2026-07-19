import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { SessionListResponse } from "../../../../shared/sessions-contract.js";
import { RecentSessionCard } from "./RecentSessionCard.js";

// Same withFetch decorator pattern as ChartCard.stories.tsx / StatCardsRow's
// own stories: RecentSessionCard fetches via listSessions (window.fetch),
// so each story stubs the global fetch rather than exercising a real
// GET /api/sessions endpoint.
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

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

const baseSession = {
  sessionId: "081df792abcd1234",
  startedAt: "2026-07-18T10:12:00Z",
  lastAt: "2026-07-18T10:42:00Z",
  project: "agentic-swe-vod",
  model: "claude-opus-4",
  durationMs: 30 * 60 * 1000,
  turnCount: 5,
  costComputed: 7.97,
};

const trace = [
  { turnIndex: 0, cost: 0.8, timestamp: "2026-07-18T10:14:00Z" },
  { turnIndex: 1, cost: 1.2, timestamp: "2026-07-18T10:20:00Z" },
  { turnIndex: 2, cost: 0.5, timestamp: "2026-07-18T10:26:00Z" },
  { turnIndex: 3, cost: 2.9, timestamp: "2026-07-18T10:34:00Z" },
  { turnIndex: 4, cost: 2.57, timestamp: "2026-07-18T10:41:00Z" },
];

function response(
  overrides: Partial<SessionListResponse["items"][number]> = {},
): SessionListResponse {
  return {
    items: [{ ...baseSession, contextPctEstimated: 0.16, trace, ...overrides }],
    total: 1,
    meta: {
      matchedExtent: { from: baseSession.startedAt, to: baseSession.lastAt },
      globalCapture: {
        hasCostSamples: false,
        hasTurnBoundaries: false,
        hasCostLog: false,
        costBasis: "computed",
      },
      captureSummary: { capturingSessions: 0, lastCapturedAt: null },
    },
  };
}

const meta: Meta<typeof RecentSessionCard> = {
  title: "Dashboard/RecentSessionCard",
  component: RecentSessionCard,
};

export default meta;
type Story = StoryObj<typeof RecentSessionCard>;

export const Populated: Story = {
  decorators: [withFetch(() => jsonResponse(response()))],
};

export const ObservedTier: Story = {
  name: "Observed tier ($ premium capture)",
  decorators: [
    withFetch(() =>
      jsonResponse({
        ...response(),
        meta: {
          matchedExtent: { from: baseSession.startedAt, to: baseSession.lastAt },
          globalCapture: {
            hasCostSamples: true,
            hasTurnBoundaries: true,
            hasCostLog: true,
            costBasis: "observed",
          },
          captureSummary: { capturingSessions: 0, lastCapturedAt: null },
        },
      }),
    ),
  ],
};

export const UnknownModelContext: Story = {
  name: "Unknown model (ctx % hidden)",
  decorators: [withFetch(() => jsonResponse(response({ contextPctEstimated: undefined })))],
};

export const NoTrace: Story = {
  decorators: [withFetch(() => jsonResponse(response({ trace: undefined })))],
};

export const Empty: Story = {
  decorators: [
    withFetch(() =>
      jsonResponse({
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
          captureSummary: { capturingSessions: 0, lastCapturedAt: null },
        },
      }),
    ),
  ],
};

export const Loading: Story = {
  decorators: [withFetch(() => new Promise(() => {}))],
};

export const ErrorState: Story = {
  decorators: [withFetch(() => jsonResponse({ error: "server unreachable" }, 500))],
};
