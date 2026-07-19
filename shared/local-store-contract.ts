/**
 * Local-store wire contract (ARCH-settings-local-store.md; architecture
 * §10). `~/.claude-lens/local.json` holds data with no ingest/runtime
 * coupling — saved views and session tags. Parallel to
 * `settings-contract.ts`'s `AppConfig`, but a separate file/type on disk
 * since these are pure client-managed records, never derived from
 * transcripts.
 */

/** Length cap on user-supplied free-text fields (view name, tag name,
 * view search/path). Mirrors the numeric bounds other contracts in this
 * repo enforce — bounds a hand-edited or pathological request from
 * growing `local.json` arbitrarily large (the whole file is read/parsed/
 * rewritten per `mutateLocalStore` call). 200 chars is well above any
 * reasonable human-typed value for a view name or filter URL. */
export const LOCAL_STORE_STRING_MAX = 200;

/**
 * A saved permalink: the global filter bar's URL state (architecture §11 —
 * filters live in the query string), captured under a user-given name.
 * `id`/`createdAt` are server-generated on `POST /api/views`, never
 * client-supplied.
 */
export interface SavedView {
  id: string;
  name: string;
  /** `location.pathname` at save time, e.g. "/sessions". */
  path: string;
  /** `location.search` at save time, e.g. "?range=7d&project=claude-lens". */
  search: string;
  createdAt: string;
}

/**
 * `tags` is keyed by `sessionId`; a session with no entry (or an empty
 * array) is untagged. Tags are freeform strings with no separate
 * definition entity — renaming/deleting a tag operates across every
 * session's array at once (see `server/routes/tags.ts`).
 */
export interface LocalStore {
  views: SavedView[];
  tags: Record<string, string[]>;
}

/** Type guard for a fully-shaped `SavedView` (every field a non-empty
 * string within `LOCAL_STORE_STRING_MAX`). Used by `server/local-store.ts`
 * when validating on-disk reads (review #19) — a hand-edited or
 * partially-corrupt `local.json` with `views: [{}]` would otherwise pass
 * the container check and surface `id: undefined` to the API surface.
 */
export function isValidSavedView(value: unknown): value is SavedView {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    r.id.length > 0 &&
    r.id.length <= LOCAL_STORE_STRING_MAX &&
    typeof r.name === "string" &&
    r.name.trim().length > 0 &&
    r.name.length <= LOCAL_STORE_STRING_MAX &&
    typeof r.path === "string" &&
    r.path.length > 0 &&
    r.path.length <= LOCAL_STORE_STRING_MAX &&
    typeof r.search === "string" &&
    r.search.length <= LOCAL_STORE_STRING_MAX &&
    typeof r.createdAt === "string" &&
    r.createdAt.length > 0 &&
    r.createdAt.length <= LOCAL_STORE_STRING_MAX
  );
}

/** Type guard for the `tags[sessionId]` value — an array of non-empty
 * trimmed strings within `LOCAL_STORE_STRING_MAX`. Returns the validated
 * entries (drops invalid ones) so a partially-corrupt `local.json` reads
 * back as the best-effort salvage rather than either failing closed or
 * accepting a poison value that crashes downstream code expecting
 * `string[]`. */
export function isValidTagList(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  for (const t of value) {
    if (typeof t !== "string" || t.trim().length === 0) return false;
    if (t.length > LOCAL_STORE_STRING_MAX) return false;
  }
  return true;
}

/** `POST /api/views` request body: everything except the server-generated `id`/`createdAt`. */
export function isValidSavedViewInput(
  value: unknown,
): value is { name: string; path: string; search: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.trim().length === 0) return false;
  if (record.name.length > LOCAL_STORE_STRING_MAX) return false;
  if (typeof record.path !== "string" || record.path.trim().length === 0) return false;
  if (record.path.length > LOCAL_STORE_STRING_MAX) return false;
  if (typeof record.search !== "string") return false;
  if (record.search.length > LOCAL_STORE_STRING_MAX) return false;
  return true;
}
