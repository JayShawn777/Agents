// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * `app/(app)/lessons/[lessonId]/page.tsx` — M5 slice 11's second reachability
 * point. A child mid-lesson who dislikes the voice needs to act on that where
 * they feel it (next to the AI-voice disclosure), not only from the student
 * page. Renders the real page component so a missing/mis-hrefed link fails
 * the test the way M2.5's unreachable checkpoint picker should have.
 *
 * Heavy leaf components (`NarrationState`, `LessonTextView`, etc.) are
 * stubbed — this test is about reachability of the voice route, not about
 * playback — but `AiVoiceDisclosure`, the component the new link sits next
 * to, is left real.
 */

const dalMock = { requireLesson: vi.fn() };
vi.mock("@/lib/auth/dal", () => dalMock);

const authorMock = { reapIfStale: vi.fn(async (row: unknown) => row) };
vi.mock("@/lib/lessons/author", () => authorMock);

const SCRIPT = { title: "t", steps: [] };
const dtoMock = {
  toLessonDetail: vi.fn(() => ({
    lesson: { id: "les_1", status: "READY", subject: { kind: "PRACTICE_PROBLEM", id: "pp_1" }, currentVersionId: "ver_1", versionCount: 1, failureMessage: null, createdAt: "2026-08-01T00:00:00Z" },
    version: { id: "ver_1", version: 1, status: "READY", script: SCRIPT, stepCount: 0, totalDurationMs: 0, timeline: [] },
  })),
};
vi.mock("@/lib/lessons/dto", () => dtoMock);

const requestMock = { atVersionCap: vi.fn(() => false) };
vi.mock("@/lib/lessons/request", () => requestMock);

const personasDalMock = { findPersonaById: vi.fn(), findPersonaBySlug: vi.fn() };
vi.mock("@/lib/personas/dal", () => personasDalMock);

const dbMock = { studentProfile: { findUnique: vi.fn() } };
vi.mock("@/lib/db", () => ({ db: dbMock }));

vi.mock("@/components/lessons/authoring-state", () => ({ AuthoringState: () => null }));
vi.mock("@/components/lessons/failed-lesson", () => ({ FailedLesson: () => null }));
vi.mock("@/components/lessons/narration-state", () => ({ NarrationState: () => <div>narration</div> }));
vi.mock("@/components/lessons/regenerate-lesson-button", () => ({ RegenerateLessonButton: () => null }));
vi.mock("@/components/lessons/lesson-text-view", () => ({ LessonTextView: () => null }));

vi.mock("next/navigation", () => ({ notFound: vi.fn() }));

const { default: LessonPage } = await import("@/app/(app)/lessons/[lessonId]/page");

function lessonRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "les_1",
    status: "READY",
    extractedProblemId: null,
    practiceProblemId: "pp_1",
    currentVersionId: "ver_1",
    createdAt: new Date("2026-08-01T00:00:00Z"),
    versions: [{ id: "ver_1", version: 1, status: "READY", script: SCRIPT, stepCount: 0, totalDurationMs: 0, failureCode: null }],
    studentProfile: { id: "sp_1", status: "ACTIVE", gradeLevel: "GRADE_4" },
    ...overrides,
  };
}

const ctx = () => ({ params: Promise.resolve({ lessonId: "les_1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  authorMock.reapIfStale.mockImplementation(async (row: unknown) => row);
  requestMock.atVersionCap.mockReturnValue(false);
  dtoMock.toLessonDetail.mockReturnValue({
    lesson: { id: "les_1", status: "READY", subject: { kind: "PRACTICE_PROBLEM", id: "pp_1" }, currentVersionId: "ver_1", versionCount: 1, failureMessage: null, createdAt: "2026-08-01T00:00:00Z" },
    version: { id: "ver_1", version: 1, status: "READY", script: SCRIPT, stepCount: 0, totalDurationMs: 0, timeline: [] },
  });
  dbMock.studentProfile.findUnique.mockResolvedValue({ personaId: "per_vale", captionsEnabled: true });
  personasDalMock.findPersonaById.mockResolvedValue({ id: "per_vale", slug: "coach-vale", label: "Coach Vale" });
  personasDalMock.findPersonaBySlug.mockResolvedValue({ id: "per_love", slug: "professor-love", label: "Professor Love" });
});

describe("changing the voice from mid-lesson", () => {
  it("renders a change-voice link next to the disclosure, pointed at the student's picker", async () => {
    dalMock.requireLesson.mockResolvedValue(lessonRow());

    render(await LessonPage(ctx() as never));

    expect(screen.getByText(/spoken by a computer voice \(coach vale\)/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /change voice/i });
    expect(link).toHaveAttribute("href", "/students/sp_1/voice");
  });
});
