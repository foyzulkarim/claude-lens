import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ScanRootsEditor } from "./ScanRootsEditor.js";

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

const meta: Meta<typeof ScanRootsEditor> = {
  title: "Settings/ScanRootsEditor",
  component: ScanRootsEditor,
};

export default meta;
type Story = StoryObj<typeof ScanRootsEditor>;

export const EmptyConfigShowsDefaultHint: Story = {
  decorators: [withFetch(() => jsonResponse({ budget: null }))],
};

export const LabeledRootsRender: Story = {
  decorators: [
    withFetch(() =>
      jsonResponse({
        budget: null,
        scanRoots: [
          { path: "/Users/me/.claude/projects", label: "mac-mini" },
          { path: "/mnt/work/projects", label: "workstation" },
        ],
      }),
    ),
  ],
};

export const UnlabeledRootsRender: Story = {
  decorators: [
    withFetch(() =>
      jsonResponse({
        budget: null,
        scanRoots: [{ path: "/srv/claude" }],
      }),
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
