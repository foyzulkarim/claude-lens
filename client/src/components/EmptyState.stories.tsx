import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmptyState } from "./EmptyState.js";

const meta: Meta<typeof EmptyState> = {
  title: "Components/EmptyState",
  component: EmptyState,
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const MessageOnly: Story = {
  args: { message: "No data for the selected filters." },
};

export const WithAction: Story = {
  args: {
    message: "No data for the selected filters.",
    action: { label: "Reset filters", onClick: () => alert("filters reset") },
  },
};
