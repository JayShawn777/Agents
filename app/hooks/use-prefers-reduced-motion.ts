"use client";

/**
 * AC 15. Recovered from git history (deleted in commit `19ae751`, when
 * ADR-0019's animation claim was struck — the hook and the motion it gated
 * were both correct in isolation, but nothing in `stage.tsx` actually
 * animated, so the preference had nothing real to switch off). M5 adds the
 * first real animation (`stage.tsx`'s step-reveal) in the same change that
 * brings this back.
 *
 * Watched rather than read once, because a viewer can change the system
 * setting while a lesson is open — someone who turns motion off part-way
 * through a lesson that is making them queasy should not have to reload.
 *
 * `useSyncExternalStore` rather than an effect that seeds state: a media
 * query IS external state, and subscribing to it directly avoids the
 * render-then-correct flash where the first paint animates and the second
 * does not.
 *
 * Unchanged from the original implementation — recovered verbatim, not
 * rewritten, per this milestone's brief.
 */

import { useCallback, useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(REDUCED_MOTION_QUERY).matches : false),
    // Server snapshot: assume motion is fine, because the preference is a
    // client fact. The client corrects it on hydration.
    () => false,
  );
}
