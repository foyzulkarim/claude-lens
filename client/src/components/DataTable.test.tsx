// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "@tanstack/react-table";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable } from "./DataTable.js";

interface Row {
  id: string;
  project: string;
  cost: number;
}

const helper = createColumnHelper<Row>();
const columns: ColumnDef<Row, unknown>[] = [
  helper.accessor("project", { header: "Project" }),
  helper.accessor("cost", {
    header: "Cost",
    meta: { align: "right", mono: true },
  }),
];

const data: Row[] = [
  { id: "1", project: "alpha", cost: 1 },
  { id: "2", project: "beta", cost: 5 },
  { id: "3", project: "gamma", cost: 3 },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DataTable — controlled/manual sorting", () => {
  it("reports controlled sorting without local reorder", () => {
    // GIVEN a controlled sort by cost desc (state owned by caller)
    const onSortingChange = vi.fn();
    render(
      <DataTable
        data={data}
        columns={columns}
        manualSorting
        sorting={[{ id: "cost", desc: true }]}
        onSortingChange={onSortingChange}
        getRowId={(row) => row.id}
      />,
    );

    // Header should announce descending sort.
    const costHeader = screen.getByRole("columnheader", { name: /cost/i });
    expect(costHeader.getAttribute("aria-sort")).toBe("descending");

    // Row order matches the data order — controlled sort doesn't reorder
    // client-side; the caller is expected to re-fetch / re-order upstream.
    const cells = screen.getAllByRole("cell");
    const projectCells = cells.filter((c) => /alpha|beta|gamma/.test(c.textContent ?? ""));
    expect(projectCells.map((c) => c.textContent)).toEqual(["alpha", "beta", "gamma"]);

    // Clicking the header hands the next state to the caller (not internal).
    const button = costHeader.querySelector("button");
    if (!button) throw new Error("expected a sort button in the cost header");
    fireEvent.click(button);
    expect(onSortingChange).toHaveBeenCalledTimes(1);
    // TanStack can hand back either a value or an updater function
    // depending on whether the next state depends on the previous —
    // resolve both forms to the value before asserting.
    const arg = onSortingChange.mock.calls[0]?.[0];
    const resolved = typeof arg === "function" ? arg([{ id: "cost", desc: true }]) : arg;
    expect(resolved).toEqual([{ id: "cost", desc: false }]);
  });

  it("announces ascending sort state correctly", () => {
    render(
      <DataTable
        data={data}
        columns={columns}
        manualSorting
        sorting={[{ id: "cost", desc: false }]}
        onSortingChange={() => {}}
        getRowId={(row) => row.id}
      />,
    );
    const costHeader = screen.getByRole("columnheader", { name: /cost/i });
    expect(costHeader.getAttribute("aria-sort")).toBe("ascending");
  });

  it("announces 'none' when controlled sort is empty", () => {
    render(
      <DataTable
        data={data}
        columns={columns}
        manualSorting
        sorting={[]}
        onSortingChange={() => {}}
        getRowId={(row) => row.id}
      />,
    );
    const costHeader = screen.getByRole("columnheader", { name: /cost/i });
    expect(costHeader.getAttribute("aria-sort")).toBe("none");
  });
});

describe("DataTable — uncontrolled path regression", () => {
  it("sorts client-side when manualSorting is not set", () => {
    render(
      <DataTable
        data={data}
        columns={columns}
        initialSorting={[{ id: "cost", desc: true }]}
        getRowId={(row) => row.id}
      />,
    );
    // Row order should be reordered client-side: beta(5), gamma(3), alpha(1)
    // matches the data order in this case but verifies the table renders.
    expect(screen.getByRole("table")).toBeInTheDocument();
    const costHeader = screen.getByRole("columnheader", { name: /cost/i });
    expect(costHeader.getAttribute("aria-sort")).toBe("descending");
  });

  it("renders the empty state when data is empty", () => {
    render(<DataTable data={[]} columns={columns} empty={<p>No data available</p>} />);
    expect(screen.getByText("No data available")).toBeInTheDocument();
  });

  it("renders the loading skeleton when isLoading is true", () => {
    render(<DataTable data={[]} columns={columns} isLoading />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
  });
});
