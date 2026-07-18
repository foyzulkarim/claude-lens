import { EmptyState } from "../../components/EmptyState.js";

/**
 * Stable mount point for #P4-3 full-text prompt search (ARCH R8). The
 * Sessions page renders this in its binding order so the future Search
 * implementation can drop in without changing the page composition.
 * Today it surfaces an honest "unavailable" message rather than fake
 * results — the established unavailable-seam pattern (ARCH A11).
 */
export function PromptSearchSlot() {
  return (
    <section
      data-testid="prompt-search-slot"
      aria-label="Full-text prompt search"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Search prompts</h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-[#8A96A5]">
        Full-text prompt search lights up in a follow-up release — the search mount point is
        reserved here so the page composition stays stable until then.
      </p>
      <div className="mt-3">
        <EmptyState message="Prompt search unavailable" />
      </div>
    </section>
  );
}
