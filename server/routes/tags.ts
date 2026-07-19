import type { FastifyInstance } from "fastify";
import { mutateLocalStore, readLocalStore } from "../local-store.js";

/**
 * GET /api/tags, PUT/DELETE /api/tags/:tag — fleet-wide tag manager
 * (ARCH-settings-local-store.md; architecture §10). Tags are flat strings
 * with no separate definition entity (ARCH decision A4) — `local.json`'s
 * `tags` map is `sessionId -> string[]`, so rename/delete here operate
 * across every session's array at once. Attaching/detaching a tag on one
 * session is `PUT /api/sessions/:id/tags` (`server/routes/sessions.ts`),
 * not here.
 */

export interface TagUsage {
  tag: string;
  sessionCount: number;
}

export interface RegisterTagsRouteOptions {
  /** Overrides `~/.claude-lens/local.json`'s path — tests only; production always uses the real path. */
  localStorePath?: string;
}

function distinctTagUsage(tags: Record<string, string[]>): TagUsage[] {
  const counts = new Map<string, number>();
  for (const sessionTags of Object.values(tags)) {
    for (const tag of sessionTags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, sessionCount]) => ({ tag, sessionCount }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

export function registerTagsRoute(
  app: FastifyInstance,
  options: RegisterTagsRouteOptions = {},
): void {
  app.get("/api/tags", async (): Promise<TagUsage[]> => {
    const store = await readLocalStore(options.localStorePath);
    return distinctTagUsage(store.tags);
  });

  app.put<{ Params: { tag: string } }>(
    "/api/tags/:tag",
    async (request, reply): Promise<{ tag: string } | { error: string }> => {
      const oldName = request.params.tag;
      const body = request.body;
      const newName =
        typeof body === "object" && body !== null && "newName" in body
          ? (body as { newName: unknown }).newName
          : undefined;
      if (typeof newName !== "string" || newName.trim().length === 0) {
        reply.code(400);
        return { error: "newName must be a non-empty string" };
      }
      try {
        await mutateLocalStore((current) => {
          const nextTags: Record<string, string[]> = {};
          for (const [sessionId, sessionTags] of Object.entries(current.tags)) {
            nextTags[sessionId] = sessionTags.map((t) => (t === oldName ? newName : t));
          }
          return { tags: nextTags };
        }, options.localStorePath);
        return { tag: newName };
      } catch (err) {
        app.log.error({ err }, "failed to rename tag");
        reply.code(500);
        return { error: "failed to rename tag" };
      }
    },
  );

  app.delete<{ Params: { tag: string } }>(
    "/api/tags/:tag",
    async (request, reply): Promise<undefined | { error: string }> => {
      const tag = request.params.tag;
      try {
        await mutateLocalStore((current) => {
          const nextTags: Record<string, string[]> = {};
          for (const [sessionId, sessionTags] of Object.entries(current.tags)) {
            nextTags[sessionId] = sessionTags.filter((t) => t !== tag);
          }
          return { tags: nextTags };
        }, options.localStorePath);
        reply.code(204);
        return undefined;
      } catch (err) {
        app.log.error({ err }, "failed to delete tag");
        reply.code(500);
        return { error: "failed to delete tag" };
      }
    },
  );
}
