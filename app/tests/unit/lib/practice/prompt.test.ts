import { describe, expect, it } from "vitest";

import { buildPracticeUserPrompt, PRACTICE_PROMPT_VERSION, PRACTICE_SYSTEM_PROMPT } from "@/lib/practice/prompt";
import { candidateSlate } from "@/lib/taxonomy";

/**
 * M2 AC 27: "the outbound request to Anthropic contains the problem text,
 * subject and grade level, and contains no display name, avatar id, account
 * email, user id or student profile id." `buildPracticeUserPrompt`'s own
 * signature (`lib/practice/prompt.ts`) has no such fields to leak — this
 * test proves the RENDERED prompt string itself carries none either.
 */
describe("buildPracticeUserPrompt — AC 27, no identifying information", () => {
  it("contains the source problem text, grade level and skill menu, and nothing that looks like an id or an email", () => {
    const slate = candidateSlate({ subjects: ["MATH"], gradeLevel: "GRADE_4", bandGrades: 1 });
    const prompt = buildPracticeUserPrompt({
      gradeLevel: "GRADE_4",
      slate,
      slots: [
        { sourceText: "What is 1/4 + 1/4?", subject: "MATH", difficultyOffset: 0 },
        { sourceText: "What is 2 x 3?", subject: "MATH", difficultyOffset: 1 },
      ],
    });

    expect(prompt).toContain("What is 1/4 + 1/4?");
    expect(prompt).toContain("Grade 4");
    expect(prompt).toContain("4.NF.B.3");

    // No email, no cuid-shaped id, no "studentProfileId"/"userId" keys.
    expect(prompt).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    expect(prompt).not.toContain("studentProfileId");
    expect(prompt).not.toContain("userId");
    expect(prompt).not.toMatch(/\bc[a-z0-9]{20,}\b/); // a cuid-shaped id
  });

  it("PRACTICE_PROMPT_VERSION and PRACTICE_SYSTEM_PROMPT are non-empty (recorded on PracticeSet.promptVersion)", () => {
    expect(PRACTICE_PROMPT_VERSION.length).toBeGreaterThan(0);
    expect(PRACTICE_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });
});
