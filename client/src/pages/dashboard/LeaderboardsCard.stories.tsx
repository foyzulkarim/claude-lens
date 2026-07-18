import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import type { SessionListResponse } from "../../../../shared/sessions-contract.js";
import { LeaderboardsCard } from "./LeaderboardsCard.js";

// LeaderboardsCard fetches via both listSessions and postMetrics (window.fetch)
// — same withFetch decorator pattern as ChartCard/SavingsDecomposition
// stories, since Storybook has no dev server behind it. Routes by URL since
// the two endpoints share the fetch global.
function withFetch(impl: (url: string) => Promise<Response> | Promise<never>) {
  return function Decorator(Story: () => ReactElement) {
    const { hook, searchHook } = memoryLocation({ path: "/", static: true });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    window.fetch = ((input: RequestInfo | URL) => impl(String(input))) as typeof window.fetch;
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

const sessionsResponse: SessionListResponse = {
  items: [
    {
      sessionId: "session-aaaa1111",
      startedAt: "2026-07-10T00:00:00.000Z",
      lastAt: "2026-07-10T01:00:00.000Z",
      project: "claude-lens",
      model: "claude-sonnet-5",
      durationMs: 3_600_000,
      turnCount: 12,
      costComputed: 18.42,
    },
    {
      sessionId: "session-bbbb2222",
      startedAt: "2026-07-09T00:00:00.000Z",
      lastAt: "2026-07-09T02:00:00.000Z",
      project: "other-repo",
      model: "claude-fable-5",
      durationMs: 7_200_000,
      turnCount: 20,
      costComputed: 9.11,
    },
  ],
  total: 2,
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

const projectSeries: Series[] = [
  {
    measure: "costComputed",
    dimensionKey: "project:claude-lens",
    label: "claude-lens",
    points: [{ t: "2026-07-08T00:00:00.000Z", value: 40.2 }],
  },
  {
    measure: "costComputed",
    dimensionKey: "project:other-repo",
    label: "other-repo",
    points: [{ t: "2026-07-08T00:00:00.000Z", value: 12.1 }],
  },
];

const modelSeries: Series[] = [
  {
    measure: "costComputed",
    dimensionKey: "model:claude-sonnet-5",
    label: "claude-sonnet-5",
    points: [{ t: "2026-07-08T00:00:00.000Z", value: 30.5 }],
  },
  {
    measure: "costComputed",
    dimensionKey: "model:claude-fable-5",
    label: "claude-fable-5",
    points: [{ t: "2026-07-08T00:00:00.000Z", value: 21.8 }],
  },
];

const meta: Meta<typeof LeaderboardsCard> = {
  title: "Dashboard/LeaderboardsCard",
  component: LeaderboardsCard,
};

export default meta;
type Story = StoryObj<typeof LeaderboardsCard>;

function routedResponse(url: string): Promise<Response> {
  if (url.includes("/api/sessions")) return jsonResponse(sessionsResponse);
  if (url.includes("/api/metrics")) {
    // Both the projects and models tabs POST to the same endpoint; return
    // whichever series set matches the requested dimension.
    return jsonResponse(projectSeries);
  }
  return jsonResponse([]);
}

export const Populated: Story = {
  decorators: [withFetch(routedResponse)],
};

export const ProjectsTab: Story = {
  args: { initialTab: "projects" },
  decorators: [
    withFetch((url) => {
      if (url.includes("/api/metrics")) return jsonResponse(projectSeries);
      return jsonResponse(sessionsResponse);
    }),
  ],
};

export const ModelsTab: Story = {
  args: { initialTab: "models" },
  decorators: [
    withFetch((url) => {
      if (url.includes("/api/metrics")) return jsonResponse(modelSeries);
      return jsonResponse(sessionsResponse);
    }),
  ],
};

export const Empty: Story = {
  decorators: [
    withFetch((url) => {
      if (url.includes("/api/sessions")) {
        return jsonResponse({
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
        } satisfies SessionListResponse);
      }
      return jsonResponse([]);
    }),
  ],
};
