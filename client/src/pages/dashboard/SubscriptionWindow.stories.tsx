import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import type { SessionListResponse } from "../../../../shared/sessions-contract.js";
import { SubscriptionWindow } from "./SubscriptionWindow.js";

// Same stub-fetch + QueryClientProvider + wouter memoryLocation decorator
// pattern as ChartCard.stories.tsx (Storybook has no dev server behind it).
// Review #9: the card now fires both a `/api/sessions` probe AND four
// `/api/metrics` hourly token queries; the decorator answers each one
// deterministically based on URL.
function withFetch(impl: (url: string) => Promise<Response> | Promise<never>) {
  return function Decorator(Story: () => ReactElement) {
    const { hook, searchHook } = memoryLocation({ path: "/", static: true });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    window.fetch = ((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      return impl(url);
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

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

// Pinned "now" so the rolling-window math in every story is deterministic.
const NOW = new Date("2026-07-16T14:00:00.000Z");

/** Hourly points over the trailing 30 days: a quiet baseline, a historical
 * spike ~10 days ago (sets the "peak" for both windows above the current
 * activity), and recent activity in the last few hours (populates the
 * current 5h/7d windows and the "resets in" countdown). */
function populatedHourlySeries(measure: Series["measure"]): Series[] {
  const points: Series["points"] = [];
  const nowMs = NOW.getTime();
  const hourMs = 60 * 60 * 1000;
  for (let hoursAgo = 24 * 30; hoursAgo >= 0; hoursAgo--) {
    const t = new Date(nowMs - hoursAgo * hourMs).toISOString();
    let value = 50_000; // quiet baseline token count
    if (hoursAgo <= 4)
      value = 600_000; // recent burst inside the 5h window
    else if (hoursAgo >= 235 && hoursAgo <= 245) value = 800_000; // historical spike ~10 days ago
    points.push({ t, value });
  }
  return [{ measure, dimensionKey: "", label: measure, points }];
}

/** `/api/sessions` response with a non-null matchedExtent so the
 * metrics queries run with a sensible range. */
function sessionsExtentResponse(): SessionListResponse {
  return {
    items: [],
    total: 0,
    meta: {
      matchedExtent: { from: "2026-06-16T14:00:00.000Z", to: NOW.toISOString() },
      globalCapture: {
        hasCostSamples: false,
        hasTurnBoundaries: false,
        hasCostLog: false,
        costBasis: "computed",
      },
    },
  };
}

const meta: Meta<typeof SubscriptionWindow> = {
  title: "Dashboard/SubscriptionWindow",
  component: SubscriptionWindow,
  args: { now: NOW },
};

export default meta;
type Story = StoryObj<typeof SubscriptionWindow>;

export const HistoricalPeak: Story = {
  decorators: [
    withFetch((url) => {
      if (url.startsWith("/api/sessions")) return jsonResponse(sessionsExtentResponse());
      if (url.startsWith("/api/metrics")) return jsonResponse(populatedHourlySeries("inputTokens"));
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }),
  ],
};

export const SettingsCeiling: Story = {
  args: { ceiling: 4_000_000 },
  decorators: [
    withFetch((url) => {
      if (url.startsWith("/api/sessions")) return jsonResponse(sessionsExtentResponse());
      if (url.startsWith("/api/metrics")) return jsonResponse(populatedHourlySeries("inputTokens"));
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }),
  ],
};

export const Empty: Story = {
  // No matched sessions → matchedExtent: null → metrics queries skipped.
  decorators: [
    withFetch((url) => {
      if (url.startsWith("/api/sessions"))
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
        });
      return Promise.reject(new Error(`unexpected fetch in empty story: ${url}`));
    }),
  ],
};

export const Loading: Story = {
  decorators: [withFetch(() => new Promise(() => {}))],
};

export const ErrorState: Story = {
  decorators: [
    withFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "server unreachable" }), { status: 500 }),
      ),
    ),
  ],
};
