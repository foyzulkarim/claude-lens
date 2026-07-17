import { createColumnHelper } from "@tanstack/react-table";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DataTable } from "./DataTable.js";

interface SessionRow {
  id: string;
  project: string;
  model: string;
  cost: number;
  calls: number;
}

// Real-world TanStack usage: `createColumnHelper` infers each accessor's own
// value type (string columns, number columns), which only type-checks against
// `DataTable`'s `columns` prop because it's `ColumnDef<T, any>[]` (T1) —
// `ColumnDef<T, unknown>[]` would reject this heterogeneous array.
const columnHelper = createColumnHelper<SessionRow>();

const columns = [
  columnHelper.accessor("project", { header: "Project" }),
  columnHelper.accessor("model", { header: "Model" }),
  columnHelper.accessor("calls", { header: "Calls", meta: { align: "right", mono: true } }),
  columnHelper.accessor("cost", {
    header: "Cost",
    meta: { align: "right", mono: true },
    cell: (info) => `$${info.getValue().toFixed(2)}`,
  }),
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
  args: { data: makeRows(6), columns, label: "Recent sessions" },
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

export const EmptyCustom: Story = {
  args: {
    data: [],
    columns,
    empty: <p className="p-6 text-center text-sm text-slate-400">No sessions match this filter.</p>,
  },
};

export const StableRowId: Story = {
  args: {
    data: makeRows(6),
    columns,
    getRowId: (row) => row.id,
    initialSorting: [{ id: "cost", desc: true }],
  },
};

export const RowClick: Story = {
  args: {
    data: makeRows(6),
    columns,
    onRowClick: (row) => alert(`clicked ${row.project}`),
    getRowActionLabel: (row) => `Open ${row.project} session`,
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
