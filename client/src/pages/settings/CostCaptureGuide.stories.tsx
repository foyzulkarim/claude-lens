import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { CaptureAssets } from "../../../../shared/capture-assets-contract.js";
import type { SessionListResponse } from "../../../../shared/sessions-contract.js";
import { CostCaptureGuide } from "./CostCaptureGuide.js";

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

function withFetch(captureAssets: () => Promise<Response>, sessions: () => Promise<Response>) {
  return function Decorator(Story: () => ReactElement) {
    const { hook, searchHook } = memoryLocation({ path: "/settings", static: true });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    window.fetch = ((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      return url.includes("capture-assets") ? captureAssets() : sessions();
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

function captureAssetsResponse(captureDir: CaptureAssets["captureDir"]): CaptureAssets {
  return { captureDir };
}

const RESOLVED_DIR = "/Users/demo/.claude-lens-checkout/capture";

const meta: Meta<typeof CostCaptureGuide> = {
  title: "Settings/CostCaptureGuide",
  component: CostCaptureGuide,
};

export default meta;
type Story = StoryObj<typeof CostCaptureGuide>;

export const NotYetVerified: Story = {
  decorators: [
    withFetch(
      () => jsonResponse(captureAssetsResponse(RESOLVED_DIR)),
      () => jsonResponse(sessionsResponse({ capturingSessions: 0, lastCapturedAt: null })),
    ),
  ],
};

export const Verified: Story = {
  decorators: [
    withFetch(
      () => jsonResponse(captureAssetsResponse(RESOLVED_DIR)),
      () =>
        jsonResponse(
          sessionsResponse({ capturingSessions: 12, lastCapturedAt: "2026-07-15T14:30:00.000Z" }),
        ),
    ),
  ],
};

/** S7 — capture assets unresolved (dev server without a build, or a stripped install). */
export const CaptureAssetsUnresolved: Story = {
  decorators: [
    withFetch(
      () => jsonResponse(captureAssetsResponse(null)),
      () => jsonResponse(sessionsResponse({ capturingSessions: 0, lastCapturedAt: null })),
    ),
  ],
};

export const Loading: Story = {
  decorators: [
    withFetch(
      () => new Promise<Response>(() => {}),
      () => new Promise<Response>(() => {}),
    ),
  ],
};

export const ErrorState: Story = {
  decorators: [
    withFetch(
      () => jsonResponse(captureAssetsResponse(RESOLVED_DIR)),
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "server unreachable" }), { status: 500 }),
        ),
    ),
  ],
};
