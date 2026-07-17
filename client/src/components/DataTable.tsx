import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type Row,
  type RowData,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { EmptyState } from "./EmptyState.js";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "right";
    mono?: boolean;
  }
}

interface DataTableBaseProps<T> {
  data: T[];
  // Mirrors TanStack's own `TableOptions.columns: ColumnDef<TData, any>[]` —
  // `ColumnDef` is invariant in `TValue`, so a heterogeneous column array
  // (string/number accessors) can only be typed with `any` here, not `unknown`.
  // biome-ignore lint/suspicious/noExplicitAny: intentional, matches upstream TanStack contract
  columns: ColumnDef<T, any>[];
  isLoading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  initialSorting?: SortingState;
  getRowId?: (row: T) => string;
  /** Accessible name for the `<table>` — distinguishes it for screen-reader table navigation. */
  label?: string;
}

// `height` is required whenever `virtualized` is true (ARCH R3/A5) — the
// virtualizer needs a bounded scroll viewport to know which rows are visible.
export type DataTableProps<T> = DataTableBaseProps<T> &
  ({ virtualized: true; height: number } | { virtualized?: false; height?: never });

const ESTIMATED_ROW_HEIGHT = 36;
const SKELETON_ROW_COUNT = 5;

function DataTableRow<T>({
  row,
  onRowClick,
  rowIndex,
}: {
  row: Row<T>;
  onRowClick?: (row: T) => void;
  /** 1-based logical row position (header row is 1) — lets AT announce true position under virtualization (A2). */
  rowIndex?: number;
}) {
  return (
    <tr
      // Mouse convenience only — the canonical, keyboard-operable action lives
      // in a real <button> in the first cell (A1) so <tr>/<td> keep native
      // table row/cell semantics instead of being flattened by role="button".
      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
      aria-rowindex={rowIndex}
      className={clsx(onRowClick && "cursor-pointer")}
    >
      {row.getVisibleCells().map((cell, index) => {
        const meta = cell.column.columnDef.meta;
        const content = flexRender(cell.column.columnDef.cell, cell.getContext());
        return (
          <td
            key={cell.id}
            className={clsx(
              "border-b border-slate-100 p-2 dark:border-[#232B36]",
              meta?.align === "right" && "text-right",
              meta?.mono && "font-mono tabular-nums",
            )}
          >
            {onRowClick && index === 0 ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRowClick(row.original);
                }}
                className="block w-full appearance-none bg-transparent p-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-600 dark:focus-visible:outline-[#4FC3D9]"
              >
                {content}
              </button>
            ) : (
              content
            )}
          </td>
        );
      })}
    </tr>
  );
}

export function DataTable<T>({
  data,
  columns,
  isLoading,
  empty,
  virtualized,
  height,
  onRowClick,
  initialSorting,
  getRowId,
  label,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting ?? []);
  const scrollRef = useRef<HTMLDivElement>(null);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId,
  });

  const rows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    enabled: Boolean(virtualized),
  });

  const virtualItems = virtualized ? virtualizer.getVirtualItems() : [];
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0;

  const colCount = table.getFlatHeaders().length;
  // Logical row count for AT under virtualization (A2) — header row + every
  // data row, independent of how many are actually mounted in the DOM.
  const ariaRowCount = rows.length + 1;

  return (
    <div ref={scrollRef} style={virtualized ? { height, overflow: "auto" } : undefined}>
      <table
        aria-label={label}
        aria-rowcount={virtualized ? ariaRowCount : undefined}
        className="w-full border-collapse text-sm"
      >
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} aria-rowindex={virtualized ? 1 : undefined}>
              {headerGroup.headers.map((header) => {
                const align = header.column.columnDef.meta?.align;
                const sortable = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                const headerContent = flexRender(
                  header.column.columnDef.header,
                  header.getContext(),
                );
                return (
                  <th
                    key={header.id}
                    aria-sort={
                      sortable
                        ? sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : "none"
                        : undefined
                    }
                    className={clsx(
                      "border-b border-slate-200 p-2 text-left text-[10px] uppercase tracking-wider text-slate-600 dark:border-[#232B36] dark:text-[#5A6675]",
                      align === "right" && "text-right",
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1"
                      >
                        {headerContent}
                        {sorted === "asc" && <span aria-hidden="true">▲</span>}
                        {sorted === "desc" && <span aria-hidden="true">▼</span>}
                      </button>
                    ) : (
                      headerContent
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {isLoading ? (
            <>
              <tr>
                <td colSpan={colCount} className="p-0">
                  <span role="status" className="sr-only">
                    Loading…
                  </span>
                </td>
              </tr>
              {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows have no identity
                <tr key={i}>
                  <td colSpan={colCount} className="p-2" aria-hidden="true">
                    <div className="h-4 animate-pulse rounded bg-slate-100 dark:bg-[#232B36]" />
                  </td>
                </tr>
              ))}
            </>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={colCount}>
                <div role="status">{empty ?? <EmptyState message="No data" />}</div>
              </td>
            </tr>
          ) : virtualized ? (
            <>
              {paddingTop > 0 && (
                <tr>
                  <td colSpan={colCount} style={{ height: paddingTop }} aria-hidden="true" />
                </tr>
              )}
              {virtualItems.map((virtualRow) => (
                <DataTableRow
                  key={rows[virtualRow.index].id}
                  row={rows[virtualRow.index]}
                  onRowClick={onRowClick}
                  rowIndex={virtualRow.index + 2}
                />
              ))}
              {paddingBottom > 0 && (
                <tr>
                  <td colSpan={colCount} style={{ height: paddingBottom }} aria-hidden="true" />
                </tr>
              )}
            </>
          ) : (
            rows.map((row) => <DataTableRow key={row.id} row={row} onRowClick={onRowClick} />)
          )}
        </tbody>
      </table>
    </div>
  );
}
