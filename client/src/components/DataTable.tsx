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
  initialSorting?: SortingState;
  getRowId?: (row: T) => string;
  /** Accessible name for the `<table>` — distinguishes it for screen-reader table navigation. */
  label?: string;
}

type DataTableRowActionProps<T> =
  | { onRowClick?: undefined; getRowActionLabel?: never }
  | {
      onRowClick: (row: T) => void;
      /** Accessible name for the real action button rendered in each clickable row. */
      getRowActionLabel: (row: T) => string;
    };

/**
 * Opt-in controlled/manual sorting (ARCH A8 — Sessions page server-side
 * sort + pagination). The default path keeps the existing internal
 * `useState<SortingState>` behavior — callers that opt into `manualSorting`
 * own the sort state and receive change notifications via
 * `onSortingChange`. This is the additive prop pattern (discriminated
 * union) so existing callers stay type-compatible.
 */
type DataTableSortingProps =
  | {
      manualSorting?: false;
      sorting?: never;
      onSortingChange?: never;
    }
  | {
      /** Server-controlled sort — caller owns the state. */
      manualSorting: true;
      sorting: SortingState;
      onSortingChange: (next: SortingState | ((prev: SortingState) => SortingState)) => void;
    };

// `height` is required whenever `virtualized` is true (ARCH R3/A5) — the
// virtualizer needs a bounded scroll viewport to know which rows are visible.
export type DataTableProps<T> = DataTableBaseProps<T> &
  DataTableRowActionProps<T> &
  DataTableSortingProps &
  ({ virtualized: true; height: number } | { virtualized?: false; height?: never });

const ESTIMATED_ROW_HEIGHT = 36;
const SKELETON_ROW_COUNT = 5;

function DataTableRow<T>({
  row,
  onRowClick,
  getRowActionLabel,
  rowIndex,
}: {
  row: Row<T>;
  onRowClick?: (row: T) => void;
  getRowActionLabel?: (row: T) => string;
  /** 1-based logical row position (header row is 1) — lets AT announce true position under virtualization (A2). */
  rowIndex?: number;
}) {
  return (
    <tr
      // Mouse convenience only. Interactive descendants keep their own behavior;
      // the separate button in the first cell is the canonical keyboard action.
      onClick={
        onRowClick
          ? (event) => {
              const target = event.target;
              if (
                target instanceof Element &&
                target.closest("a, button, input, select, textarea, [role='button'], [role='link']")
              ) {
                return;
              }
              onRowClick(row.original);
            }
          : undefined
      }
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
            {onRowClick && getRowActionLabel && index === 0 ? (
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 flex-1">{content}</div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRowClick(row.original);
                  }}
                  aria-label={getRowActionLabel(row.original)}
                  className="shrink-0 rounded px-1 text-slate-600 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600 dark:text-[#8A96A5] dark:hover:text-[#E8EDF2] dark:focus-visible:outline-[#4FC3D9]"
                >
                  <span aria-hidden="true">→</span>
                </button>
              </div>
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
  getRowActionLabel,
  initialSorting,
  getRowId,
  label,
  manualSorting,
  sorting: controlledSorting,
  onSortingChange,
}: DataTableProps<T>) {
  // Controlled path: caller owns `sorting` + `onSortingChange`; we just
  // pass them through. Default path: internal `useState` for the
  // uncontrolled consumers (preserves pre-controlled behavior — review
  // #18 pattern: any caller passing `manualSorting` controls sort,
  // everyone else gets the existing internal behavior).
  const [internalSorting, setInternalSorting] = useState<SortingState>(initialSorting ?? []);
  const sorting = manualSorting ? controlledSorting : internalSorting;
  const handleSortingChange = manualSorting ? onSortingChange : setInternalSorting;
  const [showAllRows, setShowAllRows] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: handleSortingChange,
    getCoreRowModel: getCoreRowModel(),
    // Server-controlled sorting path: TanStack still calls its own sort
    // model unless `manualSorting` is set on the table config. Without
    // this, a caller who passes `sorting={[...]}` would see TanStack
    // re-sort `data` locally too, breaking the "caller owns the order"
    // contract.
    manualSorting,
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getRowId,
  });

  const rows = table.getRowModel().rows;

  const isVirtualized = Boolean(virtualized && !showAllRows);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    enabled: isVirtualized,
  });

  const virtualItems = isVirtualized ? virtualizer.getVirtualItems() : [];
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
    <>
      {virtualized ? (
        <button
          type="button"
          onClick={() => setShowAllRows((current) => !current)}
          className="sr-only rounded px-2 py-1 text-sm focus:not-sr-only focus:mb-2 focus:inline-flex focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-slate-600 dark:text-[#E8EDF2] dark:focus:outline-[#4FC3D9]"
        >
          {showAllRows ? "Use virtualized rows" : `Show all ${rows.length} rows`}
        </button>
      ) : null}
      <div ref={scrollRef} style={isVirtualized ? { height, overflow: "auto" } : undefined}>
        <table
          aria-label={label}
          aria-rowcount={isVirtualized ? ariaRowCount : undefined}
          className="w-full border-collapse text-sm"
        >
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} aria-rowindex={isVirtualized ? 1 : undefined}>
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
                        "border-b border-slate-200 p-2 text-left text-[10px] uppercase tracking-wider text-slate-600 dark:border-[#232B36] dark:text-[#8A96A5]",
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
            ) : isVirtualized ? (
              <>
                {paddingTop > 0 && (
                  // biome-ignore lint/a11y/noAriaHiddenOnFocusable: virtualizer spacer row has no focus behavior and must stay out of the accessibility tree
                  <tr aria-hidden="true">
                    <td colSpan={colCount} style={{ height: paddingTop }} />
                  </tr>
                )}
                {virtualItems.map((virtualRow) => (
                  <DataTableRow
                    key={rows[virtualRow.index].id}
                    row={rows[virtualRow.index]}
                    onRowClick={onRowClick}
                    getRowActionLabel={getRowActionLabel}
                    rowIndex={virtualRow.index + 2}
                  />
                ))}
                {paddingBottom > 0 && (
                  // biome-ignore lint/a11y/noAriaHiddenOnFocusable: virtualizer spacer row has no focus behavior and must stay out of the accessibility tree
                  <tr aria-hidden="true">
                    <td colSpan={colCount} style={{ height: paddingBottom }} />
                  </tr>
                )}
              </>
            ) : (
              rows.map((row) => (
                <DataTableRow
                  key={row.id}
                  row={row}
                  onRowClick={onRowClick}
                  getRowActionLabel={getRowActionLabel}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
