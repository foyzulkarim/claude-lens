import type { CacheLabAnalysis } from "../../../../shared/cache-lab-contract.js";

/**
 * TTL bucket mix panel (ARCH §T6 R5): 5m vs 1h vs unknown composition
 * of cache creation tokens. The composition bar is the canonical
 * visualization; it's also the page's "are you writing mostly
 * short-lived cached contexts (5m-heavy) or long-lived ones (1h-heavy)?"
 * answer in a glance. Always reconciliation-safe:
 *   5m + 1h + unknown === total cache creation tokens.
 */
export function TtlMixPanel({ data }: { data: CacheLabAnalysis | undefined }) {
  if (!data) {
    return (
      <section
        data-testid="ttl-mix"
        className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">TTL mix</h2>
        <p role="status" className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">
          Loading…
        </p>
      </section>
    );
  }
  const { ttlMix } = data;
  const total = ttlMix.ephemeral5mTokens + ttlMix.ephemeral1hTokens + ttlMix.unknownTokens;
  const pctOf = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  return (
    <section
      data-testid="ttl-mix"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">TTL mix</h2>
      <p className="mt-1 text-xs text-slate-600 dark:text-[#8A96A5]">
        cache_creation.ephemeral_5m_input_tokens vs ephemeral_1h_input_tokens
      </p>

      {total === 0 ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-[#8B98A9]">
          No cache creation in range.
        </p>
      ) : (
        <>
          <div
            role="img"
            aria-label={`TTL mix: 5-minute ${pctOf(ttlMix.ephemeral5mTokens)}%, 1-hour ${pctOf(
              ttlMix.ephemeral1hTokens,
            )}%, unknown ${pctOf(ttlMix.unknownTokens)}%`}
            className="mt-4 flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-[#1B222B]"
          >
            <div
              className="bg-amber-400 dark:bg-amber-500"
              style={{ width: `${pctOf(ttlMix.ephemeral5mTokens)}%` }}
            />
            <div
              className="bg-cyan-500 dark:bg-cyan-400"
              style={{ width: `${pctOf(ttlMix.ephemeral1hTokens)}%` }}
            />
            <div
              className="bg-slate-300 dark:bg-slate-600"
              style={{ width: `${pctOf(ttlMix.unknownTokens)}%` }}
            />
          </div>

          <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-amber-700 dark:text-amber-300">5-minute</dt>
              <dd className="font-mono text-slate-900 dark:text-[#E8EDF2]">
                {ttlMix.ephemeral5mTokens.toLocaleString()} ({pctOf(ttlMix.ephemeral5mTokens)}%)
              </dd>
            </div>
            <div>
              <dt className="text-cyan-700 dark:text-cyan-300">1-hour</dt>
              <dd className="font-mono text-slate-900 dark:text-[#E8EDF2]">
                {ttlMix.ephemeral1hTokens.toLocaleString()} ({pctOf(ttlMix.ephemeral1hTokens)}%)
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-[#8A96A5]">Unknown</dt>
              <dd className="font-mono text-slate-900 dark:text-[#E8EDF2]">
                {ttlMix.unknownTokens.toLocaleString()} ({pctOf(ttlMix.unknownTokens)}%)
              </dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
