import { describe, expect, it } from "vitest";
import { z } from "zod";

import { toFieldErrors } from "@/lib/errors";

describe("toFieldErrors()", () => {
  it("returns fieldErrors for a per-field violation", () => {
    const schema = z.object({ ageBand: z.enum(["UNDER_13", "AGE_13_17", "ADULT"]) }).strict();
    const result = schema.safeParse({ ageBand: "NOT_A_BAND" });
    if (result.success) throw new Error("expected parse failure");

    const { fieldErrors, formErrors } = toFieldErrors(result.error);
    expect(fieldErrors.ageBand).toBeTruthy();
    expect(formErrors).toEqual([]);
  });

  it("returns formErrors — not an empty fieldErrors object with no explanation — for a .strict() unrecognized-key violation (AC 8/9)", () => {
    // Mirrors the age-gate schema (`createStudentInputSchema`): `.strict()`
    // with exactly one declared key. A body carrying an extra key (a
    // child's name, submitted alongside `ageBand`) is exactly the case a
    // prior version of `toFieldErrors()` silently swallowed: it read only
    // `flattenError().fieldErrors`, which zod leaves EMPTY for this failure
    // mode — the violation lands in `formErrors` instead.
    const schema = z.object({ ageBand: z.enum(["UNDER_13", "AGE_13_17", "ADULT"]) }).strict();
    const result = schema.safeParse({ ageBand: "UNDER_13", displayName: "Sam" });
    if (result.success) throw new Error("expected parse failure");

    const { fieldErrors, formErrors } = toFieldErrors(result.error);
    expect(fieldErrors).toEqual({});
    expect(formErrors.length).toBeGreaterThan(0);
  });
});
