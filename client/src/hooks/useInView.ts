import { useEffect, useRef, useState } from "react";

/**
 * IntersectionObserver-backed visibility hook for lazy-mounted sections
 * (#P4-12 Report Card; ARCH-p4-12 §High-Level Structure). The Report
 * Card's E1/E2 filesystem check is the only piece of I/O behind the
 * surface, and gating Session Detail's first paint on it would couple
 * the score-letter visibility to the slowest linked check on the
 * machine. Mounting on `useInView(rootMargin: "200px")` lets the score
 * letter render before the user scrolls.
 *
 * Returns `(ref, inView)`. Attach `ref` to the element that should
 * trigger the load; `inView` flips to `true` once it (or its
 * `rootMargin` halo) intersects the viewport, and stays `true`
 * thereafter — there's no "scroll back, unmount" lifecycle. Falls
 * back to `true` immediately when `IntersectionObserver` is
 * unavailable (older browsers, JSDOM-only tests) so callers don't
 * have to special-case the SSR / test seam.
 *
 * Note: `inView` starts `false` even when IO is unavailable — the
 * fallback ONLY fires from inside `useEffect` (i.e. after mount),
 * not from the initial render. This is the lazy-mount contract
 * (#P4-12 review finding #4): if we hydrated to `true` from the
 * first render, every `enabled: inView` query would fire on mount,
 * defeating the point. Tests that want eager visibility should
 * pre-trigger via a real IO shim, not by relying on the fallback.
 */
export function useInView<T extends HTMLElement>(
  options: IntersectionObserverInit = {},
  _fallbackInView = false,
): { ref: React.RefObject<T | null>; inView: boolean } {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    if (typeof IntersectionObserver === "undefined") {
      // Fallback only fires once, after mount, when IO isn't available
      // (SSR, very old browsers). JSDOM is in this bucket — those
      // tests need their own eager-visibility stub (see
      // ReportCard.test.tsx).
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
            return;
          }
        }
      },
      // Read `options.<key>` directly so the closure captures only the
      // primitives — the lint exhaustive-deps rule then sees a stable
      // identity for each, not a fresh `options` object every render.
      {
        rootMargin: options.rootMargin,
        root: options.root,
        threshold: options.threshold,
      },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [options.rootMargin, options.root, options.threshold]);

  return { ref, inView };
}
