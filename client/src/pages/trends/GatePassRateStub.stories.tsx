import type { Meta, StoryObj } from "@storybook/react-vite";
import { GatePassRateStub } from "./GatePassRateStub.js";

const meta: Meta<typeof GatePassRateStub> = {
  title: "Trends/GatePassRateStub",
  component: GatePassRateStub,
};

export default meta;
type Story = StoryObj<typeof GatePassRateStub>;

export const Default: Story = {};
