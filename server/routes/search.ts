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
 * Why a single route and not `POST /api/search?q=…`: the spec is explicit
 * that keystrokes must not hit the server. This route is fetched once per
 * session-mount and the client does the search.
 */

export function registerSearchRoute(app: FastifyInstance, store: Store): void {
  app.get(
    "/api/search-index",
    async (): Promise<SearchIndexResponse> => store.buildSearchSnapshot(),
  );
}
