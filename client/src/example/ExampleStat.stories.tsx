import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExampleStat } from "./ExampleStat.js";

const meta: Meta<typeof ExampleStat> = {
  title: "Workbench/ExampleStat",
  component: ExampleStat,
};

export default meta;
type Story = StoryObj<typeof ExampleStat>;

export const Cost: Story = {
  args: { label: "Total cost", value: "$18.42", accent: "money" },
};

export const CacheHitRate: Story = {
  args: { label: "Cache hit rate", value: "87%", accent: "cache" },
};
