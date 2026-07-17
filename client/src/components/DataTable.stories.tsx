import type { ColumnDef } from "@tanstack/react-table";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DataTable } from "./DataTable.js";

interface SessionRow {
  id: string;
  project: string;
  model: string;
  cost: number;
  calls: number;
}

const columns: ColumnDef<SessionRow, unknown>[] = [
  { accessorKey: "project", header: "Project" },
  { accessorKey: "model", header: "Model" },
  { accessorKey: "calls", header: "Calls", meta: { align: "right", mono: true } },
  {
    accessorKey: "cost",
    header: "Cost",
    meta: { align: "right", mono: true },
    cell: (info) => `$${(info.getValue() as number).toFixed(2)}`,
  },
];

function makeRows(count: number): SessionRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    project: ["claude-lens", "claude-code", "internal-tools"][i % 3],
    model: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"][i % 3],
    cost: Math.round((i * 1.37 + 2) * 100) / 100,
    calls: 10 + i,
  }));
}

const meta: Meta<typeof DataTable<SessionRow>> = {
  title: "Components/DataTable",
  component: DataTable<SessionRow>,
};

export default meta;
type Story = StoryObj<typeof DataTable<SessionRow>>;

export const Plain: Story = {
  args: { data: makeRows(6), columns },
};

export const Sorted: Story = {
  args: { data: makeRows(6), columns, initialSorting: [{ id: "cost", desc: true }] },
};

export const Loading: Story = {
  args: { data: [], columns, isLoading: true },
};

export const Empty: Story = {
  args: { data: [], columns },
};

export const RowClick: Story = {
  args: {
    data: makeRows(6),
    columns,
    onRowClick: (row) => alert(`clicked ${row.project}`),
  },
};

export const Virtualized: Story = {
  args: {
    data: makeRows(1000),
    columns,
    virtualized: true,
    height: 400,
  },
};
