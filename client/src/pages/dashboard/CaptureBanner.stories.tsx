import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { SessionListResponse } from "../../../../shared/sessions-contract.js";
import { CaptureBanner } from "./CaptureBanner.js";

// Same window.fetch-stubbing decorator pattern as ChartCard.stories.tsx —
// CaptureBanner calls listSessions (fetch) directly, no dev server behind
// Storybook.
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

function jsonResponse(body: SessionListResponse): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

function response(
  globalCapture: SessionListResponse["meta"]["globalCapture"],
): SessionListResponse {
  return {
    items: [],
    total: 0,
    meta: {
      matchedExtent: null,
      globalCapture,
      captureSummary: { capturingSessions: 0, lastCapturedAt: null },
    },
  };
}

const meta: Meta<typeof CaptureBanner> = {
  title: "Dashboard/CaptureBanner",
  component: CaptureBanner,
};

export default meta;
type Story = StoryObj<typeof CaptureBanner>;

export const Shown: Story = {
  decorators: [
    withFetch(() =>
      jsonResponse(
        response({
          hasCostSamples: false,
          hasTurnBoundaries: false,
          hasCostLog: false,
          costBasis: "computed",
        }),
      ),
    ),
  ],
};

export const Hidden: Story = {
  decorators: [
    withFetch(() =>
      jsonResponse(
        response({
          hasCostSamples: true,
          hasTurnBoundaries: false,
          hasCostLog: false,
          costBasis: "observed",
        }),
      ),
    ),
  ],
};
