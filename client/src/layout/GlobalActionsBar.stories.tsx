import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { GlobalActionsBar } from "./GlobalActionsBar.js";

// Same memoryLocation isolation pattern as FilterBar.stories.tsx — the
// component reads its route/search via wouter hooks, so each story gets
// its own independent location.
function withLocation(path: string, search = "") {
  return function Decorator(Story: () => ReactElement) {
    // wouter's memoryLocation joins `path + "?" + searchPath` itself — a
    // leading "?" in `search` produces a literal "??" and silently drops
    // the query (call sites read more naturally with it, so strip here).
    const searchPath = search.startsWith("?") ? search.slice(1) : search;
    const { hook, searchHook } = memoryLocation({ path, searchPath, static: true });
    return (
      <Router hook={hook} searchHook={searchHook}>
        <Story />
      </Router>
    );
  };
}

const meta: Meta<typeof GlobalActionsBar> = {
  title: "Layout/GlobalActionsBar",
  component: GlobalActionsBar,
};

export default meta;
type Story = StoryObj<typeof GlobalActionsBar>;

export const OnSessionsPage: Story = {
  decorators: [withLocation("/sessions", "?range=30d")],
};

export const OnOtherPage: Story = {
  decorators: [withLocation("/", "?range=30d")],
};
