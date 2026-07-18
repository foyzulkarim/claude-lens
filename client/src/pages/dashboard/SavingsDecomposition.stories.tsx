import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import { SavingsDecomposition } from "./SavingsDecomposition.js";

// SavingsDecomposition fetches via postMetrics (window.fetch) — same
// withFetch decorator pattern as ChartCard.stories.tsx, since Storybook has
// no dev server behind it.
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

// Two priced model groups (Sonnet, Fable), each contributing both measures —
// the common "populated" state.
const populatedSeries: Series[] = [
  {
    measure: "cacheSavingsComputed",
    dimensionKey: "model:claude-sonnet-5",
    label: "claude-sonnet-5",
    points: [{ t: "2026-07-08T00:00:00.000Z", value: 300 }],
  },
  {
    measure: "cacheSavingsComputed",
    dimensionKey: "model:claude-fable-5",
    label: "claude-fable-5",
    points: [{ t: "2026-07-08T00:00:00.000Z", value: 112 }],
  },
  {
    measure: "routingSavingsComputed",
    dimensionKey: "model:claude-sonnet-5",
    label: "claude-sonnet-5",
    points: [{ t: "2026-07-08T00:00:00.000Z", value: 30 }],
  },
  {
    measure: "routingSavingsComputed",
    dimensionKey: "model:claude-fable-5",
    label: "claude-fable-5",
    points: [{ t: "2026-07-08T00:00:00.000Z", value: 19 }],
  },
];

// One priced model group (contributes real numbers) plus one unpriced model
// group — the unpriced group's measures come back `null` (server-side
// poisoning per measures.ts) and must be silently dropped, not fabricated.
const unpricedMixedSeries: Series[] = [
  {
    measure: "cacheSavingsComputed",
    dimensionKey: "model:claude-sonnet-5",
    label: "claude-sonnet-5",
    points: [{ t: "2026-07-08T00:00:00.000Z", value: 300 }],
  },
  {
    measure: "cacheSavingsComputed",
    dimensionKey: "model:some-unpriced-model",
    label: "some-unpriced-model",
    points: [{ t: "2026-07-08T00:00:00.000Z", value: null }],
  },
  {
    measure: "routingSavingsComputed",
    dimensionKey: "model:claude-sonnet-5",
    label: "claude-sonnet-5",
    points: [{ t: "2026-07-08T00:00:00.000Z", value: 30 }],
  },
  {
    measure: "routingSavingsComputed",
    dimensionKey: "model:some-unpriced-model",
    label: "some-unpriced-model",
    points: [{ t: "2026-07-08T00:00:00.000Z", value: null }],
  },
];

const meta: Meta<typeof SavingsDecomposition> = {
  title: "Dashboard/SavingsDecomposition",
  component: SavingsDecomposition,
};

export default meta;
type Story = StoryObj<typeof SavingsDecomposition>;

export const Populated: Story = {
  decorators: [withFetch(() => jsonResponse(populatedSeries))],
};

export const UnpricedModelDropped: Story = {
  decorators: [withFetch(() => jsonResponse(unpricedMixedSeries))],
};

export const ZeroSavings: Story = {
  decorators: [withFetch(() => jsonResponse([]))],
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
