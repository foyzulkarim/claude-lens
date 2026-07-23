import { LockedCard } from "../../components/LockedCard.js";
import { TierBadge } from "../../components/TierBadge.js";
import { Panel } from "./Panel.js";

/**
 * §4 boundary / promptId mismatches sub-card. The underlying signal
 * is `Σ Session.premium.promptIdMismatchCount` and `Σ
 * Session.premium.unbucketedTailCount` — both are computed by
 * `reconcilePremium` and aggregated on the store. This panel
 * surfaces the totals across the fleet.
 *
 * Currently 🔴 (locked card) — the §4 sub-card ships as a
 * placeholder until the page is wired to surface the aggregated
 * counts directly. The data is on the store (via `Session.premium`);
 * the page wiring for "Σ across sessions" is the only remaining
 * step, deferred to keep this slice shippable.
 */
export function BoundaryMismatchesPanel() {
  return (
    <Panel
      title="Boundary / promptId mismatches"
      right={<TierBadge level="locked">premium</TierBadge>}
      description="C samples whose promptId doesn't match any turn, or whose timestamp falls outside every turn's time range."
    >
      <LockedCard
        title="Coming soon"
        message="The per-session counts are computed by reconcile-premium and stored on Session.premium; the fleet Σ will land in a follow-up."
        ctaLabel="See Settings →"
        ctaHref="/settings"
      />
    </Panel>
  );
}
