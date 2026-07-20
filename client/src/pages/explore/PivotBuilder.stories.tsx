import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { PivotBuilder } from "./PivotBuilder.js";
import { DEFAULT_PIVOT, type PivotChart, type PivotMode, type PivotState } from "./state.js";

// Storybook state coverage for the Explore page pivot builder
// (ARCH-explore-page.md §11; specs/claude-lens-pages.md §11 — Phase 4
// standing rule "Component states covered in Storybook (not Cypress)").
// We exercise six distinct pivot configurations so each state is
// visually verifiable in isolation. Setters are no-ops — these stories
// are about visual state coverage, not interaction (interaction is
// covered by the RTL test in Explore.test.tsx).

function withProviders() {
  return function Decorator(Story: () => ReactElement) {
    const { hook, searchHook } = memoryLocation({ path: "/explore", static: true });
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

const NOOP_MEASURE: (m: PivotState["measure"]) => void = () => undefined;
const NOOP_DIM: (d: PivotState["dim"]) => void = () => undefined;
const NOOP_GRAIN: (g: PivotState["grain"]) => void = () => undefined;
const NOOP_CHART: (c: PivotChart) => void = () => undefined;
const NOOP_MODE: (m: PivotMode) => void = () => undefined;
const NOOP_ENTITY: (e: PivotState["entity"]) => void = () => undefined;
const NOOP_X: (x: PivotState["x"]) => void = () => undefined;
const NOOP_Y: (y: PivotState["y"]) => void = () => undefined;
const NOOP_SIZE: (s: PivotState["size"] | undefined) => void = () => undefined;

const meta: Meta<typeof PivotBuilder> = {
  title: "Explore/PivotBuilder",
  component: PivotBuilder,
  decorators: [withProviders()],
};
export default meta;

type Story = StoryObj<typeof PivotBuilder>;

function StoryForState(overrides: Partial<PivotState>): ReactElement {
  const state: PivotState = { ...DEFAULT_PIVOT, ...overrides };
  return (
    <PivotBuilder
      state={state}
      onMeasureChange={NOOP_MEASURE}
      onDimChange={NOOP_DIM}
      onGrainChange={NOOP_GRAIN}
      onChartChange={NOOP_CHART}
      onModeChange={NOOP_MODE}
      onEntityChange={NOOP_ENTITY}
      onXChange={NOOP_X}
      onYChange={NOOP_Y}
      onSizeChange={NOOP_SIZE}
    />
  );
}

export const Default: Story = {
  render: () => StoryForState({}),
};

export const LineChart: Story = {
  render: () => StoryForState({ chart: "line" }),
};

export const AreaChart: Story = {
  render: () => StoryForState({ chart: "area" }),
};

export const TableView: Story = {
  render: () => StoryForState({ chart: "table" }),
};

export const ScatterChart: Story = {
  render: () => StoryForState({ chart: "scatter" }),
};

export const DistributionMode: Story = {
  render: () => StoryForState({ mode: "distribution" }),
};
