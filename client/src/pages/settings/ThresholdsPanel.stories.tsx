import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AppConfig } from "../../../../shared/settings-contract.js";
import { ThresholdsPanel } from "./ThresholdsPanel.js";

function withFetch(impl: () => Promise<Response>) {
  return function Decorator(Story: () => ReactElement) {
    const { hook, searchHook } = memoryLocation({ path: "/settings", static: true });
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

const meta: Meta<typeof ThresholdsPanel> = {
  title: "Settings/ThresholdsPanel",
  component: ThresholdsPanel,
};

export default meta;
type Story = StoryObj<typeof ThresholdsPanel>;

export const NoBudgetOrThresholds: Story = {
  decorators: [withFetch(() => jsonResponse({ budget: null } satisfies AppConfig))],
};

export const FullConfigRenders: Story = {
  // ARCH-124-cache-scorecard.md T10: both threshold groups render together,
  // clearly grouped under their own subheadings.
  decorators: [
    withFetch(() =>
      jsonResponse({
        budget: 300,
        anomalyFactor: 5,
        gateThresholds: {
          v2Repeat: 4,
          c3MaxChars: 20_000,
          k2Spike: 12_000,
          e2MaxChars: 5_000,
          e2MaxLines: 80,
        },
        scorecardThresholds: {
          floorCalls: 12,
          calibrationMinSessions: 25,
          A: 96,
          B: 88,
          C: 72,
          D: 55,
        },
      } satisfies AppConfig),
    ),
  ],
};

export const PartialThresholdsFillFromDefaults: Story = {
  // Only one threshold of each group explicitly set — the rest should
  // display the built-in defaults, not be blank.
  decorators: [
    withFetch(() =>
      jsonResponse({
        budget: 100,
        gateThresholds: { v2Repeat: 7 },
        scorecardThresholds: { floorCalls: 15 },
      } satisfies AppConfig),
    ),
  ],
};

export const Loading: Story = {
  decorators: [withFetch(() => new Promise<Response>(() => {}))],
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
