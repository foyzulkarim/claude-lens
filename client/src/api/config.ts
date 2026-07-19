import { type AppConfig, isValidBudget } from "../../../shared/settings-contract.js";

/**
 * The single client caller of GET/PUT /api/config (server/routes/config.ts,
 * ARCH-trends-calendar-budget.md). Mirrors `postCacheLab`'s error/shape-guard
 * conventions so every route wrapper in `api/` throws the same shape of
 * error for consumers to branch on.
 */
export class ConfigApiError extends Error {
  readonly status: number;
  readonly validation: string | null;

  constructor(status: number, validation: string | null, message: string) {
    super(message);
    this.name = "ConfigApiError";
    this.status = status;
    this.validation = validation;
  }
}

export class ConfigResponseShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigResponseShapeError";
  }
}

function assertAppConfig(value: unknown): asserts value is AppConfig {
  if (typeof value !== "object" || value === null) {
    throw new ConfigResponseShapeError("expected object at the response root");
  }
  const budget = (value as { budget?: unknown }).budget;
  if (budget !== undefined && !isValidBudget(budget)) {
    throw new ConfigResponseShapeError(
      "expected budget to be null or a finite number greater than 0",
    );
  }
}

async function throwOnError(response: Response, verb: string): Promise<never> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const validation = body && typeof body.error === "string" ? body.error : null;
  const detail = validation ?? response.statusText;
  throw new ConfigApiError(
    response.status,
    validation,
    `${verb} /api/config failed (${response.status}): ${detail}`,
  );
}

export async function getConfig(signal?: AbortSignal): Promise<AppConfig> {
  const response = await fetch("/api/config", { signal });
  if (!response.ok) return throwOnError(response, "GET");
  const body: unknown = await response.json();
  assertAppConfig(body);
  return body;
}

/** `budget: null` clears a previously set budget. */
export async function putConfig(
  patch: Partial<AppConfig>,
  signal?: AbortSignal,
): Promise<AppConfig> {
  const response = await fetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    signal,
  });
  if (!response.ok) return throwOnError(response, "PUT");
  const body: unknown = await response.json();
  assertAppConfig(body);
  return body;
}
