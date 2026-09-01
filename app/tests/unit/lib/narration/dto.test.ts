import { describe, expect, it, vi } from "vitest";

import { toLessonNarrationDTO } from "@/lib/narration/dto";

/** `lib/narration/dto.ts` — the only place `LessonNarrationDTO` is built from Prisma rows. */

function storageMock(overrides: Partial<{ url: string; expiresAt: Date }> = {}) {
  return {
    signedReadUrl: vi.fn(async (pathname: string) => ({
      url: overrides.url ?? `https://signed.example/${pathname}`,
      expiresAt: overrides.expiresAt ?? new Date("2026-09-01T00:05:00.000Z"),
    })),
  };
}

function readyNarration() {
  return {
    id: "narr_1",
    versionId: "ver_1",
    status: "READY" as const,
    persona: { id: "persona_1", slug: "professor-love", label: "Professor Love" },
    stepCount: 2,
    totalDurationMs: 3000,
    failureCode: null,
    steps: [
      {
        stepId: "s2",
        stepIndex: 1,
        startOffsetMs: 1000,
        asset: {
          pathname: "students/prof_1/narration/key2.mp3",
          durationMs: 2000,
          cues: { v: 1, durationMs: 2000, words: [{ t: "b", s: 0, e: 100 }] },
        },
      },
      {
        stepId: "s1",
        stepIndex: 0,
        startOffsetMs: 0,
        asset: {
          pathname: "students/prof_1/narration/key1.mp3",
          durationMs: 1000,
          cues: { v: 1, durationMs: 1000, words: [{ t: "a", s: 0, e: 100 }] },
        },
      },
    ],
  };
}

describe("READY", () => {
  it("mints a signed URL per step and sorts by stepIndex regardless of input order", async () => {
    const storage = storageMock();
    const dto = await toLessonNarrationDTO(storage as never, readyNarration());

    expect(dto.status).toBe("READY");
    expect(dto.steps.map((s) => s.stepId)).toEqual(["s1", "s2"]);
    expect(dto.steps[0].audioUrl).toContain("key1.mp3");
    expect(dto.steps[1].audioUrl).toContain("key2.mp3");
    expect(storage.signedReadUrl).toHaveBeenCalledTimes(2);
  });

  it("maps stored cues { t, s, e } to the DTO's { text, startMs, endMs }", async () => {
    const dto = await toLessonNarrationDTO(storageMock() as never, readyNarration());
    expect(dto.steps[0].words).toEqual([{ text: "a", startMs: 0, endMs: 100 }]);
  });

  it("carries the persona's client-safe fields only", async () => {
    const dto = await toLessonNarrationDTO(storageMock() as never, readyNarration());
    expect(dto.persona).toEqual({ id: "persona_1", slug: "professor-love", label: "Professor Love" });
  });
});

describe("every other status", () => {
  it("mints no signed URL and returns an empty steps array — nothing to sign, nothing to play", async () => {
    const storage = storageMock();
    for (const status of ["PENDING", "GENERATING"] as const) {
      const dto = await toLessonNarrationDTO(storage as never, { ...readyNarration(), status, steps: [] });
      expect(dto.steps).toEqual([]);
    }
    expect(storage.signedReadUrl).not.toHaveBeenCalled();
  });

  it("builds an allowlisted failureMessage for FAILED, never the raw failureCode", async () => {
    const dto = await toLessonNarrationDTO(storageMock() as never, {
      ...readyNarration(),
      status: "FAILED",
      failureCode: "UNSPEAKABLE",
      steps: [],
    });
    expect(dto.failureMessage).not.toBeNull();
    expect(dto.failureMessage).not.toContain("UNSPEAKABLE");
  });

  it("falls back to the generic internal message for an unrecognised failureCode", async () => {
    const dto = await toLessonNarrationDTO(storageMock() as never, {
      ...readyNarration(),
      status: "FAILED",
      failureCode: "SOME_FUTURE_CODE",
      steps: [],
    });
    expect(dto.failureMessage).toBe("Something went wrong on our end. Please try again.");
  });

  it("degrades to an empty word list (never throws) if stored cues are malformed", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const malformed = readyNarration();
    malformed.steps[0].asset.cues = { not: "a valid shape" } as never;
    const dto = await toLessonNarrationDTO(storageMock() as never, malformed);
    const step = dto.steps.find((s) => s.stepId === "s2")!;
    expect(step.words).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("never in this DTO", () => {
  it("carries no provider voice id, model id, pathname, or cache key anywhere in the output", async () => {
    const dto = await toLessonNarrationDTO(storageMock() as never, readyNarration());
    const serialised = JSON.stringify(dto);
    for (const forbidden of ["providerVoiceId", "ttsModelId", "pathname", "cacheKey", "charactersBilled", "cacheHits"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});
