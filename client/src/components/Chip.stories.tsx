import type { Meta, StoryObj } from "@storybook/react-vite";
import { Chip } from "./Chip.js";

const meta: Meta<typeof Chip> = {
  title: "Components/Chip",
  component: Chip,
};

export default meta;
type Story = StoryObj<typeof Chip>;

export const Inactive: Story = { args: { label: "claude-lens" } };

export const Active: Story = { args: { label: "claude-lens", active: true, onClick: () => {} } };

export const Static: Story = { args: { label: "claude-sonnet-5" } };

export const Clickable: Story = {
  args: { label: "claude-sonnet-5", onClick: () => {} },
};

export const Removable: Story = {
  args: { label: "claude-lens", onClick: () => {}, onRemove: () => {} },
};
