import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { SavedView } from "../../../../shared/local-store-contract.js";
import { SavedViewsTagsPanel } from "./SavedViewsTagsPanel.js";

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

function tagged(url: string): Promise<Response> {
  const [path, search] = url.split("?");
  return jsonResponse({
    views: [
      {
        id: "v-july",
        name: "July fixtures",
        path: path ?? "/sessions",
        search: search ? `?${search}` : "",
        createdAt: "2026-07-15T12:00:00.000Z",
      } satisfies SavedView,
    ],
    tags: [
      { tag: "wip", sessionCount: 3 },
      { tag: "shipped", sessionCount: 1 },
    ],
  });
}

const meta: Meta<typeof SavedViewsTagsPanel> = {
  title: "Settings/SavedViewsTagsPanel",
  component: SavedViewsTagsPanel,
};

export default meta;
type Story = StoryObj<typeof SavedViewsTagsPanel>;

export const EmptyState: Story = {
  decorators: [withFetch(() => jsonResponse({ views: [], tags: [] }))],
};

export const Populated: Story = {
  decorators: [withFetch(() => tagged("sessions?from=2026-07-01T00%3A00%3A00.000Z"))],
};

// Loading decorator returns a never-resolving Promise<Response> so the
// QueryClient stays in `isPending` (same pattern as
// BurnRateCard.stories.tsx).
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
