import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DIRECT_NOTICE_COPY, DIRECT_NOTICE_VERSION } from "@/lib/notice/copy";

/**
 * §312.4(b) requires the direct notice to name each third party that receives a
 * child's personal information and say what it receives.
 *
 * M5 shipped a second AI vendor — `lib/narration/provider.ts` POSTs a sentence
 * describing a specific child's schoolwork to ElevenLabs — and the notice still
 * listed only the four processors M0 knew about. Nobody noticed for the length
 * of the milestone, because nothing connects "we added an outbound vendor call"
 * to "the notice enumerates our vendors".
 *
 * This test is that connection, in the same shape as the retention-coverage and
 * blob-claimant tests: it reads the SOURCE, not a registry, and fails on
 * anything the notice does not account for. Adding the next vendor is then a
 * notice edit rather than a rediscovery of this gap.
 */
describe("the §312.4 direct notice names every third party that receives child data", () => {
  const repoRoot = process.cwd();

  /**
   * The marker each vendor leaves in `lib/`, and the notice entry that must
   * cover it.
   *
   * Keyed on whatever the outbound call actually introduces, which is NOT
   * uniformly a hostname: ElevenLabs is called with `fetch` against a literal
   * base URL (ADR-0020), while Anthropic goes through an SDK that owns its own
   * host, so the only thing in our source is the package import. Using
   * "api.anthropic.com" here would have made this test pass while matching
   * nothing — which is the failure mode it exists to prevent.
   */
  const VENDOR_MARKERS: Record<string, string> = {
    "@anthropic-ai/sdk": "Anthropic",
    "api.elevenlabs.io": "ElevenLabs",
  };

  /**
   * Modules that legitimately hold no vendor host: the check below greps the
   * whole `lib/` tree, so a host appearing anywhere is what matters, not where.
   */
  function libSources(): string {
    const files = execSync(`find ${path.join(repoRoot, "lib")} -name '*.ts' -not -path '*/generated/*'`, {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    return files.map((file) => readFileSync(file, "utf8")).join("\n");
  }

  it("finds the vendor hosts it expects (guards against the grep silently matching nothing)", () => {
    const sources = libSources();
    // Without this, a refactor that moved every client out of `lib/` would make
    // the assertion below vacuously true — lesson 22's failure mode.
    expect(sources.length).toBeGreaterThan(10_000);
    expect(sources).toContain("@anthropic-ai/sdk");
    expect(sources).toContain("api.elevenlabs.io");
  });

  it("every vendor reachable from lib/ is named in DIRECT_NOTICE_COPY.thirdParties", () => {
    const sources = libSources();
    const named = DIRECT_NOTICE_COPY.thirdParties.map((party) => party.name);

    const missing = Object.entries(VENDOR_MARKERS)
      .filter(([marker]) => sources.includes(marker))
      .filter(([, vendor]) => !named.includes(vendor))
      .map(([marker, vendor]) => `${vendor} (${marker})`);

    expect(
      missing,
      `These vendors receive data from this app but are not named in DIRECT_NOTICE_COPY.thirdParties ` +
        `(lib/notice/copy.ts). §312.4(b) requires the direct notice to name each third party and say what ` +
        `it receives — and app/privacy/page.tsx must match: ${missing.join(", ")}`,
    ).toEqual([]);
    // The marker table itself must not silently stop matching (lesson 22).
    expect(Object.keys(VENDOR_MARKERS).filter((marker) => sources.includes(marker)).length).toBe(
      Object.keys(VENDOR_MARKERS).length,
    );
  });

  it("the privacy page names the same third parties as the notice", () => {
    // Two surfaces, one obligation. They drifted in M5 only because both were
    // edited by hand and neither referenced the other.
    const privacyPage = readFileSync(path.join(repoRoot, "app/privacy/page.tsx"), "utf8");

    const missing = DIRECT_NOTICE_COPY.thirdParties
      .map((party) => party.name)
      .filter((name) => !privacyPage.includes(name));

    expect(
      missing,
      `Named in the direct notice but absent from app/privacy/page.tsx: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("every third party says what it receives", () => {
    for (const party of DIRECT_NOTICE_COPY.thirdParties) {
      expect(party.receives.trim().length, `"${party.name}" has no description of what it receives`).toBeGreaterThan(20);
    }
  });

  it("the notice version was bumped past M0's, since the copy has changed since", () => {
    // Not a general mechanism — the docstring in copy.ts says bumping on a copy
    // change is a review discipline. This pins the ONE bump we know is required:
    // the M5 vendor addition.
    expect(DIRECT_NOTICE_VERSION).not.toBe("2026-08-26.1");
    expect(DIRECT_NOTICE_COPY.version).toBe(DIRECT_NOTICE_VERSION);
  });
});
