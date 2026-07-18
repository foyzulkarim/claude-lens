import { useEffect, useState } from "react";

const DEFAULT_REFRESH_MS = 60_000;

/**
 * A `now` that stays referentially stable across renders (so it's safe to
 * use as a TanStack Query key input without causing a refetch-every-render
 * loop) while still advancing on its own — a plain `useMemo(() => new
 * Date(), [])` would freeze `now` forever after mount, silently turning a
 * "live" card into a load-time snapshot (it never rolls a month/window
 * boundary and ignores WS-triggered refetches, since the query key never
 * changes). `injectedNow` (stories/tests) always wins and disables ticking.
 */
export function useStableNow(injectedNow?: Date, refreshMs = DEFAULT_REFRESH_MS): Date {
  const [now, setNow] = useState(() => injectedNow ?? new Date());

  useEffect(() => {
    if (injectedNow !== undefined) {
      setNow(injectedNow);
      return;
    }
    const id = setInterval(() => setNow(new Date()), refreshMs);
    return () => clearInterval(id);
  }, [injectedNow, refreshMs]);

  return now;
}
