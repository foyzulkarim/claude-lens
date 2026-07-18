import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import { FailedWorkStat } from "./FailedWorkStat.js";

// Same pattern as ChartCard.stories.tsx: FailedWorkStat fetches via
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

function toolErrorsSeries(value: number | null): Series[] {
  return [
    {
      measure: "toolErrors",
      dimensionKey: "all",
      label: "All",
      points: [{ t: "2026-07-08T00:00:00.000Z", value }],
    },
  ];
}

const meta: Meta<typeof FailedWorkStat> = {
  title: "Dashboard/FailedWorkStat",
  component: FailedWorkStat,
};

export default meta;
type Story = StoryObj<typeof FailedWorkStat>;

/** Populated: several classified failures in the active range. */
export const Populated: Story = {
  decorators: [withFetch(() => jsonResponse(toolErrorsSeries(7)))],
};

/** A real zero — turns exist in the active range but none carry a
 * classified failure. Renders "0", not "—" (A3+R3, T11 Testable Seam). */
export const ZeroFailures: Story = {
  decorators: [withFetch(() => jsonResponse(toolErrorsSeries(0)))],
};

/** No turns at all in the active range (genuinely no data) — the
 * `toolErrors` measure returns `null`, rendered as "—" rather than a
 * fabricated 0 (T11 Testable Seam: renders `0` vs `undefined` distinctly). */
export const Unavailable: Story = {
  decorators: [withFetch(() => jsonResponse(toolErrorsSeries(null)))],
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
