import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import type { SessionDetailPrompt } from "../../../../shared/session-detail-contract.js";
import { DataTable } from "../../components/DataTable.js";

export interface PromptListProps {
  prompts: SessionDetailPrompt[];
}

/**
 * Ordered prompt history (#P4-5, T9). One row per logical turn, in stable
 * chronological order (the server's projector guarantees this — every
 * prompt is keyed by its promptId and ordered by turnNumber). Long text
 * is rendered verbatim; the panel uses a max-height with overflow auto so
 * the page width doesn't break for long inputs.
 *
 * Privacy boundary (architecture A7 + R7): the renderer never reaches for
 * derived path/command fields because the projector doesn't include them
 * on the wire. Even if those fields existed, the panel would not display
 * them — it shows only `text` + `timestamp` from the contract.
 */
export function PromptList({ prompts }: PromptListProps): React.JSX.Element {
  const columns = useMemo<ColumnDef<SessionDetailPrompt>[]>(
    () => [
      {
        header: "turn",
        accessorKey: "turnNumber",
        cell: ({ getValue }) => `#${getValue<number>()}`,
        meta: { mono: true },
      },
      {
        header: "timestamp",
        accessorKey: "timestamp",
        cell: ({ getValue }) => getValue<string>().slice(0, 16).replace("T", " "),
        meta: { mono: true },
      },
      {
        header: "prompt",
        accessorKey: "text",
        cell: ({ getValue }) => (
          <span className="whitespace-pre-wrap break-words">
            {getValue<string>() || "(empty prompt)"}
          </span>
        ),
      },
    ],
    [],
  );
  if (prompts.length === 0) {
    return (
      <section
        aria-label="Prompt list"
        data-testid="session-detail-prompts"
        className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Prompts</h2>
        <p className="mt-3 text-xs text-slate-500 dark:text-[#8A96A5]">
          No typed prompts recorded yet.
        </p>
      </section>
    );
  }
  return (
    <section
      aria-label="Prompt list"
      data-testid="session-detail-prompts"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Prompts</h2>
      <div className="mt-3 max-h-72 overflow-auto">
        <DataTable
          data={prompts}
          columns={columns}
          getRowId={(prompt) => prompt.promptId}
          label="Ordered prompts"
        />
      </div>
    </section>
  );
}
