import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { SessionListResponse } from "../../../../shared/sessions-contract.js";
import { CostCaptureGuide } from "./CostCaptureGuide.js";

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

function sessionsResponse(
  captureSummary: SessionListResponse["meta"]["captureSummary"],
): SessionListResponse {
  return {
    items: [],
    total: 0,
    meta: {
      matchedExtent: null,
      globalCapture: {
        hasCostSamples: captureSummary.capturingSessions > 0,
        hasTurnBoundaries: false,
        hasCostLog: false,
        costBasis: captureSummary.capturingSessions > 0 ? "observed" : "computed",
      },
      captureSummary,
    },
  };
}

const meta: Meta<typeof CostCaptureGuide> = {
  title: "Settings/CostCaptureGuide",
  component: CostCaptureGuide,
};

export default meta;
type Story = StoryObj<typeof CostCaptureGuide>;

export const NotYetVerified: Story = {
  decorators: [
    withFetch(() => jsonResponse(sessionsResponse({ capturingSessions: 0, lastCapturedAt: null }))),
  ],
};

export const Verified: Story = {
  decorators: [
    withFetch(() =>
      jsonResponse(
        sessionsResponse({ capturingSessions: 12, lastCapturedAt: "2026-07-15T14:30:00.000Z" }),
      ),
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
