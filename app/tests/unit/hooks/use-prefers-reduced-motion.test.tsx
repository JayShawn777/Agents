// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

/**
 * `hooks/use-prefers-reduced-motion.ts` (AC 15) — recovered verbatim from git
 * history (deleted in `19ae751`). Its own docstring already explains why it
 * was struck and why it is back; these tests are new, not recovered, because
 * the point of bringing the hook back is that it now gates something real
 * (`stage-motion.test.tsx`) rather than a no-op transition.
 */

type Listener = (event: { matches: boolean }) => void;

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  let listener: Listener | null = null;
  const mql = {
    get matches() {
      return matches;
    },
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_: string, cb: Listener) => {
      listener = cb;
    },
    removeEventListener: () => {
      listener = null;
    },
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
  return {
    change(next: boolean) {
      matches = next;
      listener?.({ matches: next });
    },
  };
}

function Probe() {
  const reduced = usePrefersReducedMotion();
  return <span data-testid="value">{String(reduced)}</span>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePrefersReducedMotion", () => {
  it("reads the current media query value on first render", () => {
    installMatchMedia(true);
    render(<Probe />);
    expect(screen.getByTestId("value")).toHaveTextContent("true");
  });

  it("reflects false when the system has no preference", () => {
    installMatchMedia(false);
    render(<Probe />);
    expect(screen.getByTestId("value")).toHaveTextContent("false");
  });

  /** The whole reason this is `useSyncExternalStore` and not read-once state. */
  it("updates when the system preference changes while mounted", () => {
    const media = installMatchMedia(false);
    render(<Probe />);
    expect(screen.getByTestId("value")).toHaveTextContent("false");

    act(() => {
      media.change(true);
    });
    expect(screen.getByTestId("value")).toHaveTextContent("true");
  });

  it("does not throw when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(() => render(<Probe />)).not.toThrow();
    expect(screen.getByTestId("value")).toHaveTextContent("false");
  });
});
