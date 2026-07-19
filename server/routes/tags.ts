import type { FastifyInstance } from "fastify";
import { LOCAL_STORE_STRING_MAX } from "../../shared/local-store-contract.js";
import { mutateLocalStore, readLocalStore } from "../local-store.js";
import { extractField } from "../util.js";

/**
 * GET /api/tags, PUT/DELETE /api/tags/:tag — fleet-wide tag manager
 * (ARCH-settings-local-store.md; architecture §10). Tags are flat strings
 * with no separate definition entity (ARCH decision A4) — `local.json`'s
 * `tags` map is `sessionId -> string[]`, so rename/delete here operate
 * across every session's array at once. Attaching/detaching a tag on one
 * session is `PUT /api/sessions/:id/tags` (`server/routes/sessions.ts`),
 * not here.
 *
 * Per review #19, the rename handler now dedupes per-session (renaming
 * `a` → `b` on a session that already has `b` produces `["b"]`, not
 * `["b","b"]`), the rebuild uses `Object.create(null)` (defense in depth
 * against prototype-key writes — unreachable today, but cheap to make
 * safe), and the write path no longer catches locally — failures bubble
 * to `app.ts`'s `setErrorHandler` to match the documented convention.
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
      const newName = extractField(request.body, "newName");
      if (typeof newName !== "string" || newName.trim().length === 0) {
        reply.code(400);
        return { error: "newName must be a non-empty string" };
      }
      if (newName.length > LOCAL_STORE_STRING_MAX) {
        reply.code(400);
        return { error: `newName must be at most ${LOCAL_STORE_STRING_MAX} characters` };
      }
      // Write failures bubble to app.ts's top-level setErrorHandler
      // (review #19). Validation failures stay local because they need
      // a typed 400, not the generic 500 envelope.
      await mutateLocalStore((current) => {
        // Object.create(null) for defense-in-depth — even though the keys
        // here come from `Object.entries(current.tags)` (already-trusted),
        // bracket-assignment on a plain object with a key like
        // `"__proto__"` would walk the prototype accessor. A future code
        // path that lets an untrusted key in would otherwise corrupt the
        // rebuilt map's prototype chain.
        const nextTags: Record<string, string[]> = Object.create(null);
        for (const [sessionId, sessionTags] of Object.entries(current.tags)) {
          // Dedupe per-session after rename (review #19): renaming `a`
          // → `b` on a session with `["a","b"]` would otherwise produce
          // `["b","b"]` — an honest rendering would show only one chip,
          // not two.
          const renamed = sessionTags.map((t) => (t === oldName ? newName : t));
          nextTags[sessionId] = [...new Set(renamed)];
        }
        return { tags: nextTags };
      }, options.localStorePath);
      return { tag: newName };
    },
  );

  app.delete<{ Params: { tag: string } }>(
    "/api/tags/:tag",
    async (request, reply): Promise<undefined> => {
      const tag = request.params.tag;
      await mutateLocalStore((current) => {
        // Same Object.create(null) defensive-rebuild pattern as the
        // rename path above.
        const nextTags: Record<string, string[]> = Object.create(null);
        for (const [sessionId, sessionTags] of Object.entries(current.tags)) {
          nextTags[sessionId] = sessionTags.filter((t) => t !== tag);
        }
        return { tags: nextTags };
      }, options.localStorePath);
      reply.code(204);
      return undefined;
    },
  );
}
