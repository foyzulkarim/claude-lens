import { LockedCard } from "../../components/LockedCard.js";
import { SectionHeader } from "./SectionHeader.js";

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
    <section
      aria-labelledby="data-health-boundary-mismatches-title"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <SectionHeader
        title="Boundary / promptId mismatches"
        right={<span className="text-xs text-slate-500 dark:text-[#8A95A3]">premium · 🔴</span>}
        description="C samples whose promptId doesn't match any turn, or whose timestamp falls outside every turn's time range."
      />
      <LockedCard
        title="Coming soon"
        message="The per-session counts are computed by reconcile-premium and stored on Session.premium; the fleet Σ will land in a follow-up."
        ctaLabel="See Settings →"
        ctaHref="/settings"
      />
    </section>
  );
}
