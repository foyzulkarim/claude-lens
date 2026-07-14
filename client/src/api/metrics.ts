import type { MetricsQuery, Series } from "../../../shared/metrics-contract.js";

// The one caller of POST /api/metrics (server/routes/metrics.ts). Throws on
// non-2xx so TanStack Query surfaces it via isError/error.
export async function postMetrics(query: MetricsQuery): Promise<Series[]> {
  const response = await fetch("/api/metrics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = body && typeof body.error === "string" ? body.error : response.statusText;
    throw new Error(`POST /api/metrics failed (${response.status}): ${message}`);
  }

  return response.json() as Promise<Series[]>;
}
