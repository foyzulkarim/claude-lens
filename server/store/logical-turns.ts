import type { Turn } from "../../shared/types.js";

/**
 * A user-visible grouping of one or more derived `Turn` records that share a
 * `promptId`. The Store continues to derive separate main/sidechain `Turn`
 * records for isolation (see `derive-turns.ts`); this adapter groups them
 * back together so the Session Detail page, the dashboard session-list
 * traces, and the metrics turn counts/distributions all observe a single
 * one-based turn number per user prompt instead of seeing each sidechain
 * segment as its own turn.
 *
 * Wire consumers never see `LogicalTurn` directly — it is consumed by the
 * pure projector in `server/session-detail/projector.ts` to build each
 * `SessionDetailTurn`, and by `server/store/derive-session.ts` to derive
 * `Session.turnCount` and `Session.maxTurnCostComputed`. (#P4-5, A4)
 */
export interface LogicalTurn {
  /** One-based, monotonically increasing in chronological order. */
  turnNumber: number;
  promptId: string;
  promptText?: string;
  /** Main-thread segment when present. Sidechain-only logical turns leave this undefined. */
  main?: Turn;
  /** All sidechain segments sharing this promptId, in the order `derive-turns` produced them. */
  sidechains: Turn[];
  /** Min across prompt and segment calls; undefined when no timestamps are available. */
  startedAt?: string;
  /** Max across prompt and segment calls; undefined when no timestamps are available. */
  endedAt?: string;
}

/**
 * Groups derived `Turn` records by `promptId` into stable, chronological
 * logical turns. The input order determines the output order (the existing
 * `derive-turns` implementation produces turns in chronological
 * call-arrival order, so this preserves user-visible turn numbering across
 * recomputes).
 *
 * Edge cases:
 *  - Empty input → empty output.
 *  - Sidechain-only turn (no main segment) → emitted as a logical turn with
 *    `main` undefined and the sidechain in `sidechains[]`. The Session
 *    Detail page and the metrics engine must still see one prompt turn.
 */
export function groupLogicalTurns(turns: Turn[]): LogicalTurn[] {
  const order: string[] = [];
  const groups = new Map<string, LogicalTurn>();

  for (const turn of turns) {
    let group = groups.get(turn.promptId);
    if (!group) {
      group = {
        turnNumber: 0, // assigned below so order is determined by first sighting
        promptId: turn.promptId,
        promptText: turn.promptText,
        main: undefined,
        sidechains: [],
        startedAt: undefined,
        endedAt: undefined,
      };
      groups.set(turn.promptId, group);
      order.push(turn.promptId);
    }
    if (turn.promptText !== undefined && group.promptText === undefined) {
      // derive-turns only carries prompt text on the main segment. If the
      // derived turn order happens to surface the sidechain first, lift the
      // prompt text onto the group so a sidechain-only session still
      // surfaces the user prompt in Session Detail.
      group.promptText = turn.promptText;
    }
    if (turn.isSidechain) {
      group.sidechains.push(turn);
    } else {
      group.main = turn;
    }
    if (group.startedAt === undefined || turn.startedAt < group.startedAt) {
      group.startedAt = turn.startedAt;
    }
    if (group.endedAt === undefined || turn.endedAt > group.endedAt) {
      group.endedAt = turn.endedAt;
    }
  }

  const result: LogicalTurn[] = [];
  for (let i = 0; i < order.length; i++) {
    const promptId = order[i];
    if (promptId === undefined) continue;
    const group = groups.get(promptId);
    if (!group) continue;
    result.push({ ...group, turnNumber: i + 1 });
  }
  return result;
}

/**
 * Aggregates cost across one logical turn's segments. Used by
 * `derive-session.ts` for `maxTurnCostComputed` and by the Session Detail
 * projector for per-turn rollups; keeping the helper here avoids two
 * divergent aggregation rules. The pricer is injected so cost stays the
 * metrics engine's single source of truth.
 */
export function aggregateLogicalTurnCost(
  group: LogicalTurn,
  pricer: (usage: Turn["usage"], model: string) => number,
): number {
  let cost = 0;
  if (group.main) {
    for (const call of group.main.calls) {
      cost += pricer(call.usage, call.model);
    }
  }
  for (const side of group.sidechains) {
    for (const call of side.calls) {
      cost += pricer(call.usage, call.model);
    }
  }
  return cost;
}
