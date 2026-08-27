import { describe, expect, it } from "vitest";

import { toStudentProfileDTO } from "@/lib/students/dto";
import type { StudentProfile } from "@/lib/generated/prisma/client";

function profile(overrides: Partial<StudentProfile> = {}): StudentProfile {
  return {
    id: "sp_1",
    userId: "user_1",
    ageBand: "AGE_13_17",
    status: "NOTICE_PENDING",
    displayName: null,
    gradeLevel: null,
    subjects: [],
    avatarId: null,
    activatedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as StudentProfile;
}

describe("toStudentProfileDTO() — hasNotice is required, not defaulted", () => {
  it("NOTICE_PENDING with no notice yet -> nextStep NOTICE", () => {
    const dto = toStudentProfileDTO(profile({ status: "NOTICE_PENDING" }), { hasNotice: false });
    expect(dto.nextStep).toBe("NOTICE");
  });

  it("NOTICE_PENDING with a notice already served -> nextStep CONSENT, not NOTICE again", () => {
    // The bug a defaulted `hasNotice: false` produced: a caller that forgot
    // to pass it would send a parent who already saw the notice back to the
    // notice screen, creating a duplicate DirectNotice record.
    const dto = toStudentProfileDTO(profile({ status: "NOTICE_PENDING" }), { hasNotice: true });
    expect(dto.nextStep).toBe("CONSENT");
  });
});
