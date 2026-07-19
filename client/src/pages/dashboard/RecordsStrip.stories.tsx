import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import type { SessionListItem, SessionListResponse } from "../../../../shared/sessions-contract.js";
import { RecordsStrip } from "./RecordsStrip.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function makeSession(overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    sessionId: "fbaf2dac-0000-4000-8000-000000000000",
    startedAt: "2026-07-08T09:00:00.000Z",
    lastAt: "2026-07-08T15:09:00.000Z",
    project: "claude-lens",
    model: "claude-sonnet-4-5",
    durationMs: 6 * 60 * 60_000 + 9 * 60_000,
    turnCount: 12,
    costComputed: 30.64,
    cacheSavingsComputed: 71,
    maxTurnCostComputed: 4.2,
    ...overrides,
  };
}

function sessionsResponse(item: SessionListItem | null): SessionListResponse {
  return {
    items: item ? [item] : [],
    total: item ? 1 : 0,
    meta: {
      matchedExtent: item
        ? { from: "2026-06-01T00:00:00.000Z", to: "2026-07-12T00:00:00.000Z" }
        : null,
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

const dayCostSeries: Series[] = [
  {
    measure: "costComputed",
    dimensionKey: "time",
    label: "Cost",
    points: [
      { t: "2026-07-10T00:00:00.000Z", value: 42.5 },
      { t: "2026-07-11T00:00:00.000Z", value: 109.92 },
      { t: "2026-07-12T00:00:00.000Z", value: 18.0 },
    ],
  },
];

// RecordsStrip fetches four /api/sessions pages plus one /api/metrics
// aggregate — the fetch stub routes on the request URL so each story only
// has to describe the "populated" vs "empty" shape once.
function withFetch(sessionItem: SessionListItem | null, daySeries: Series[]) {
  return function Decorator(Story: () => ReactElement) {
    const { hook, searchHook } = memoryLocation({ path: "/", static: true });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    window.fetch = ((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/sessions")) {
        return Promise.resolve(jsonResponse(sessionsResponse(sessionItem)));
      }
      return Promise.resolve(jsonResponse(daySeries));
    }) as typeof window.fetch;
    return (
      <QueryClientProvider client={queryClient}>
        <Router hook={hook} searchHook={searchHook}>
          <Story />
        </Router>
      </QueryClientProvider>
    );
  };
}

const meta: Meta<typeof RecordsStrip> = {
  title: "Dashboard/RecordsStrip",
  component: RecordsStrip,
};

export default meta;
type Story = StoryObj<typeof RecordsStrip>;

/** All five records resolved from a matched session + day history. */
export const Populated: Story = {
  decorators: [withFetch(makeSession(), dayCostSeries)],
};

/** No sessions match the active filters at all — every record renders "—",
 * and the day query never fires (no matched-history extent to query). */
export const Empty: Story = {
  decorators: [withFetch(null, [])],
};

/** A matched session exists but is missing optional fields (no cache
 * savings recorded, e.g. an unpriced model) — that record degrades to "—"
 * independently of the others. */
export const PartialData: Story = {
  decorators: [
    withFetch(makeSession({ cacheSavingsComputed: undefined, maxTurnCostComputed: undefined }), []),
  ],
};

export const Loading: Story = {
  decorators: [
    (Story: () => ReactElement) => {
      const { hook, searchHook } = memoryLocation({ path: "/", static: true });
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      window.fetch = (() => new Promise(() => {})) as typeof window.fetch;
      return (
        <QueryClientProvider client={queryClient}>
          <Router hook={hook} searchHook={searchHook}>
            <Story />
          </Router>
        </QueryClientProvider>
      );
    },
  ],
};
