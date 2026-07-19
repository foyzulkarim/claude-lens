import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { deleteTag, deleteView, getTags, getViews, renameTag } from "../../api/localStore.js";
import { qk } from "../../api/queryKeys.js";
import { TOGGLE_CLASS } from "../../ui/toggleStyles.js";

/**
 * Saved views + tags manager (#P4-15, pages spec §10 — combined panel per
 * the requirements interview since the mockup omits both entirely).
 * Creation happens elsewhere (views: FilterBar's "Save view" button; tags:
 * the inline editor on Sessions table rows) — this panel is list + delete
 * for views, and list + rename/delete for tags.
 */
export function SavedViewsTagsPanel() {
  const queryClient = useQueryClient();

  const viewsQuery = useQuery({ queryKey: qk.views(), queryFn: ({ signal }) => getViews(signal) });
  const tagsQuery = useQuery({ queryKey: qk.tags(), queryFn: ({ signal }) => getTags(signal) });

  const deleteViewMutation = useMutation({
    mutationFn: (id: string) => deleteView(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.prefixes.views }),
  });

  const deleteTagMutation = useMutation({
    mutationFn: (tag: string) => deleteTag(tag),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.prefixes.tags }),
  });

  const renameTagMutation = useMutation({
    mutationFn: (input: { oldName: string; newName: string }) =>
      renameTag(input.oldName, input.newName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.prefixes.tags }),
  });

  function handleRename(oldName: string): void {
    const newName = window.prompt(`Rename tag "${oldName}" to`, oldName);
    if (!newName || newName.trim().length === 0 || newName.trim() === oldName) return;
    renameTagMutation.mutate({ oldName, newName: newName.trim() });
  }

  return (
    <section
      data-testid="saved-views-tags-panel"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
        Saved views &amp; tags
      </h2>

      <div className="mt-3">
        <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-[#8A96A5]">
          Saved views
        </h3>
        {viewsQuery.isPending && (
          <p role="status" className="mt-1 text-xs text-slate-500 dark:text-[#8B98A9]">
            Loading…
          </p>
        )}
        {viewsQuery.isError && (
          <p role="alert" className="mt-1 text-xs text-[#B23A3A] dark:text-[#E05252]">
            {viewsQuery.error.message}
          </p>
        )}
        {!viewsQuery.isPending && !viewsQuery.isError && viewsQuery.data.length === 0 && (
          <p className="mt-1 text-xs text-slate-500 dark:text-[#8B98A9]">
            No saved views yet — use "☆ Save view" in the filter bar above.
          </p>
        )}
        {!viewsQuery.isPending && !viewsQuery.isError && viewsQuery.data.length > 0 && (
          <ul className="mt-1">
            {viewsQuery.data.map((view) => (
              <li
                key={view.id}
                className="flex items-center justify-between gap-2 border-t border-slate-100 py-1.5 text-xs dark:border-[#232B36]"
              >
                <Link
                  href={`${view.path}${view.search}`}
                  className="text-[#96631E] dark:text-[#E8A33D]"
                >
                  {view.name}
                </Link>
                <button
                  type="button"
                  onClick={() => deleteViewMutation.mutate(view.id)}
                  aria-label={`Delete saved view ${view.name}`}
                  className={TOGGLE_CLASS}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-[#8A96A5]">
          Tags
        </h3>
        {tagsQuery.isPending && (
          <p role="status" className="mt-1 text-xs text-slate-500 dark:text-[#8B98A9]">
            Loading…
          </p>
        )}
        {tagsQuery.isError && (
          <p role="alert" className="mt-1 text-xs text-[#B23A3A] dark:text-[#E05252]">
            {tagsQuery.error.message}
          </p>
        )}
        {!tagsQuery.isPending && !tagsQuery.isError && tagsQuery.data.length === 0 && (
          <p className="mt-1 text-xs text-slate-500 dark:text-[#8B98A9]">
            No tags yet — add one from the Tags column on the Sessions page.
          </p>
        )}
        {!tagsQuery.isPending && !tagsQuery.isError && tagsQuery.data.length > 0 && (
          <ul className="mt-1">
            {tagsQuery.data.map(({ tag, sessionCount }) => (
              <li
                key={tag}
                className="flex items-center justify-between gap-2 border-t border-slate-100 py-1.5 text-xs dark:border-[#232B36]"
              >
                <span>
                  {tag} <span className="text-slate-400">({sessionCount})</span>
                </span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => handleRename(tag)}
                    aria-label={`Rename tag ${tag}`}
                    className={TOGGLE_CLASS}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteTagMutation.mutate(tag)}
                    aria-label={`Delete tag ${tag}`}
                    className={TOGGLE_CLASS}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
