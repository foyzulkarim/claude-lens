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
 */
export function useInView<T extends HTMLElement>(
  options: IntersectionObserverInit = {},
  fallbackInView = true,
): { ref: React.RefObject<T | null>; inView: boolean } {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(fallbackInView);

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
          return;
        }
      }
    }, options);
    observer.observe(node);
    return () => observer.disconnect();
  }, [options.rootMargin, options.root, options.threshold, options]);

  return { ref, inView };
}
