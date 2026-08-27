import { beforeEach, describe, expect, it, vi } from "vitest";
import { APIConnectionError, APIConnectionTimeoutError } from "@anthropic-ai/sdk";

import { createFakeStorage } from "@/tests/unit/mocks/fake-storage";

/**
 * `lib/extraction/run-extraction.ts` (B20, ADR-0005) — the status machine.
 * Per this milestone's brief: tests the FAILURE branches specifically
 * (refusal, unparseable output, timeout, missing API key) because those are
 * what will actually happen in production, plus the two success terminal
 * states and the retention-anchor stamp they share.
 */

const dbMock = {
  extraction: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  extractedProblem: {
    createMany: vi.fn(),
  },
  upload: {
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof dbMock) => Promise<unknown>)(dbMock);
    }
    return arg;
  }),
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const parseMock = vi.fn();
const getAnthropicClientMock = vi.fn(() => ({ messages: { parse: parseMock } }));

vi.mock("@/lib/ai/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/client")>("@/lib/ai/client");
  return { ...actual, getAnthropicClient: getAnthropicClientMock };
});

const { runExtraction, reapIfStale } = await import("@/lib/extraction/run-extraction");
const { MissingAnthropicApiKeyError } = await import("@/lib/ai/client");

const EXTRACTION_ID = "extraction_1";
const UPLOAD_ID = "upload_1";

function baseExtraction(overrides: Record<string, unknown> = {}) {
  return {
    id: EXTRACTION_ID,
    uploadId: UPLOAD_ID,
    status: "PENDING",
    attemptCount: 0,
    startedAt: null,
    completedAt: null,
    failureCode: null,
    upload: { pathname: "students/sp_1/uploads/a.jpg", contentType: "image/jpeg" },
    ...overrides,
  };
}

function fakeStorageWithBytes() {
  return createFakeStorage([], { readBytes: vi.fn(async () => new ArrayBuffer(8)) });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.extraction.findUnique.mockResolvedValue(baseExtraction());
  dbMock.extraction.update.mockResolvedValue(baseExtraction({ status: "RUNNING" }));
  dbMock.extractedProblem.createMany.mockResolvedValue({ count: 0 });
  dbMock.upload.updateMany.mockResolvedValue({ count: 1 });
  getAnthropicClientMock.mockImplementation(() => ({ messages: { parse: parseMock } }));
});

describe("runExtraction — transitions to RUNNING first", () => {
  it("marks RUNNING and increments attemptCount before calling the model", async () => {
    parseMock.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: { containsSchoolwork: false, problems: [] },
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await runExtraction(EXTRACTION_ID, fakeStorageWithBytes());

    expect(dbMock.extraction.update).toHaveBeenCalledWith({
      where: { id: EXTRACTION_ID },
      data: { status: "RUNNING", startedAt: expect.any(Date), attemptCount: { increment: 1 } },
    });
  });

  it("SKIPs a row that is not PENDING (a racing duplicate trigger) without touching it", async () => {
    dbMock.extraction.findUnique.mockResolvedValue(baseExtraction({ status: "RUNNING" }));

    const result = await runExtraction(EXTRACTION_ID, fakeStorageWithBytes());

    expect(result).toEqual({ status: "SKIPPED" });
    expect(dbMock.extraction.update).not.toHaveBeenCalled();
    expect(parseMock).not.toHaveBeenCalled();
  });
});

describe("runExtraction — failure branches (what actually happens in production)", () => {
  it("a refusal (stop_reason: 'refusal') is checked BEFORE parsed_output and lands FAILED/REFUSED with zero rows written", async () => {
    parseMock.mockResolvedValue({
      stop_reason: "refusal",
      parsed_output: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const result = await runExtraction(EXTRACTION_ID, fakeStorageWithBytes());

    expect(result).toEqual({ status: "FAILED", failureCode: "REFUSED" });
    expect(dbMock.extraction.update).toHaveBeenLastCalledWith({
      where: { id: EXTRACTION_ID },
      data: { status: "FAILED", failureCode: "REFUSED", completedAt: expect.any(Date) },
    });
    expect(dbMock.extractedProblem.createMany).not.toHaveBeenCalled();
    // No retention anchor on a FAILED extraction (M1 AC 36 measures from success only).
    expect(dbMock.upload.updateMany).not.toHaveBeenCalled();
  });

  it("a null parsed_output (schema validation failure, AC 23) lands FAILED/PARSE_FAILED with zero rows written", async () => {
    parseMock.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const result = await runExtraction(EXTRACTION_ID, fakeStorageWithBytes());

    expect(result).toEqual({ status: "FAILED", failureCode: "PARSE_FAILED" });
    expect(dbMock.extractedProblem.createMany).not.toHaveBeenCalled();
    expect(dbMock.upload.updateMany).not.toHaveBeenCalled();
  });

  it("a connection timeout lands FAILED/TIMEOUT — checked ahead of the generic upstream branch", async () => {
    parseMock.mockRejectedValue(new APIConnectionTimeoutError());

    const result = await runExtraction(EXTRACTION_ID, fakeStorageWithBytes());

    expect(result).toEqual({ status: "FAILED", failureCode: "TIMEOUT" });
  });

  it("any other typed Anthropic API error lands FAILED/UPSTREAM, not TIMEOUT", async () => {
    parseMock.mockRejectedValue(new APIConnectionError({ message: "network down" }));

    const result = await runExtraction(EXTRACTION_ID, fakeStorageWithBytes());

    expect(result).toEqual({ status: "FAILED", failureCode: "UPSTREAM" });
  });

  it("a missing ANTHROPIC_API_KEY fails LOUDLY as FAILED/INTERNAL — never a silent COMPLETE_EMPTY with zero problems", async () => {
    getAnthropicClientMock.mockImplementationOnce(() => {
      throw new MissingAnthropicApiKeyError();
    });

    const result = await runExtraction(EXTRACTION_ID, fakeStorageWithBytes());

    expect(result).toEqual({ status: "FAILED", failureCode: "INTERNAL" });
    expect(parseMock).not.toHaveBeenCalled();
    expect(dbMock.extractedProblem.createMany).not.toHaveBeenCalled();
  });

  it("never leaks the raw exception message or a model identifier — only the internal failure code", async () => {
    parseMock.mockRejectedValue(new Error("raw provider payload mentioning claude-opus-5"));

    const result = await runExtraction(EXTRACTION_ID, fakeStorageWithBytes());

    expect(result).toEqual({ status: "FAILED", failureCode: "INTERNAL" });
  });
});

describe("runExtraction — success stamps Upload.extractedAt, the retention anchor", () => {
  it("COMPLETE writes ExtractedProblem rows and the extractedAt stamp in ONE transaction", async () => {
    parseMock.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: {
        containsSchoolwork: true,
        problems: [
          {
            ordinal: 1,
            label: "1",
            text: "2+2=?",
            containsMath: false,
            subject: "MATH",
            problemType: "addition",
            studentAnswerText: null,
            confidence: 0.9,
          },
        ],
      },
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    const result = await runExtraction(EXTRACTION_ID, fakeStorageWithBytes());

    expect(result).toEqual({ status: "COMPLETE", problemCount: 1 });
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    expect(dbMock.extractedProblem.createMany).toHaveBeenCalledTimes(1);
    expect(dbMock.upload.updateMany).toHaveBeenCalledWith({
      where: { id: UPLOAD_ID, extractedAt: null },
      data: { extractedAt: expect.any(Date) },
    });
  });

  it("containsSchoolwork: false lands COMPLETE_EMPTY, writes zero problem rows, but still stamps extractedAt", async () => {
    parseMock.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: { containsSchoolwork: false, problems: [] },
      usage: { input_tokens: 5, output_tokens: 1 },
    });

    const result = await runExtraction(EXTRACTION_ID, fakeStorageWithBytes());

    expect(result).toEqual({ status: "COMPLETE_EMPTY" });
    expect(dbMock.extractedProblem.createMany).not.toHaveBeenCalled();
    expect(dbMock.upload.updateMany).toHaveBeenCalledWith({
      where: { id: UPLOAD_ID, extractedAt: null },
      data: { extractedAt: expect.any(Date) },
    });
  });

  it("sends a PDF as a document block, not an image block", async () => {
    dbMock.extraction.findUnique.mockResolvedValue(
      baseExtraction({ upload: { pathname: "students/sp_1/uploads/a.pdf", contentType: "application/pdf" } }),
    );
    parseMock.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: { containsSchoolwork: false, problems: [] },
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await runExtraction(EXTRACTION_ID, fakeStorageWithBytes());

    const callArgs = parseMock.mock.calls[0][0] as { messages: Array<{ content: Array<{ type: string }> }> };
    expect(callArgs.messages[0].content[0].type).toBe("document");
  });
});

describe("reapIfStale — AC 27, no request left hanging in the browser", () => {
  it("transitions a RUNNING extraction past the timeout+30s deadline to FAILED/TIMEOUT", async () => {
    const startedAt = new Date(Date.now() - (120_000 + 40_000));
    dbMock.extraction.updateMany.mockResolvedValue({ count: 1 });
    const extraction = baseExtraction({ status: "RUNNING", startedAt });

    const result = await reapIfStale(extraction as never);

    expect(result.status).toBe("FAILED");
    expect((result as { failureCode: string }).failureCode).toBe("TIMEOUT");
    expect(dbMock.extraction.updateMany).toHaveBeenCalledWith({
      where: { id: EXTRACTION_ID, status: "RUNNING" },
      data: { status: "FAILED", failureCode: "TIMEOUT", completedAt: expect.any(Date) },
    });
  });

  it("leaves a fresh RUNNING extraction untouched", async () => {
    const extraction = baseExtraction({ status: "RUNNING", startedAt: new Date() });

    const result = await reapIfStale(extraction as never);

    expect(result.status).toBe("RUNNING");
    expect(dbMock.extraction.updateMany).not.toHaveBeenCalled();
  });

  it("leaves an already-terminal extraction untouched", async () => {
    const extraction = baseExtraction({ status: "COMPLETE" });

    const result = await reapIfStale(extraction as never);

    expect(result).toBe(extraction);
    expect(dbMock.extraction.updateMany).not.toHaveBeenCalled();
  });
});
