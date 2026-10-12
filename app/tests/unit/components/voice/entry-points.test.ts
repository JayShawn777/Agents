import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * **M6 AC 22 and AC 2, as static checks over the source tree.**
 *
 * Same mechanism and same reasoning as `single-reader.test.ts` and
 * `no-voice-id-literals.test.ts` (retro lesson 22): a convention that lives only
 * in a docstring is one hurried import away from being gone, and nothing would
 * fail — the page renders, the microphone opens, the voice is cloned.
 *
 * These two are the structural half of this milestone's abuse story. The threat
 * M6 exists to prevent is a CHILD cloning a classmate, and neither endpoint
 * scoping nor consent wording addresses it. What addresses it is that no
 * student-facing surface can reach the flow at all, and that a microphone can be
 * opened from exactly one place.
 */
const repoRoot = process.cwd();

function sourceFiles(roots: string[]): string[] {
  return execSync(
    // Quoted: the `(app)` route group would otherwise be shell syntax.
    `find ${roots.map((r) => `'${repoRoot}/${r}'`).join(" ")} -type f \\( -name '*.ts' -o -name '*.tsx' \\) ` +
      `-not -path '*/generated/*' 2>/dev/null || true`,
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .map((file) => path.relative(repoRoot, file));
}

describe("AC 22 — a microphone is opened from exactly one file", () => {
  const RECORDER = "components/voice/use-voice-recorder.ts";
  const GET_USER_MEDIA = /getUserMedia|new MediaRecorder\(/;

  it("finds the source tree (guards against the search matching nothing)", () => {
    const files = sourceFiles(["lib", "app", "components", "hooks"]);
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(RECORDER);
  });

  it("the recorder really does open a microphone (the check is not vacuous)", () => {
    expect(GET_USER_MEDIA.test(readFileSync(path.join(repoRoot, RECORDER), "utf8"))).toBe(true);
  });

  it("no other module calls getUserMedia or constructs a MediaRecorder", () => {
    const offenders = sourceFiles(["lib", "app", "components", "hooks"])
      .filter((file) => file !== RECORDER)
      .filter((file) => GET_USER_MEDIA.test(readFileSync(path.join(repoRoot, file), "utf8")));

    expect(
      offenders,
      `These files open a microphone directly. Every capture must go through ` +
        `${RECORDER}, which is the one place that stops the MediaStream tracks on every exit ` +
        `path and the one place to audit for consent: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

describe("AC 2 — no student-facing route reaches the voice flow", () => {
  const VOICE_ROUTE = "/account/voice";

  it("finds the student routes (guards against the search matching nothing)", () => {
    const files = sourceFiles(["app/(app)/students"]);
    expect(files.length).toBeGreaterThan(0);
  });

  it("nothing under (app)/students links to the voice flow", () => {
    const offenders = sourceFiles(["app/(app)/students"]).filter((file) =>
      readFileSync(path.join(repoRoot, file), "utf8").includes(VOICE_ROUTE),
    );

    expect(
      offenders,
      `These student-facing routes reference ${VOICE_ROUTE}. The control against a child cloning a ` +
        `classmate is that no student-facing surface reaches the flow at all — endpoint scoping alone ` +
        `does not address it: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("the voice flow itself lives under /account, which is parent-only", () => {
    const files = sourceFiles(["app/(app)/account"]);
    expect(files).toContain("app/(app)/account/voice/page.tsx");
  });
});

describe("slice 9 — the voice flow has a way in", () => {
  it("the Settings page renders the Your voice card", () => {
    const settings = readFileSync(path.join(repoRoot, "app/(app)/settings/page.tsx"), "utf8");
    expect(settings).toMatch(/<YourVoiceCard\b/);
  });

  it("the card is the one place that links to /account/voice", () => {
    const linkers = sourceFiles(["app", "components"]).filter((file) =>
      readFileSync(path.join(repoRoot, file), "utf8").includes('"/account/voice"'),
    );
    expect(linkers).toEqual(["components/voice/your-voice-card.tsx"]);
  });
});
