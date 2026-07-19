/**
 * Gate pass-rate trend per week (pages spec §8). `measures.ts`'s
 * `gatePassRate` case unconditionally returns `null` today — issue #42
 * itself scopes this section as a stub pending #P4-12's gates engine
 * (ARCH-trends-calendar-budget.md decision A3). Rendering a query for an
 * always-null measure would just be a chart of empty points, which is
 * worse UX than an honest notice — same convention `AnomalyFeed.tsx`
 * already uses for its own `gateFailure`/`captureGap` stub state.
 */
export function GatePassRateStub() {
  return (
    <section
      data-testid="gate-pass-rate-stub"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
        Gate pass rate per week{" "}
        <span className="text-xs font-normal text-slate-500 dark:text-[#8A96A5]">habits</span>
      </h2>
      <p role="status" className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">
        Gate pass-rate data isn't available yet — arrives with #P4-12.
      </p>
    </section>
  );
}
