# Fix all PR 89 review findings

## Summary

Correct the Dashboard's cross-layer calculations and filtering, harden transcript/session parsing,
resolve accessibility defects, and strengthen integration/E2E coverage. Preserve the existing ahead
commit and leave `CODE-REVIEW-PR-89-sol.md` untracked and unchanged.

## Implementation Changes

- Fix savings algebra so:
  - cache savings = current-model uncached cost - actual cost;
  - routing savings = Opus-uncached cost - current-model uncached cost;
  - both segments sum exactly to Opus-uncached cost - actual cost.
  - Preserve `null` behavior for empty or unpriced groups.

- Rebuild Subscription Window around the intended token contract:
  - Probe `/api/sessions` using categorical filters only to obtain `meta.matchedExtent`.
  - Query all four token measures with `dimensions: ["time"]`, hourly grain, and that extent.
  - Merge measures by timestamp and derive rolling 5h/7d totals, historical peaks, and expiry from
    hourly token buckets.
  - Treat `ceiling` as tokens, display token units, and use the selected peak/ceiling consistently
    in visible text and ARIA range metadata.
  - Skip the metrics request and render the honest empty state when no matched extent exists.

- Convert cumulative recent-session traces into adjacent per-turn deltas before calculating bar
  heights, peaks, and accessible descriptions.

- Correct backend derivation and filtering:
  - Compute context percentage from the latest call's own usage and model window.
  - Give sessions the same synthetic `default` host used by metrics; match only when the requested
    host contains it.
  - Compare parsed date instants numerically and make both session range bounds inclusive,
    including `from === to` drill points.
  - Compute matched extents using parsed instants rather than raw timestamp strings.

- Make exit-code fallback Bash-specific:
  - Add an optional tool-use identifier to `ToolUseRef`.
  - Retain a tool-use-id to tool-name map across incremental tail reads and rebuild it from cached
    calls when possible.
  - Apply fallback exit parsing only to results originating from Bash, capture the adjacent signed
    integer, and classify it as failed only when non-zero.
  - Continue treating raw `is_error: true` as authoritative for every tool.

- Validate successful `/api/sessions` responses before returning them:
  - Check the response object, items, total, metadata, matched extent, capture flags, required item
    fields, optional numeric fields, and trace-point shapes.
  - Throw a descriptive response-shape error rather than trusting an unchecked assertion.

- Resolve accessibility issues:
  - Use a semantic `<ul>` without `role="feed"` for anomalies and update selectors accordingly.
  - Raise Savings Decomposition secondary-text colors to AA-compliant tokens in light and dark
    themes.
  - Ensure Subscription Window ceiling text, `aria-valuemax`, clamped range value, and
    `aria-valuetext` all describe the configured ceiling correctly.

## Test Plan

- Add real differentiated-pricing measure tests proving the savings invariant and guarding
  empty/unpriced groups.
- Add parser/tailer regressions for Bash exit codes, `exit code 0; copied 1 file`, non-Bash
  mentions, raw error flags, incremental chunks, and warm-cache reconstruction.
- Add session-route tests for equivalent ISO representations, inclusive upper/equal bounds,
  synthetic-host matches and misses, and daily chart drill compatibility.
- Add derivation tests for multi-call turns where cumulative turn usage differs from the latest
  call.
- Add client tests for:
  - engine-shaped hourly token series, 5h/7d boundaries, historical peak, expiry, empty extent,
    ceiling semantics, and zero denominators;
  - cumulative trace `[1, 11, 12]` becoming per-turn `[1, 10, 1]`;
  - malformed nested session responses;
  - Savings, Burn Rate, Subscription, and Leverage arithmetic edge cases.
- Update stories to route the sessions extent probe and metrics request separately and use
  token-based hourly responses.
- Expand Dashboard Cypress coverage to all 12 sections with stable fixture-derived values or
  explicit unavailable states.
- Set Cypress `defaultCommandTimeout` to 10 seconds so `cy.injectAxe()` can reliably load
  `axe.min.js`, while retaining the accessibility assertions.
- Run `npm run verify`, `npm run build`, and the complete `npm run test:e2e`; require all checks and
  all nine E2E tests to pass.

## Assumptions

- All findings in `CODE-REVIEW-PR-89-sol.md` are in scope.
- No new dependencies, persistence migration, or Settings UI will be introduced.
- Existing shared response shapes remain compatible; only `ToolUseRef.id` is an additive optional
  contract field.
- The current synthetic host value remains exactly `"default"`.
