import { describe, expect, it } from "vitest";

import type { OutboundLearnerContext } from "@/lib/ai/outbound";
import { hashContext, LEARNER_CONTEXT_VERSION, renderLearnerContext } from "@/lib/chat/context";

const facts: OutboundLearnerContext = {
  gradeLevel: "GRADE_4",
  subjects: ["MATH", "READING"],
  skills: [
    { skillCode: "4.NF.A.1", level: "DEVELOPING" },
    { skillCode: "4.OA.A.2", level: "BEGINNING" },
  ],
};

describe("renderLearnerContext", () => {
  it("renders grade level, subjects and per-skill mastery as prose", () => {
    const rendered = renderLearnerContext(facts);

    expect(rendered).toContain("Grade level: Grade 4.");
    expect(rendered).toContain("Subjects they are working on: Math, Reading.");
    expect(rendered).toContain("- 4.NF.A.1: building confidence");
    expect(rendered).toContain("- 4.OA.A.2: just getting started");
    expect(rendered.endsWith("\n")).toBe(true);
  });

  it("stamps the context version into the output", () => {
    expect(renderLearnerContext(facts)).toContain(`Learner context (${LEARNER_CONTEXT_VERSION}).`);
  });

  // ── The determinism rules. ADR-0012 §2; each of these is M3 AC 8's mechanism. ──

  it("is byte-identical across repeated calls with the same facts", () => {
    expect(renderLearnerContext(facts)).toBe(renderLearnerContext(facts));
  });

  it("renders subjects in SUBJECT_ORDER, not the order supplied", () => {
    const reversed: OutboundLearnerContext = { ...facts, subjects: ["READING", "MATH"] };

    expect(renderLearnerContext(reversed)).toBe(renderLearnerContext(facts));
    expect(renderLearnerContext(reversed)).toContain("Math, Reading");
  });

  it("collapses duplicate subjects", () => {
    const duped: OutboundLearnerContext = { ...facts, subjects: ["MATH", "MATH", "READING"] };

    expect(renderLearnerContext(duped)).toBe(renderLearnerContext(facts));
  });

  it("sorts skills by skillCode regardless of input order", () => {
    const reversed: OutboundLearnerContext = { ...facts, skills: [...facts.skills].reverse() };

    expect(renderLearnerContext(reversed)).toBe(renderLearnerContext(facts));
  });

  it("does not reorder the caller's skills array", () => {
    const skills = [
      { skillCode: "4.OA.A.2", level: "BEGINNING" as const },
      { skillCode: "4.NF.A.1", level: "DEVELOPING" as const },
    ];
    renderLearnerContext({ ...facts, skills });

    expect(skills[0].skillCode).toBe("4.OA.A.2");
  });

  it("renders ONLY the level per skill — no counts, no timestamps", () => {
    // A timestamp anywhere in the prefix is the exact failure ADR-0012 exists
    // to prevent: it invalidates the cache every turn, silently, and the only
    // symptom is a tenfold bill.
    const rendered = renderLearnerContext({
      ...facts,
      // Extra fields a caller might splice in from a Prisma row by accident.
      skills: [
        {
          skillCode: "4.NF.A.1",
          level: "DEVELOPING",
          attemptCount: 12,
          lastPracticedAt: new Date("2026-08-27T10:00:00Z"),
        } as OutboundLearnerContext["skills"][number],
      ],
    });

    expect(rendered).toContain("- 4.NF.A.1: building confidence");
    expect(rendered).not.toContain("12");
    expect(rendered).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(rendered).not.toContain("2026");
  });

  it("carries no identifier of any kind — M3 AC 7, structurally", () => {
    const rendered = renderLearnerContext(facts).toLowerCase();

    for (const forbidden of ["@", "profileid", "userid", "avatar", "email"]) {
      expect(rendered).not.toContain(forbidden);
    }
  });

  it("handles a student with no recorded practice without inventing one", () => {
    const rendered = renderLearnerContext({ ...facts, skills: [] });

    expect(rendered).toContain("No practice has been recorded for this student yet");
    expect(rendered).not.toContain("skill by skill");
  });

  it("handles a profile with no subjects recorded", () => {
    const rendered = renderLearnerContext({ ...facts, subjects: [] });

    expect(rendered).toContain("Subjects they are working on: not recorded.");
  });
});

describe("hashContext", () => {
  it("is a sha256 hex digest", () => {
    expect(hashContext(renderLearnerContext(facts))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for identical bytes and differs for any change", () => {
    const rendered = renderLearnerContext(facts);

    expect(hashContext(rendered)).toBe(hashContext(rendered));
    // One trailing space — the kind of drift that would silently kill the cache.
    expect(hashContext(`${rendered} `)).not.toBe(hashContext(rendered));
  });

  it("is the CI half of ADR-0012 §4: hash(render(facts)) reproduces the stored hash", () => {
    const storedAtOpen = hashContext(renderLearnerContext(facts));

    expect(hashContext(renderLearnerContext(facts))).toBe(storedAtOpen);
  });
});
