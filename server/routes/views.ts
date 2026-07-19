import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { isValidSavedViewInput, type SavedView } from "../../shared/local-store-contract.js";
import { readLocalStore, writeLocalStore } from "../local-store.js";

/**
 * GET/POST /api/views, DELETE /api/views/:id — saved-view CRUD
 * (ARCH-settings-local-store.md; architecture §10). Views are created only
 * via the global `FilterBar`'s "Save view" action (ARCH decision A5) and
 * managed (listed/deleted) on the Settings page. `id`/`createdAt` are
 * always server-generated — a `POST` body never supplies them.
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
      return { error: "body must be { name: string, path: string, search: string }" };
    }
    const { name, path, search } = request.body;
    const view: SavedView = {
      id: randomUUID(),
      name,
      path,
      search,
      createdAt: new Date().toISOString(),
    };
    try {
      const current = await readLocalStore(options.localStorePath);
      await writeLocalStore({ views: [...current.views, view] }, options.localStorePath);
      reply.code(200);
      return view;
    } catch (err) {
      app.log.error({ err }, "failed to save view");
      reply.code(500);
      return { error: "failed to save view" };
    }
  });

  app.delete<{ Params: { id: string } }>(
    "/api/views/:id",
    async (request, reply): Promise<undefined | { error: string }> => {
      const current = await readLocalStore(options.localStorePath);
      if (!current.views.some((v) => v.id === request.params.id)) {
        reply.code(404);
        return { error: "view not found" };
      }
      try {
        const nextViews = current.views.filter((v) => v.id !== request.params.id);
        await writeLocalStore({ views: nextViews }, options.localStorePath);
        reply.code(204);
        return undefined;
      } catch (err) {
        app.log.error({ err }, "failed to delete view");
        reply.code(500);
        return { error: "failed to delete view" };
      }
    },
  );
}
