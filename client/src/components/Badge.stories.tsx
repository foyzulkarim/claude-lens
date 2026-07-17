import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./Badge.js";

const meta: Meta<typeof Badge> = {
  title: "Components/Badge",
  component: Badge,
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Neutral: Story = { args: { variant: "neutral", children: "neutral" } };
export const Pass: Story = { args: { variant: "pass", children: "pass" } };
export const Warn: Story = { args: { variant: "warn", children: "warn" } };
export const Fail: Story = { args: { variant: "fail", children: "fail" } };
export const Computed: Story = { args: { variant: "computed", children: "$ computed" } };
export const Premium: Story = { args: { variant: "premium", children: "premium" } };

export const AllVariants: Story = {
  render: () => (
    <div className="flex gap-2">
      <Badge variant="neutral">neutral</Badge>
      <Badge variant="pass">pass</Badge>
      <Badge variant="warn">warn</Badge>
      <Badge variant="fail">fail</Badge>
      <Badge variant="computed">computed</Badge>
      <Badge variant="premium">premium</Badge>
    </div>
  ),
};
