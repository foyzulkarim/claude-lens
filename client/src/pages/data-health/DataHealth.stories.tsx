import type { Meta, StoryObj } from "@storybook/react-vite";
import { DataHealth } from "./DataHealth.js";
import { emptySnapshot, populatedSnapshot } from "./DataHealth.fixtures.js";

/**
 * Storybook coverage for the Data Health page (#P4-14). One
 * `snapshot` prop is enough to drive every panel — the page is a
 * pure derivation of `HealthSnapshot`. The `Empty` and `Populated`
 * variants pin the locked-vs-data states the Cypress smoke can't
 * deterministically reproduce.
 *
 * Fixtures are sourced from `DataHealth.fixtures.ts` (review Q-010)
 * so the test + Storybook fixture definitions never drift — a new
 * `HealthSnapshot` field only needs to be added in one place.
 *
 * The page's `useHealthQuery({ enabled: snapshot === undefined })`
 * (review TC-5) suppresses the network fetch when a snapshot is
 * injected, so no `QueryClientProvider` decorator is needed for
 * these stories.
 */

const meta = {
  title: "Pages/DataHealth",
  component: DataHealth,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DataHealth>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { snapshot: emptySnapshot() },
};

export const Populated: Story = {
  args: { snapshot: populatedSnapshot() },
};
