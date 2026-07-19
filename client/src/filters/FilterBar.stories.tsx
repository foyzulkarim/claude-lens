import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { FilterBar } from "./FilterBar.js";

// FilterBar reads/writes filter state via wouter hooks (useFilters), which
// read the real browser URL by default. memoryLocation() gives each story
// its own isolated location + search, independent of the Storybook iframe's
// actual address bar. Opening a chip dropdown fires a real /api/metrics
// fetch (useFacets) — with no dev server behind Storybook that surfaces the
// isError state, which is itself a valid demonstration of that checklist
// item; the loaded-options states are verified against the live app instead
// (see task T2's manual verification checklist).
function withSearch(search: string) {
  return function Decorator(Story: () => ReactElement) {
    const { hook, searchHook } = memoryLocation({ path: "/", searchPath: search, static: true });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={queryClient}>
        <Router hook={hook} searchHook={searchHook}>
          <Story />
        </Router>
      </QueryClientProvider>
    );
  };
}

const meta: Meta<typeof FilterBar> = {
  title: "Filters/FilterBar",
  component: FilterBar,
};

export default meta;
type Story = StoryObj<typeof FilterBar>;

export const Default: Story = {
  decorators: [withSearch("")],
};

export const ActiveFilters: Story = {
  decorators: [withSearch("?range=30d&project=claude-lens,claude-code&model=claude-sonnet-5")],
};

export const CustomRange: Story = {
  decorators: [withSearch("?from=2026-07-01&to=2026-07-10")],
};
