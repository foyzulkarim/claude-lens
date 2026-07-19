import { Link } from "wouter";
import type {
  CacheLabAnalysis,
  CacheMissAttribution,
  CacheWriteCause,
  GalleryItem,
} from "../../../../shared/cache-lab-contract.js";
import { formatUnitValue } from "../../charts/units.js";
import { Badge, type BadgeVariant } from "../../components/Badge.js";

const CAUSE_VARIANT: Record<CacheWriteCause, BadgeVariant> = {
  "first-call": "neutral",
  "model-switch": "computed",
  compaction: "warn",
  unexplained: "fail",
};

const ATTRIBUTION_LABEL: Record<CacheMissAttribution, string> = {
  "ttl-lapse": "TTL lapse",
  "prefix-change": "Prefix change",
  unknown: "Unknown",
};

const ATTRIBUTION_VARIANT: Record<CacheMissAttribution, BadgeVariant> = {
  "ttl-lapse": "warn",
  "prefix-change": "fail",
  unknown: "neutral",
};

/**
 * Cache Lab invalidation gallery (ARCH §T6 R7). Each item surfaces
 * the K2 base cause, the TTL attribution, tokens, computed/null cost,
 * session identity, turn evidence, and net-negative state. The list
 * is bounded server-side (CACHE_LAB_LIMITS.GALLERY_MAX_ITEMS) and the
 * response carries `total` + `truncated` so the section header can
 * honestly disclose what is and isn't shown.
 *
 * Items with a `promptId` link to `/turns/:promptId` (the provisional
 * Turn Inspector route); items without turn attribution render a clear
 * non-link fallback rather than fabricating a destination.
 */
export function InvalidationGallery({
  data,
  error,
}: {
  data: CacheLabAnalysis | undefined;
  error?: Error | null;
}) {
  if (!data) {
    return (
      <section
        data-testid="invalidation-gallery"
        className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <h2
          id="invalidation-gallery-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          Invalidation gallery
        </h2>
        <p
          role={error ? "alert" : "status"}
          className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]"
        >
          {error ? `Cache Lab analysis failed: ${error.message}` : "Loading…"}
        </p>
      </section>
    );
  }

  const { gallery } = data;
  const truncatedText = gallery.truncated
    ? `showing ${gallery.items.length} of ${gallery.total}`
    : `${gallery.total} event${gallery.total === 1 ? "" : "s"}`;

  return (
    <section
      data-testid="invalidation-gallery"
      aria-labelledby="invalidation-gallery-heading"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="invalidation-gallery-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          Invalidation gallery
        </h2>
        <p className="font-mono text-xs text-slate-600 dark:text-[#8A96A5]">{truncatedText}</p>
      </div>

      {gallery.items.length === 0 ? (
        <p role="status" className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">
          No invalidation events in range.
        </p>
      ) : (
        <ul aria-label="Invalidation events" className="mt-3 space-y-2">
          {gallery.items.map((item) => (
            <GalleryRow key={`${item.sessionId}-${item.callId}`} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function GalleryRow({ item }: { item: GalleryItem }) {
  const timestamp = new Date(item.timestamp);
  const dateLabel = Number.isFinite(timestamp.getTime())
    ? timestamp.toISOString().replace("T", " ").slice(0, 16)
    : item.timestamp;
  const costLabel =
    item.bustLossComputed === null ? "—" : formatUnitValue(item.bustLossComputed, "$");

  const linkLabel = item.promptId
    ? `View turn for call ${item.callId} (session ${item.sessionId})`
    : null;

  return (
    <li className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 last:border-b-0 dark:border-[#232B36]">
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-[#8A96A5]">
          {dateLabel} · {item.model}
          {item.streamKey !== "main" && (
            <span className="ml-1 font-mono normal-case text-[#96631E] dark:text-[#E8A33D]">
              · {item.streamKey}
            </span>
          )}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-900 dark:text-[#E8EDF2]">
          <Badge variant={CAUSE_VARIANT[item.baseCause]}>{item.baseCause}</Badge>
          <Badge variant={ATTRIBUTION_VARIANT[item.attribution]}>
            {ATTRIBUTION_LABEL[item.attribution]}
          </Badge>
          <span className="font-mono text-xs text-slate-600 dark:text-[#8A96A5]">
            {item.cacheCreateTokens.toLocaleString()} tok · {costLabel}
          </span>
        </p>
      </div>
      {item.promptId ? (
        <Link
          href={`/turns/${item.promptId}`}
          aria-label={linkLabel ?? undefined}
          className="shrink-0 text-xs font-medium text-[#96631E] dark:text-[#E8A33D]"
        >
          View turn →
        </Link>
      ) : (
        <span className="shrink-0 text-xs text-slate-400 dark:text-[#5A6675]">
          No turn attribution
        </span>
      )}
    </li>
  );
}
