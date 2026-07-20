import { useQuery } from "@tanstack/react-query";
import MiniSearch from "minisearch";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const SECTION_HEADING_ID = "prompt-search-heading";

interface SearchHit {
  doc: PromptSearchDoc;
  score: number;
}

interface IndexBuildResult {
  index: MiniSearch<PromptSearchDoc> | null;
  buildError: Error | null;
}

/**
 * Builds (or rebuilds) a `MiniSearch` instance over a prompt corpus.
 * Pure-ish: only the index itself is stateful; callers wrap it in a
 * `useMemo` keyed on the payload reference so the same data ref
 * reuses the same index.
 *
 * Defense-in-depth (ARCH §Risks): if `addAll` throws on pathological
 * input, the caller renders an empty-state instead of unmounting
 * the section to a missing error boundary.
 */
function buildIndex(prompts: readonly PromptSearchDoc[]): IndexBuildResult {
  try {
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
    // MiniSearch's addAll is typed `addAll(documents: readonly T[]): void`,
    // so the readonly array passes through without a defensive copy.
    index.addAll(prompts);
    return { index, buildError: null };
  } catch (err) {
    return { index: null, buildError: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Reads the page-local search query from the current URL. Returns the
 * raw value (may be empty string when no `?q=` is set).
 */
function readQueryFromUrl(search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return params.get("q") ?? "";
}

/**
 * Writes the search query back to the URL via wouter's `navigate`,
 * which goes through the same `pushState` path as the rest of the
 * app. Preserves every other URL key by re-reading and re-writing the
 * full param map rather than `params.set('q', q)` on a blank slate.
 * This also makes the write visible to `memoryLocation` in tests.
 */
function writeQueryToUrl(search: string, q: string, navigate: (to: string) => void): void {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (q.length > 0) params.set("q", q);
  else params.delete("q");
  const next = params.toString();
  // Skip the navigation round-trip when the URL hasn't changed — guards
  // against an infinite history churn on rapid typing.
  const target = next.length > 0 ? `${window.location.pathname}?${next}` : window.location.pathname;
  if (window.location.pathname + window.location.search === target) return;
  try {
    navigate(target);
  } catch {
    // pushState can throw in sandboxed iframes (SecurityError) or
    // rare quota cases. Silently no-op: the next keystroke will retry,
    // and the worst case is a one-keystroke URL drift, recoverable on
    // the next mount.
  }
}

export function PromptSearchPanel() {
  const [, navigate] = useLocation();
  // useSearch returns just the query-string portion ("?q=refactor"), which
  // is what `?q=...` reads from — wouter's useLocation is path-only.
  const search = useSearch();

  // URL → input: the "store previous prop in state" pattern from the React
  // docs (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  // Initializes lazily from the URL on first mount, then re-syncs only when
  // the URL's `?q=` actually changes — collapsing the two-pass render that
  // a useEffect[search]→setInput would cause.
  const [input, setInput] = useState<string>(() => readQueryFromUrl(search));
  const [prevSearch, setPrevSearch] = useState<string>(search);
  if (prevSearch !== search) {
    setPrevSearch(search);
    setInput(readQueryFromUrl(search));
  }

  // Persist the search box into the URL after the user stops typing.
  // 100 ms is short enough to feel instant and long enough that an
  // uninterrupted keystroke stream coalesces into one history entry.
  // The effect depends on `[input, search]` so any external URL change
  // (e.g. a sibling card) cancels the pending write — closes the
  // narrow race window where a stale timeout could fire after a
  // sibling-driven navigation and clobber the new URL.
  useEffect(() => {
    const handle = setTimeout(() => {
      writeQueryToUrl(search, input, navigate);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [input, search, navigate]);

  const { data, isPending, isError, error } = useQuery<SearchIndexResponse>({
    queryKey: qk.searchIndex(),
    queryFn: ({ signal }) => getSearchIndex(signal),
    staleTime: Infinity,
  });

  const { index, buildError } = useMemo<IndexBuildResult>(() => {
    if (!data) return { index: null, buildError: null };
    return buildIndex(data.prompts);
  }, [data]);

  // MiniSearch's `storeFields` config (see buildIndex) stores every doc
  // field on each search result, so `r` already carries sessionId,
  // promptId, turnNumber, text, timestamp, cwd, gitBranch — no need
  // for a per-result `prompts.find()`. At 50K prompts and a 50-hit
  // cap, that's ~2.5M string comparisons saved per keystroke.
  const hits = useMemo<SearchHit[]>(() => {
    if (!index) return [];
    const q = input.trim();
    if (q.length === 0) return [];
    return index
      .search(q, { prefix: true, fuzzy: 0.2 })
      .slice(0, RESULT_DISPLAY_CAP)
      .map((r) => ({ doc: r as unknown as PromptSearchDoc, score: r.score }));
  }, [index, input]);

  const handleResultClick = useCallback(
    (hit: SearchHit) => {
      navigate(`/sessions/${encodeURIComponent(hit.doc.sessionId)}?turn=${hit.doc.turnNumber}`);
    },
    [navigate],
  );

  // Roving-tabindex keyboard nav (project pattern: LeaderboardsCard.tsx:199-214).
  // `activeIndex` is the focused row; on ArrowDown/Up we move it; on Enter we
  // navigate; on Escape we clear the query and return focus to the input.
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset activeIndex when results change (so a stale index can't select
  // a row that no longer exists in the new results).
  useEffect(() => {
    setActiveIndex((prev) => (prev >= hits.length ? -1 : prev));
  }, [hits.length]);

  const handleListKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (hits.length === 0) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % hits.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => (i <= 0 ? hits.length - 1 : i - 1));
          break;
        case "Home":
          e.preventDefault();
          setActiveIndex(0);
          break;
        case "End":
          e.preventDefault();
          setActiveIndex(hits.length - 1);
          break;
        case "Enter": {
          if (activeIndex >= 0 && activeIndex < hits.length) {
            e.preventDefault();
            const hit = hits[activeIndex];
            if (hit) handleResultClick(hit);
          }
          break;
        }
        case "Escape":
          e.preventDefault();
          setInput("");
          inputRef.current?.focus();
          break;
      }
    },
    [hits, activeIndex, handleResultClick],
  );

  return (
    <section
      data-testid="prompt-search-slot"
      aria-labelledby={SECTION_HEADING_ID}
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2
        id={SECTION_HEADING_ID}
        className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
      >
        Search prompts
      </h2>
      <input
        ref={inputRef}
        type="search"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Find a prompt you typed…"
        aria-label="Search prompts"
        aria-describedby="prompt-search-status"
        aria-controls="prompt-search-status"
        data-testid="prompt-search-input"
        className="mt-2 w-full rounded border border-slate-200 px-2 py-1 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none dark:border-[#232B36] dark:bg-[#0B0F14] dark:text-[#E8EDF2] dark:placeholder:text-[#5A6677] dark:focus:border-[#3A4756]"
      />
      <PromptSearchResults
        isPending={isPending}
        isError={isError}
        error={error}
        buildError={buildError}
        promptsCount={data?.prompts.length ?? 0}
        query={input.trim()}
        hits={hits}
        activeIndex={activeIndex}
        onActiveIndexChange={setActiveIndex}
        onResultClick={handleResultClick}
        onListKeyDown={handleListKeyDown}
        onClearAndFocus={() => {
          setInput("");
          inputRef.current?.focus();
        }}
        listRef={listRef}
      />
    </section>
  );
}

interface PromptSearchResultsProps {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  buildError: Error | null;
  promptsCount: number;
  query: string;
  hits: SearchHit[];
  activeIndex: number;
  onActiveIndexChange: (i: number) => void;
  onResultClick: (hit: SearchHit) => void;
  onListKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  onClearAndFocus: () => void;
  listRef: React.RefObject<HTMLDivElement | null>;
}

function PromptSearchResults(props: PromptSearchResultsProps) {
  const {
    isPending,
    isError,
    error,
    buildError,
    promptsCount,
    query,
    hits,
    activeIndex,
    onActiveIndexChange,
    onResultClick,
    onListKeyDown,
    listRef,
  } = props;

  // Status messaging via aria-live (project pattern: SessionDetail.tsx).
  // Loading/idle/empty/no-match use role="status" (polite). Errors use
  // role="alert" (assertive) so screen-reader users hear them.
  if (isError || buildError) {
    const message = buildError
      ? `Prompt search index failed to build — ${buildError.message}`
      : error instanceof Error
        ? `Prompt search unavailable — ${error.message}`
        : "Prompt search unavailable — unknown error";
    return (
      <div
        id="prompt-search-status"
        role="alert"
        data-testid="prompt-search-status"
        className="mt-3"
      >
        <EmptyState message={message} />
      </div>
    );
  }

  if (isPending) {
    return (
      <div
        id="prompt-search-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="prompt-search-status"
        className="mt-3"
      >
        <EmptyState message="Loading prompt index…" />
      </div>
    );
  }

  if (promptsCount === 0) {
    return (
      <div
        id="prompt-search-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="prompt-search-status"
        className="mt-3"
      >
        <EmptyState message="No prompts indexed yet — start a Claude Code session to populate this." />
      </div>
    );
  }

  if (query.length === 0) {
    return (
      <div
        id="prompt-search-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="prompt-search-status"
        className="mt-3"
      >
        <EmptyState
          message={`Type to search across ${promptsCount} prompt${promptsCount === 1 ? "" : "s"}.`}
        />
      </div>
    );
  }

  if (hits.length === 0) {
    return (
      <div
        id="prompt-search-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="prompt-search-status"
        className="mt-3"
      >
        <EmptyState message={`No matches for “${query}”.`} />
      </div>
    );
  }

  return (
    <>
      <div
        ref={listRef}
        id="prompt-search-status"
        role="listbox"
        aria-label="Search results"
        data-testid="prompt-search-results"
        tabIndex={-1}
        onKeyDown={onListKeyDown}
        className="mt-3 flex flex-col divide-y divide-slate-100 outline-none focus-visible:ring-1 focus-visible:ring-slate-400 dark:divide-[#1E252F] dark:focus-visible:ring-slate-500"
      >
        {hits.map((hit, i) => {
          const isActive = i === activeIndex;
          return (
            <div
              key={hit.doc.id}
              role="option"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onResultClick(hit)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onResultClick(hit);
                }
              }}
              onFocus={() => onActiveIndexChange(i)}
              onMouseEnter={() => onActiveIndexChange(i)}
              data-testid="prompt-search-result"
              className={
                isActive
                  ? "w-full cursor-pointer bg-slate-50 px-2 py-2 text-left dark:bg-[#1A2028]"
                  : "w-full cursor-pointer px-2 py-2 text-left hover:bg-slate-50 dark:hover:bg-[#1A2028]"
              }
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
            </div>
          );
        })}
        {promptsCount > RESULT_DISPLAY_CAP && hits.length === RESULT_DISPLAY_CAP ? (
          <div className="px-2 py-1 text-xs text-slate-500 dark:text-[#8A96A5]">
            Showing first {RESULT_DISPLAY_CAP} matches.
          </div>
        ) : null}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {hits.length} match{hits.length === 1 ? "" : "es"} for “{query}”.
      </p>
    </>
  );
}

/** Format an ISO timestamp as a coarse relative-time string ("3m ago").
 * Pure helper, no external date lib — keeps the component dependency
 * surface minimal. */
function formatRelativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const diffMs = Date.now() - then;
  if (diffMs < MS_PER_MINUTE) return "just now";
  if (diffMs < MS_PER_HOUR) return `${Math.floor(diffMs / MS_PER_MINUTE)}m ago`;
  if (diffMs < MS_PER_DAY) return `${Math.floor(diffMs / MS_PER_HOUR)}h ago`;
  return `${Math.floor(diffMs / MS_PER_DAY)}d ago`;
}

/** Trim a cwd path to its last two segments for the result-row context
 * line. Pure helper. */
function shortenCwd(cwd: string): string {
  const parts = cwd.split("/").filter((p) => p.length > 0);
  if (parts.length <= 2) return cwd;
  return `…/${parts.slice(-2).join("/")}`;
}
