// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * `app/(app)/students/[studentId]/page.tsx` — M5 slice 11 (plan's own
 * "not optional"). M2.5 shipped seven green slices and 616 passing tests
 * with no screen a child could reach a checkpoint from; a persona picker
 * linked from nothing is the same failure. This asserts the fix the plan
 * asks for by name: **rendering** the student page, not reading its source,
 * proves a link with `href="/students/[studentId]/voice"` actually reaches
 * the DOM — a source-level check of "the component exists" would have
 * passed throughout M2.5's broken state exactly as this file's earlier
 * failing run (before the fix) proves below.
 */

const dalMock = {
  requireStudentProfile: vi.fn(),
};
vi.mock("@/lib/auth/dal", () => dalMock);

const dbMock = {
  directNotice: { count: vi.fn(async () => 0) },
  upload: { findMany: vi.fn(async () => []) },
  skillMastery: { findMany: vi.fn(async () => []) },
  practiceSet: {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => null),
  },
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const personasDalMock = {
  findPersonaById: vi.fn(),
  findPersonaBySlug: vi.fn(),
};
vi.mock("@/lib/personas/dal", () => personasDalMock);

// `StartCheckpointButton` is a client component that calls `useRouter()`.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: vi.fn(),
}));

const { default: StudentHomePage } = await import("@/app/(app)/students/[studentId]/page");

function activeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "sp_1",
    userId: "user_1",
    ageBand: "ZERO_TO_TWELVE",
    status: "ACTIVE",
    displayName: "Riley",
    gradeLevel: "GRADE_4",
    subjects: ["MATH"],
    avatarId: null,
    activatedAt: new Date("2026-08-01T00:00:00Z"),
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    personaId: null,
    captionsEnabled: true,
    ...overrides,
  };
}

const ctx = () => ({ params: Promise.resolve({ studentId: "sp_1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.directNotice.count.mockResolvedValue(0);
  dbMock.upload.findMany.mockResolvedValue([]);
  dbMock.skillMastery.findMany.mockResolvedValue([]);
  dbMock.practiceSet.findMany.mockResolvedValue([]);
  dbMock.practiceSet.findFirst.mockResolvedValue(null);
});

describe("the way in to the voice picker", () => {
  it("renders a link to the voice route when the profile has never chosen a persona", async () => {
    dalMock.requireStudentProfile.mockResolvedValue(activeProfile({ personaId: null }));
    personasDalMock.findPersonaBySlug.mockResolvedValue({ id: "per_love", slug: "professor-love", label: "Professor Love" });

    render(await StudentHomePage(ctx() as never));

    const link = screen.getByRole("link", { name: /choose your tutor's voice/i });
    expect(link).toHaveAttribute("href", "/students/sp_1/voice");
    // AC 4, honoured here: a null personaId is the DEFAULT, not "no voice" —
    // the copy must name the default persona rather than claim there is none.
    expect(screen.getByText(/professor love reads lessons aloud by default/i)).toBeInTheDocument();
    expect(personasDalMock.findPersonaById).not.toHaveBeenCalled();
  });

  it("names the chosen persona and offers to change it once one is picked", async () => {
    dalMock.requireStudentProfile.mockResolvedValue(activeProfile({ personaId: "per_vale" }));
    personasDalMock.findPersonaById.mockResolvedValue({ id: "per_vale", slug: "coach-vale", label: "Coach Vale" });

    render(await StudentHomePage(ctx() as never));

    const link = screen.getByRole("link", { name: /change your tutor's voice/i });
    expect(link).toHaveAttribute("href", "/students/sp_1/voice");
    expect(screen.getByText(/coach vale reads riley's lessons aloud/i)).toBeInTheDocument();
  });

  it("hides the affordance for a profile that cannot upload yet, matching the picker's own ACTIVE gate", async () => {
    dalMock.requireStudentProfile.mockResolvedValue(activeProfile({ status: "CONSENT_PENDING", displayName: null }));

    render(await StudentHomePage(ctx() as never));

    expect(screen.queryByRole("link", { name: /tutor's voice/i })).not.toBeInTheDocument();
  });
});
