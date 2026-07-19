import type { Pricer } from "./derive-session.js";
import { aggregateLogicalTurnCost, groupLogicalTurns } from "./logical-turns.js";
import type { Store } from "./store.js";

/**
 * Fleet-wide cost baselines used by percentile/median panels (Session
 * Detail's header/turn-distribution and Turn Inspector's turn percentile).
 * Extracted out of `routes/session-detail.ts` (#P4-6) so both routes share
 * one aggregation rule instead of maintaining two copies — the same
 * rationale `logical-turns.ts`'s `aggregateLogicalTurnCost` documents for
 * per-turn cost aggregation.
 *
 * Lazy cross-session recompute, identical in shape to the metrics route —
 * the Store guards this with staleness checks and the debounce window. The
 * result is the documented "all-history" baseline; Phase 5 owns any switch
 * to a sampled/paginated variant. (#P4-5, A5)
 */
export interface FleetBaselines {
  fleetTurnCosts: number[];
  fleetSessionCosts: number[];
}

export function buildFleetBaselines(store: Store, pricer: Pricer | undefined): FleetBaselines {
  const sessions = store.listSessions();
  const turns = store.listTurns();
  const fleetTurnCosts: number[] = [];
  for (const logicalTurn of groupLogicalTurns(turns)) {
    if (!pricer) continue;
    fleetTurnCosts.push(aggregateLogicalTurnCost(logicalTurn, pricer));
  }
  const fleetSessionCosts = sessions.map((s) => s.costComputed);
  return { fleetTurnCosts, fleetSessionCosts };
}
