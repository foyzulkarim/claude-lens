/**
 * Temporary placeholder — gives `tsc --noEmit` a real input in this root.
 * Removed by #P3-2 when the React shell (main.tsx / App.tsx) lands.
 */
import type { MetricsQuery } from "../../shared/metrics-contract.js";

export const CLIENT_ROOT: string = "client";

// Proves shared/ is consumable from the client root (#P2-1). The real query-key
// factory that serializes MetricsQuery lands with the data layer in #P3.
export function describeQuery(query: MetricsQuery): string {
  return `${query.measures.join(",")}@${query.grain}`;
}
