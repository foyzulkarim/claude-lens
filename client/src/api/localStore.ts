import type { SavedView } from "../../../shared/local-store-contract.js";

/**
 * Client wrappers for the views/tags routes (#P4-15). Mirrors
 * `api/config.ts`'s error/shape-guard conventions so every route wrapper in
 * `api/` throws the same shape of error for consumers to branch on.
 */

export class LocalStoreApiError extends Error {
  readonly status: number;
  readonly validation: string | null;

  constructor(status: number, validation: string | null, message: string) {
    super(message);
    this.name = "LocalStoreApiError";
    this.status = status;
    this.validation = validation;
  }
}

async function throwOnError(response: Response, verb: string, url: string): Promise<never> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const validation = body && typeof body.error === "string" ? body.error : null;
  const detail = validation ?? response.statusText;
  throw new LocalStoreApiError(
    response.status,
    validation,
    `${verb} ${url} failed (${response.status}): ${detail}`,
  );
}

export interface TagUsage {
  tag: string;
  sessionCount: number;
}

export async function getViews(signal?: AbortSignal): Promise<SavedView[]> {
  const response = await fetch("/api/views", { signal });
  if (!response.ok) return throwOnError(response, "GET", "/api/views");
  return (await response.json()) as SavedView[];
}

export async function createView(
  input: { name: string; path: string; search: string },
  signal?: AbortSignal,
): Promise<SavedView> {
  const response = await fetch("/api/views", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) return throwOnError(response, "POST", "/api/views");
  return (await response.json()) as SavedView;
}

export async function deleteView(id: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`/api/views/${encodeURIComponent(id)}`, {
    method: "DELETE",
    signal,
  });
  if (!response.ok) return throwOnError(response, "DELETE", "/api/views");
}

export async function getTags(signal?: AbortSignal): Promise<TagUsage[]> {
  const response = await fetch("/api/tags", { signal });
  if (!response.ok) return throwOnError(response, "GET", "/api/tags");
  return (await response.json()) as TagUsage[];
}

export async function renameTag(
  oldName: string,
  newName: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/tags/${encodeURIComponent(oldName)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newName }),
    signal,
  });
  if (!response.ok) return throwOnError(response, "PUT", "/api/tags");
}

export async function deleteTag(tag: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`/api/tags/${encodeURIComponent(tag)}`, {
    method: "DELETE",
    signal,
  });
  if (!response.ok) return throwOnError(response, "DELETE", "/api/tags");
}

export async function setSessionTags(
  sessionId: string,
  tags: string[],
  signal?: AbortSignal,
): Promise<string[]> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/tags`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags }),
    signal,
  });
  if (!response.ok) return throwOnError(response, "PUT", "/api/sessions/:id/tags");
  const body = (await response.json()) as { tags: string[] };
  return body.tags;
}
