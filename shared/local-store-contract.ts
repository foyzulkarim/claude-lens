/**
 * Local-store wire contract (ARCH-settings-local-store.md; architecture
 * §10). `~/.claude-lens/local.json` holds data with no ingest/runtime
 * coupling — saved views and session tags. Parallel to
 * `settings-contract.ts`'s `AppConfig`, but a separate file/type on disk
 * since these are pure client-managed records, never derived from
 * transcripts.
 */

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

/** `POST /api/views` request body: everything except the server-generated `id`/`createdAt`. */
export function isValidSavedViewInput(
  value: unknown,
): value is { name: string; path: string; search: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.trim().length === 0) return false;
  if (typeof record.path !== "string" || record.path.trim().length === 0) return false;
  if (typeof record.search !== "string") return false;
  return true;
}

/** `PUT /api/sessions/:id/tags` request body: a flat list of tag strings. */
export function isValidTagList(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  return value.every((t) => typeof t === "string" && t.trim().length > 0);
}
