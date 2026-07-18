import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import { LeverageRatio } from "./LeverageRatio.js";

// Same pattern as ChartCard.stories.tsx: LeverageRatio fetches via
// postMetrics (window.fetch), so each story stubs window.fetch directly
// rather than exercising a real endpoint.
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

function aggregateSeries(values: {
  cacheReadTokens: number;
  inputTokens: number;
  cacheCreateTokens: number;
}): Series[] {
  const t = "2026-07-08T00:00:00.000Z";
  return [
    {
      measure: "cacheReadTokens",
      dimensionKey: "all",
      label: "All",
      points: [{ t, value: values.cacheReadTokens }],
    },
    {
      measure: "inputTokens",
      dimensionKey: "all",
      label: "All",
      points: [{ t, value: values.inputTokens }],
    },
    {
      measure: "cacheCreateTokens",
      dimensionKey: "all",
      label: "All",
      points: [{ t, value: values.cacheCreateTokens }],
    },
  ];
}

const meta: Meta<typeof LeverageRatio> = {
  title: "Dashboard/LeverageRatio",
  component: LeverageRatio,
};

export default meta;
type Story = StoryObj<typeof LeverageRatio>;

/** Populated: a healthy cache-leverage ratio, e.g. "20.6×". */
export const Populated: Story = {
  decorators: [
    withFetch(() =>
      jsonResponse(
        aggregateSeries({
          cacheReadTokens: 2_060_000,
          inputTokens: 80_000,
          cacheCreateTokens: 20_000,
        }),
      ),
    ),
  ],
};

/** Zero fresh-billed denominator (all traffic served from cache with no
 * fresh input/cache-create tokens) — renders "—", never NaN/Infinity
 * (A3+R3, T11 Testable Seam). */
export const ZeroDenominator: Story = {
  decorators: [
    withFetch(() =>
      jsonResponse(aggregateSeries({ cacheReadTokens: 0, inputTokens: 0, cacheCreateTokens: 0 })),
    ),
  ],
};

/** No matched activity at all — every measure comes back with a `null`
 * point, same "—" rendering path as ZeroDenominator. */
export const Empty: Story = {
  decorators: [
    withFetch(() =>
      jsonResponse([
        {
          measure: "cacheReadTokens",
          dimensionKey: "all",
          label: "All",
          points: [{ t: "2026-07-08T00:00:00.000Z", value: null }],
        },
        {
          measure: "inputTokens",
          dimensionKey: "all",
          label: "All",
          points: [{ t: "2026-07-08T00:00:00.000Z", value: null }],
        },
        {
          measure: "cacheCreateTokens",
          dimensionKey: "all",
          label: "All",
          points: [{ t: "2026-07-08T00:00:00.000Z", value: null }],
        },
      ]),
    ),
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
