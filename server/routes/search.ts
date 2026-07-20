import type { FastifyInstance } from "fastify";
import type { SearchIndexResponse } from "../../shared/search-index-contract.js";
import type { Store } from "../store/store.js";

/**
 * Registers `GET /api/search-index` (#P4-3, issue #35, ARCH-p4-3-search-index).
 *
 * Pure read-only route — takes a synchronous snapshot of the Store's prompt
 * corpus and ships it as a JSON array of `PromptSearchDoc`. The client builds
 * its MiniSearch index lazily from this payload, then runs search-as-you-type
 * in-browser with no per-keystroke server round-trip (architecture §11).
 *
 * Mirrors the `registerCacheLabRoute` pattern: no request body validation
 * (the route accepts no body), a single Store snapshot per request, and a
 * pure-function builder (`server/store/build-search-snapshot.ts`) doing the
 * actual work. The Store's `buildSearchSnapshot()` increments a per-process
 * monotonic version counter so a future client can detect stale indexes
 * (today the counter is opaque — the client treats it as informational).
 *
 * Error shape: the route wraps `buildSearchSnapshot()` in try/catch and
 * returns the documented `{ error, cause }` 500 wire shape (matches
 * ARCH §HTTP errors and the gates route's local-handling precedent at
 * `server/routes/gates.ts`). Per-session `recompute` failures inside
 * `buildSearchSnapshot` are caught deeper down — they degrade gracefully
 * to a partial index rather than 500 (see `Store.buildSearchSnapshot`).
 *
 * Why a single route and not `POST /api/search?q=…`: the spec is explicit
 * that keystrokes must not hit the server. This route is fetched once per
 * session-mount and the client does the search.
 */

export function registerSearchRoute(app: FastifyInstance, store: Store): void {
  app.get("/api/search-index", async (): Promise<SearchIndexResponse> => {
    try {
      return await store.buildSearchSnapshot();
    } catch (err) {
      // Per-session errors are already caught inside buildSearchSnapshot,
      // so reaching here means the snapshot builder itself failed
      // (e.g. an unexpected throw in `buildSearchSnapshot` or a Store
      // internal error). Log and rethrow with the documented shape so
      // the client can render a recoverable error state.
      app.log.error({ err }, "search-index build failed");
      const cause = err instanceof Error ? err.message : String(err);
      const e = new Error("internal server error") as Error & {
        statusCode: number;
        cause: string;
      };
      e.statusCode = 500;
      e.cause = cause;
      throw e;
    }
  });
}
