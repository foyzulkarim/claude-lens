import { LockedCard } from "../../components/LockedCard.js";

/**
 * 🔴 `$/1k-lines by model` (pages spec §6 — "🔴" tier, unlocked by
 * `linesAdded` / `linesRemoved` from the `<session>.cost.jsonl`
 * premium capture). Pure presentation wrapper around the existing
 * `<LockedCard>` primitive — no data fetching, no metrics query. When
 * the cost-capture feature lands (#P4-13 / #45) this component gains a
 * query hook + table body and the LockedCard is removed.
 */
export function LockedLinesPerCost() {
  return (
    <section data-testid="locked-lines-per-cost" aria-label="$/1k-lines by model">
      <LockedCard
        title="$/1k-lines by model"
        message="Premium capture: linesAdded / linesRemoved per turn unlock $/1k-lines."
      >
        <div className="h-24 rounded bg-slate-100 dark:bg-[#11161D]" />
      </LockedCard>
    </section>
  );
}
