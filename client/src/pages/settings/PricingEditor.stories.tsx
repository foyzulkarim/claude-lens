import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AppConfig } from "../../../../shared/settings-contract.js";
import { PricingEditor } from "./PricingEditor.js";

// Storybook has no dev server, so every fetch-touching component gets a
// stub-fetch + QueryClientProvider + wouter memoryLocation decorator (same
// pattern as BurnRateCard.stories.tsx). The decorator is local to each
// storybook file rather than shared — Storybook's recommended decorator
// pattern is per-file so each story declares its own context needs.
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

function configWith(overrides: Partial<AppConfig> = {}): AppConfig {
  return { budget: 300, ...overrides };
}

const meta: Meta<typeof PricingEditor> = {
  title: "Settings/PricingEditor",
  component: PricingEditor,
};

export default meta;
type Story = StoryObj<typeof PricingEditor>;

export const EmptyConfigSeedsKnownModels: Story = {
  decorators: [withFetch(() => jsonResponse({ budget: null }))],
};

export const SavedPricingRenders: Story = {
  decorators: [
    withFetch(() =>
      jsonResponse(
        configWith({
          pricing: {
            "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
            "claude-opus-4-8": { input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
          },
        }),
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
