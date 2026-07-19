import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { getTags } from "../../api/localStore.js";
import { qk } from "../../api/queryKeys.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import type { SessionsPageState } from "./state.js";

export interface TagsSectionProps {
  state: SessionsPageState;
  onStateChange: (patch: Partial<SessionsPageState>) => void;
}

/**
 * Tags filter section (#P4-15) — the mount point `TagsStub` reserved.
 * Lists every tag currently in use (fleet-wide, via `GET /api/tags`) as
 * toggle chips; selecting one or more filters the table above to sessions
 * carrying at least one selected tag (`SessionBrowser`'s client-side
 * filter — tags aren't a server-side population dimension). Tags
 * themselves are created inline on table rows (`TagsCell` in
 * `SessionBrowser.tsx`); renaming/deleting a tag fleet-wide is a Settings
 * page action.
 */
export function TagsSection({ state, onStateChange }: TagsSectionProps) {
  const query = useQuery({
    queryKey: qk.tags(),
    queryFn: ({ signal }) => getTags(signal),
  });

  const selected = state.tags ?? [];

  function toggle(tag: string): void {
    const next = selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag];
    onStateChange({ tags: next.length > 0 ? next : undefined });
  }

  return (
    <section
      data-testid="tags-section"
      aria-label="Tags"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Tags</h2>

      {query.isPending && (
        <p className="mt-2 text-sm text-slate-500 dark:text-[#8B98A9]">Loading…</p>
      )}
      {query.isError && (
        <p role="alert" className="mt-2 text-sm text-[#B23A3A] dark:text-[#E05252]">
          {query.error.message}
        </p>
      )}
      {!query.isPending && !query.isError && query.data.length === 0 && (
        <p className="mt-2 text-sm text-slate-600 dark:text-[#8A96A5]">
          No tags yet — add one from the Tags column in the table above.
        </p>
      )}
      {!query.isPending && !query.isError && query.data.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {query.data.map(({ tag, sessionCount }) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggle(tag)}
              className={clsx(TOGGLE_CLASS, selected.includes(tag) && TOGGLE_ACTIVE_CLASS)}
            >
              {tag} ({sessionCount})
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
