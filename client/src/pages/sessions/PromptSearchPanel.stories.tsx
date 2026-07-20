import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { PromptSearchPanel } from "./PromptSearchPanel.js";
import { EMPTY_INDEX, SAMPLE_INDEX } from "./prompt-search.fixtures.js";

// PromptSearchPanel fetches the full prompt corpus via window.fetch, so each
// story stubs the global fetch to demonstrate the panel's display states
// (loading is simulated via a never-resolving Promise; the rest are direct
// fixtures). Same withFetch decorator pattern as
// dashboard/RecentSessionCard.stories.tsx, collapsed into a single helper
// that takes optional initial search to seed the URL.
function withFetch(impl: () => Promise<Response> | Promise<never>, opts: { search?: string } = {}) {
  return function Decorator(Story: () => ReactElement) {
    const { hook, searchHook } = memoryLocation({
      path: "/",
      ...(opts.search !== undefined ? { searchPath: opts.search } : {}),
      static: true,
    });
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

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

const meta: Meta<typeof PromptSearchPanel> = {
  title: "Sessions/PromptSearchPanel",
  component: PromptSearchPanel,
};

export default meta;
type Story = StoryObj<typeof PromptSearchPanel>;

export const Loading: Story = {
  decorators: [withFetch(() => new Promise<Response>(() => {}))],
};

export const Empty: Story = {
  decorators: [withFetch(() => jsonResponse(EMPTY_INDEX))],
};

export const Idle: Story = {
  decorators: [withFetch(() => jsonResponse(SAMPLE_INDEX))],
};

export const ErrorState: Story = {
  decorators: [withFetch(() => jsonResponse({ error: "internal server error" }, 500))],
};

export const WithResults: Story = {
  decorators: [withFetch(() => jsonResponse(SAMPLE_INDEX), { search: "?q=refactor" })],
};
