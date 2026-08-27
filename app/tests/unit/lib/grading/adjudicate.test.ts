import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADR-0011 §2/§4 (B32). Two things are tested here: the outcome mapping
 * (refusal/null-parse/UNSURE all collapse to a state `grade.ts` treats as
 * UNSCORED), and — the more consequential half — `stripAnswerFromHint`, the
 * POST-check that runs on every model-generated hint regardless of what the
 * prompt asked for (M2 AC 11, ADR-0011 §4: "enforced by a post-check... not
 * by trusting the prompt").
 */

const parseMock = vi.fn();
const getAnthropicClientMock = vi.fn(() => ({ messages: { parse: parseMock } }));

vi.mock("@/lib/ai/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/client")>("@/lib/ai/client");
  return { ...actual, getAnthropicClient: getAnthropicClientMock };
});

const { adjudicate, stripAnswerFromHint } = await import("@/lib/grading/adjudicate");
const { HINT_FALLBACK } = await import("@/lib/errors");

const BASE_ARGS = {
  facts: { gradeLevel: "GRADE_4", subject: "MATH" } as const,
  problemText: "What is 1/4 + 1/4?",
  answerFormat: "FRACTION" as const,
  canonicalAnswer: "1/2",
  acceptedForms: ["0.5", "2/4"],
  submittedAnswer: "something",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("stripAnswerFromHint — the post-check (ADR-0011 §4, M2 AC 11)", () => {
  it("passes through a hint that does not mention the answer or any accepted form", () => {
    const hint = "Try adding the numerators first.";
    expect(stripAnswerFromHint(hint, "1/2", ["0.5"])).toBe(hint);
  });

  it("REGRESSION: discards a hint that states the canonical answer verbatim", () => {
    const hint = "The answer is 1/2, so check your addition.";
    expect(stripAnswerFromHint(hint, "1/2", ["0.5"])).toBe(HINT_FALLBACK);
  });

  it("discards a hint that states an ACCEPTED FORM of the answer, not just the canonical spelling", () => {
    const hint = "It's the same as 0.5 once you convert it.";
    expect(stripAnswerFromHint(hint, "1/2", ["0.5"])).toBe(HINT_FALLBACK);
  });

  it("discards a hint that leaks the answer with different casing or extra whitespace", () => {
    const hint = "It's   1/2   if you simplify.";
    expect(stripAnswerFromHint(hint, "1/2", [])).toBe(HINT_FALLBACK);
  });

  it("does not false-positive on a hint that merely shares digits with the answer in an unrelated context", () => {
    // "12" contains "1" and "2" but is not "1/2" — must not trigger the fallback.
    const hint = "Think about what happens when you have 12 equal pieces.";
    expect(stripAnswerFromHint(hint, "1/2", [])).toBe(hint);
  });
});

describe("adjudicate — outcome mapping", () => {
  it("CORRECT verdict returns outcome CORRECT with its hint", async () => {
    parseMock.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: { verdict: "CORRECT", hint: "n/a" },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const result = await adjudicate(BASE_ARGS);
    expect(result).toEqual({ outcome: "CORRECT", hint: "n/a" });
  });

  it("INCORRECT verdict returns outcome INCORRECT with a post-checked hint", async () => {
    parseMock.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: { verdict: "INCORRECT", hint: "Check your denominators." },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const result = await adjudicate(BASE_ARGS);
    expect(result).toEqual({ outcome: "INCORRECT", hint: "Check your denominators." });
  });

  it("a leaking INCORRECT hint is replaced with HINT_FALLBACK before it ever leaves this function", async () => {
    parseMock.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: { verdict: "INCORRECT", hint: "The answer is 1/2." },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const result = await adjudicate(BASE_ARGS);
    expect(result).toEqual({ outcome: "INCORRECT", hint: HINT_FALLBACK });
  });

  it("UNSURE verdict returns outcome UNSURE with no hint field carried", async () => {
    parseMock.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: { verdict: "UNSURE", hint: "n/a" },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const result = await adjudicate(BASE_ARGS);
    expect(result).toEqual({ outcome: "UNSURE" });
  });

  it("a refusal (stop_reason: 'refusal') returns UPSTREAM_FAILURE, checked before parsed_output is read", async () => {
    parseMock.mockResolvedValue({ stop_reason: "refusal", parsed_output: null, usage: { input_tokens: 1, output_tokens: 1 } });
    const result = await adjudicate(BASE_ARGS);
    expect(result).toEqual({ outcome: "UPSTREAM_FAILURE" });
  });

  it("a null parsed_output returns UPSTREAM_FAILURE", async () => {
    parseMock.mockResolvedValue({ stop_reason: "end_turn", parsed_output: null, usage: { input_tokens: 1, output_tokens: 1 } });
    const result = await adjudicate(BASE_ARGS);
    expect(result).toEqual({ outcome: "UPSTREAM_FAILURE" });
  });

  it("a thrown error (timeout, upstream) is caught and returns UPSTREAM_FAILURE rather than propagating", async () => {
    parseMock.mockRejectedValue(new Error("network down"));
    const result = await adjudicate(BASE_ARGS);
    expect(result).toEqual({ outcome: "UPSTREAM_FAILURE" });
  });

  it("the outbound request carries no name, id or email — only OutboundLearnerFacts (M2 AC 27)", async () => {
    parseMock.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: { verdict: "CORRECT", hint: "n/a" },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await adjudicate(BASE_ARGS);
    const [request] = parseMock.mock.calls[0] as [{ messages: { content: string }[] }];
    const serialized = JSON.stringify(request.messages);
    expect(serialized).not.toMatch(/@/); // no email address
    expect(serialized).not.toContain("studentProfileId");
    expect(serialized).not.toContain("userId");
  });
});
