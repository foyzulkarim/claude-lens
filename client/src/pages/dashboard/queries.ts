import type { SessionListParams } from "../../../../shared/sessions-contract.js";

/**
 * Params for the CaptureBanner's `listSessions` probe: the banner reads only
 * `meta.globalCapture` off the response (architecture §"Capture banner",
 * T14) and is intentionally filter-independent (section-level lock —
 * global capture presence doesn't vary with the active filter bar), so it
 * fetches `limit: 1` with no filter/date params rather than reusing
 * `filtersToQuery`.
 */
export function globalCaptureProbeParams(): SessionListParams {
  return { limit: 1 };
}
