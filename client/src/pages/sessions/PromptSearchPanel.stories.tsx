import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { SearchIndexResponse } from "../../../../shared/search-index-contract.js";
import { PromptSearchPanel } from "./PromptSearchPanel.js";

// PromptSearchPanel fetches the full prompt corpus via window.fetch, so each
// story stubs the global fetch to demonstrate the panel's display states
// (loading is simulated via a never-resolving Promise; the rest are direct
// fixtures). Same withFetch decorator pattern as
// dashboard/RecentSessionCard.stories.tsx.
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

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

// Combined helper that supports both a fetch impl and an initial URL —
// used by `WithResults` to seed the input with a query so the result
// list renders without typing.
function withSearchAndUrl(impl: () => Promise<Response>, search: string) {
  return function Decorator(Story: () => ReactElement) {
    const { hook, searchHook } = memoryLocation({ path: "/", searchPath: search, static: true });
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

const SAMPLE_DOCS = [
  {
    id: "s1:p1",
    sessionId: "s1",
    promptId: "p1",
    turnNumber: 1,
    text: "Search across the whole claude-lens history for any prompt I typed last month.",
    timestamp: "2026-07-15T10:00:00.000Z",
    cwd: "/Users/me/personal/claude-lens",
    gitBranch: "feat/search-index",
  },
  {
    id: "s1:p2",
    sessionId: "s1",
    promptId: "p2",
    turnNumber: 2,
    text: "Refactor the parser to handle partial trailing lines more carefully.",
    timestamp: "2026-07-15T10:05:00.000Z",
    cwd: "/Users/me/personal/claude-lens",
    gitBranch: "feat/search-index",
  },
  {
    id: "s2:p1",
    sessionId: "s2",
    promptId: "p1",
    turnNumber: 1,
    text: "How do I budget my Claude Code usage across a 5-hour subscription window?",
    timestamp: "2026-07-12T14:30:00.000Z",
    cwd: "/Users/me/personal/claude-lens",
    gitBranch: "main",
  },
];

const POPULATED: SearchIndexResponse = { prompts: SAMPLE_DOCS, version: 1 };
const EMPTY: SearchIndexResponse = { prompts: [], version: 1 };

const meta: Meta<typeof PromptSearchPanel> = {
  title: "Sessions/PromptSearchPanel",
  component: PromptSearchPanel,
};

export default meta;
type Story = StoryObj<typeof PromptSearchPanel>;

export const Loading: Story = {
  decorators: [withFetch(() => new Promise<Response>(() => {}) as unknown as Promise<Response>)],
};

export const Empty: Story = {
  decorators: [withFetch(() => jsonResponse(EMPTY))],
};

export const Idle: Story = {
  decorators: [withFetch(() => jsonResponse(POPULATED))],
};

export const ErrorState: Story = {
  decorators: [withFetch(() => jsonResponse({ error: "internal server error" }, 500))],
};

export const WithResults: Story = {
  decorators: [withSearchAndUrl(() => jsonResponse(POPULATED), "?q=refactor")],
};
