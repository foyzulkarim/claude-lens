/**
 * Wire shape for `GET /api/capture-assets` (ARCH-producer-cost-capture-tier
 * §API Contracts, decision A5). Surfaces the absolute on-disk location of
 * the vendored `capture/` directory so `CostCaptureGuide.tsx` can render a
 * real, runnable `bash <dir>/install.sh` command instead of static text —
 * the dominant install path (`npx @foyzulkarim/claude-lens`) unpacks into
 * an unguessable `~/.npm/_npx/<hash>/…` directory that static instructions
 * cannot serve (R7).
 *
 * A dedicated route rather than a `HealthSnapshot` field: `HealthSnapshot`'s
 * own docblock forbids nullable fields, so a `string | null` path there
 * would have forced either a contract-posture violation or a sentinel value
 * plus fixture churn across its existing test files.
 */
export interface CaptureAssets {
  /**
   * Absolute path to the vendored `capture/` directory, or `null` when it
   * cannot be resolved (e.g. a dev server started outside a build, or a
   * stripped install missing the `dist/capture` copy — S7). Clients render
   * manual fallback instructions in the `null` case rather than a broken
   * path.
   */
  captureDir: string | null;
}
