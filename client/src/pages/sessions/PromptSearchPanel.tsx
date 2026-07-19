import { useQuery } from "@tanstack/react-query";
import MiniSearch from "minisearch";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import type {
  PromptSearchDoc,
  SearchIndexResponse,
} from "../../../../shared/search-index-contract.js";
import { getSearchIndex } from "../../api/search.js";
import { qk } from "../../api/queryKeys.js";
import { EmptyState } from "../../components/EmptyState.js";

// Search-as-you-type over the in-memory prompt corpus (#P4-3,
// ARCH-p4-3-search-index.md). Fetches the full prompt list once, builds a
// MiniSearch index lazily in a memo, and runs every keystroke locally —
// no server round-trip per character (architecture §11's explicit
// contract).
//
// Page-local URL state via `?q=...` — the query string lives on the
// `/sessions` URL alongside the other page-owned keys so a permalink
// reproduces the exact search box contents. NOT a global filter
// (ARCH A4): the search box is a Sessions-page feature, not a
// cross-page dimension.
//
// Result rows deep-link to `/sessions/:id?turn=N` so the Session
// Detail page lands on the matching turn — reusing the existing
// turn-anchor contract (`session-detail` page reads `?turn=`).

const SEARCH_DEBOUNCE_MS = 100;
/** Result-list cap — keeps the DOM bounded; an unbounded list is the
 * first regression to surface when the corpus grows. */
const RESULT_DISPLAY_CAP = 50;

interface SearchHit {
  doc: PromptSearchDoc;
  score: number;
}

/**
 * Builds (or rebuilds) a `MiniSearch` instance over a prompt corpus.
 * Pure-ish: only the index itself is stateful; callers wrap it in a
 * `useMemo` keyed on the payload reference so the same data ref
 * reuses the same index.
 */
function buildIndex(prompts: readonly PromptSearchDoc[]): MiniSearch<PromptSearchDoc> {
  const index = new MiniSearch<PromptSearchDoc>({
    fields: ["text"],
    storeFields: [
      "id",
      "sessionId",
      "promptId",
      "turnNumber",
      "text",
      "timestamp",
      "cwd",
      "gitBranch",
    ],
    idField: "id",
  });
  index.addAll([...prompts]);
  return index;
}

/**
 * Reads the page-local search query from the current URL. Returns the
 * raw value (may be empty string when no `?q=` is set). The Sessions
 * page's `onStateChange` already preserves `q` across its own URL
 * round-trips because `q` is now in `pageOwnedKeys()` (#P4-3).
 */
function readQueryFromUrl(search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return params.get("q") ?? "";
}

/**
 * Writes the search query back to the URL using the same
 * `pushState` + `popstate` pattern used by the Sessions-page
 * `onStateChange` (FilterBar / ChartCard precedent). Preserves every
 * other URL key by re-reading and re-writing the full param map
 * rather than `params.set('q', q)` on a blank slate.
 */
function writeQueryToUrl(search: string, q: string): void {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (q.length > 0) params.set("q", q);
  else params.delete("q");
  const next = params.toString();
  // Skip the pushState round-trip when the URL hasn't changed — guards
  // against an infinite history churn on rapid typing.
  const target = next.length > 0 ? `?${next}` : window.location.pathname;
  const current = window.location.search.length > 0 ? window.location.search : "";
  if (current === next || (next.length === 0 && current.length === 0)) return;
  window.history.pushState({}, "", target);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function PromptSearchPanel() {
  const [, navigate] = useLocation();
  // useSearch returns just the query-string portion ("?q=refactor"), which
  // is what `?q=...` reads from — wouter's useLocation is path-only.
  const search = useSearch();

  const initialQuery = useMemo(() => readQueryFromUrl(search), [search]);
  const [input, setInput] = useState<string>(initialQuery);

  // Reflect URL → input when the user navigates (e.g. browser back/forward).
  // The forward direction (input → URL) is handled below via the debounced
  // write effect, not here, so we don't fight the user mid-keystroke.
  useEffect(() => {
    setInput(readQueryFromUrl(search));
  }, [search]);

  // Persist the search box into the URL after the user stops typing.
  // 100 ms is short enough to feel instant and long enough that an
  // uninterrupted keystroke stream coalesces into one history entry.
  // We capture the current URL search into a ref so this effect only
  // fires on `input` changes — depending on `search` directly would
  // re-write the URL on every other page-state commit, defeating the
  // debounce.
  const latestSearchRef = useRef<string>(search);
  latestSearchRef.current = search;
  useEffect(() => {
    const handle = setTimeout(() => {
      writeQueryToUrl(latestSearchRef.current, input);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [input]);

  const { data, isPending, isError, error } = useQuery<SearchIndexResponse>({
    queryKey: qk.searchIndex(),
    queryFn: ({ signal }) => getSearchIndex(signal),
    staleTime: Infinity,
  });

  const prompts = data?.prompts;
  const index = useMemo(() => {
    if (!prompts) return null;
    return buildIndex(prompts);
  }, [prompts]);

  const hits = useMemo<SearchHit[]>(() => {
    if (!index || !prompts) return [];
    const q = input.trim();
    if (q.length === 0) return [];
    // Prefix matches let a single keystroke surface matching prompts
    // mid-word — the marquee search-as-you-type feel. Fuzzy (0.2)
    // catches the common "off by a character" case for hand-typed
    // prompt text without drowning the results list in noise.
    return index
      .search(q, { prefix: true, fuzzy: 0.2 })
      .slice(0, RESULT_DISPLAY_CAP)
      .map((r) => {
        const doc = prompts.find((p) => p.id === r.id);
        return doc ? { doc, score: r.score } : null;
      })
      .filter((h): h is SearchHit => h !== null);
  }, [index, input, prompts]);

  const handleResultClick = useCallback(
    (hit: SearchHit) => {
      navigate(`/sessions/${encodeURIComponent(hit.doc.sessionId)}?turn=${hit.doc.turnNumber}`);
    },
    [navigate],
  );

  const renderResults = () => {
    if (isPending) {
      return <EmptyState message="Loading prompt index…" />;
    }
    if (isError) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return <EmptyState message={`Prompt search unavailable — ${message}`} />;
    }
    if (!data || data.prompts.length === 0) {
      return (
        <EmptyState message="No prompts indexed yet — start a Claude Code session to populate this." />
      );
    }
    const q = input.trim();
    if (q.length === 0) {
      return (
        <EmptyState
          message={`Type to search across ${data.prompts.length} prompt${data.prompts.length === 1 ? "" : "s"}.`}
        />
      );
    }
    if (hits.length === 0) {
      return <EmptyState message={`No matches for “${q}”.`} />;
    }
    return (
      <ul
        className="mt-3 flex flex-col divide-y divide-slate-100 dark:divide-[#1E252F]"
        data-testid="prompt-search-results"
      >
        {hits.map((hit) => (
          <li key={hit.doc.id}>
            <button
              type="button"
              onClick={() => handleResultClick(hit)}
              data-testid="prompt-search-result"
              className="w-full px-2 py-2 text-left hover:bg-slate-50 dark:hover:bg-[#1A2028]"
            >
              <div className="line-clamp-2 text-sm text-slate-800 dark:text-[#D6DEE8]">
                {hit.doc.text}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500 dark:text-[#8A96A5]">
                <span title={hit.doc.timestamp}>{formatRelativeTime(hit.doc.timestamp)}</span>
                {hit.doc.gitBranch ? <span>· {hit.doc.gitBranch}</span> : null}
                {hit.doc.cwd ? (
                  <span className="truncate" title={hit.doc.cwd}>
                    · {shortenCwd(hit.doc.cwd)}
                  </span>
                ) : null}
                <span>· turn {hit.doc.turnNumber}</span>
              </div>
            </button>
          </li>
        ))}
        {data.prompts.length > RESULT_DISPLAY_CAP && hits.length === RESULT_DISPLAY_CAP ? (
          <li className="px-2 py-1 text-xs text-slate-500 dark:text-[#8A96A5]">
            Showing first {RESULT_DISPLAY_CAP} matches.
          </li>
        ) : null}
      </ul>
    );
  };

  return (
    <section
      data-testid="prompt-search-slot"
      aria-label="Full-text prompt search"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Search prompts</h2>
      <input
        type="search"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Find a prompt you typed…"
        aria-label="Search prompts"
        data-testid="prompt-search-input"
        className="mt-2 w-full rounded border border-slate-200 px-2 py-1 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none dark:border-[#232B36] dark:bg-[#0B0F14] dark:text-[#E8EDF2] dark:placeholder:text-[#5A6677] dark:focus:border-[#3A4756]"
      />
      {renderResults()}
    </section>
  );
}

/** Format an ISO timestamp as a coarse relative-time string ("3m ago").
 * Pure helper, no external date lib — keeps the component dependency
 * surface minimal. */
function formatRelativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

/** Trim a cwd path to its last two segments for the result-row context
 * line. Pure helper. */
function shortenCwd(cwd: string): string {
  const parts = cwd.split("/").filter((p) => p.length > 0);
  if (parts.length <= 2) return cwd;
  return `…/${parts.slice(-2).join("/")}`;
}
