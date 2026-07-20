import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { isValidSavedViewInput, type SavedView } from "../../shared/local-store-contract.js";
import { mutateLocalStore, readLocalStore } from "../local-store.js";

/**
 * GET/POST /api/views, DELETE /api/views/:id — saved-view CRUD
 * (ARCH-settings-local-store.md; architecture §10). Views are created only
 * via the global `FilterBar`'s "Save view" action (ARCH decision A5) and
 * managed (listed/deleted) on the Settings page. `id`/`createdAt` are
 * always server-generated — a `POST` body never supplies them.
 *
 * Per review #19, the local try/catch around `mutateLocalStore` was
 * dropped: a write failure now bubbles to `app.ts`'s top-level
 * `setErrorHandler` (matches the convention the ARCH doc states twice —
 * "new routes rely on `app.ts`'s top-level `setErrorHandler`"), so the
 * whole API surface produces the same `{ error, cause }` 500 shape rather
 * than five slightly different bespoke ones.
 */

export interface RegisterViewsRouteOptions {
  /** Overrides `~/.claude-lens/local.json`'s path — tests only; production always uses the real path. */
  localStorePath?: string;
}

export function registerViewsRoute(
  app: FastifyInstance,
  options: RegisterViewsRouteOptions = {},
): void {
  app.get("/api/views", async (): Promise<SavedView[]> => {
    const store = await readLocalStore(options.localStorePath);
    return store.views;
  });

  app.post("/api/views", async (request, reply): Promise<SavedView | { error: string }> => {
    if (!isValidSavedViewInput(request.body)) {
      reply.code(400);
      return {
        error: "body must be { name: string, path: string, search: string, pinned?: boolean }",
      };
    }
    const { name, path, search, pinned } = request.body;
    const view: SavedView = {
      id: randomUUID(),
      name,
      path,
      search,
      // Omit the key entirely when undefined so on-disk JSON is lean and
      // older readers see the same shape they always have. ARCH-explore-page.md
      // A3 — Explore's save flow always passes pinned:true; FilterBar never
      // passes the field.
      ...(pinned === undefined ? {} : { pinned }),
      createdAt: new Date().toISOString(),
    };
    // Write failures bubble to app.ts's top-level setErrorHandler
    // (review #19). Validation failures stay local because they need
    // a typed 400, not the generic 500 envelope.
    await mutateLocalStore(
      (current) => ({ views: [...current.views, view] }),
      options.localStorePath,
    );
    return view;
  });

  app.delete<{ Params: { id: string } }>(
    "/api/views/:id",
    async (request, reply): Promise<undefined | { error: string }> => {
      const current = await readLocalStore(options.localStorePath);
      if (!current.views.some((v) => v.id === request.params.id)) {
        reply.code(404);
        return { error: "view not found" };
      }
      // Write failures bubble to app.ts's top-level setErrorHandler
      // (review #19). Validation/404 stay local because they need a
      // typed 404, not the generic 500 envelope.
      await mutateLocalStore(
        (latest) => ({ views: latest.views.filter((v) => v.id !== request.params.id) }),
        options.localStorePath,
      );
      reply.code(204);
      return undefined;
    },
  );
}
