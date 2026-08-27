import { afterEach, expect, it, vi } from "vitest";

import { apiStream } from "@/lib/api/client";
import type { ChatStreamEvent } from "@/lib/schemas/dto";

/**
 * `apiStream()` (`lib/api/client.ts`, ADR-0013 §6) — and specifically the
 * partial-line buffering, which is the accepted risk the ADR names by hand:
 * "small, but the kind of bug that passes locally and fails on a slow network."
 *
 * A `delta` WILL eventually be split mid-JSON across two TCP chunks. A naive
 * `chunk.split("\n")` per chunk works on localhost, where a small response
 * usually arrives whole. So the boundaries below are placed inside a JSON
 * object, inside a string value, and inside a multi-byte character on purpose.
 */

function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

/** Splits a whole payload into fixed-size chunks, ignoring line boundaries entirely. */
function chunked(payload: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < payload.length; i += size) out.push(payload.slice(i, i + size));
  return out;
}

async function collect(response: Response): Promise<ChatStreamEvent[]> {
  vi.stubGlobal("fetch", vi.fn(async () => response));
  const events: ChatStreamEvent[] = [];
  for await (const event of apiStream<ChatStreamEvent>("/api/chat/sessions/s1/messages", { method: "POST" })) {
    events.push(event as ChatStreamEvent);
  }
  return events;
}

const TURN: ChatStreamEvent = {
  type: "turn",
  userMessage: {
    id: "m1",
    role: "USER",
    content: "why?",
    contentHtml: null,
    sequence: 1,
    partial: false,
    truncated: false,
    safetyResponse: false,
    createdAt: "2026-08-28T10:00:00.000Z",
  },
  assistantMessageId: "m2",
};

const PAYLOAD =
  `${JSON.stringify(TURN)}\n` +
  `${JSON.stringify({ type: "delta", text: "Where " })}\n` +
  `${JSON.stringify({ type: "delta", text: "are you stuck?" })}\n` +
  `${JSON.stringify({ type: "error", code: "UPSTREAM_ERROR", message: "done-stand-in" })}\n`;

afterEach(() => {
  vi.unstubAllGlobals();
});

it("parses whole lines when each arrives in its own chunk", async () => {
  const events = await collect(streamOf(PAYLOAD.split("\n").filter(Boolean).map((l) => `${l}\n`)));
  expect(events.map((e) => e.type)).toEqual(["turn", "delta", "delta", "error"]);
});

it("reassembles a line split mid-JSON across chunks", async () => {
  // 7 divides nothing here; every boundary lands somewhere arbitrary, including
  // inside object keys, inside string values, and between a `\` and its escape.
  const events = await collect(streamOf(chunked(PAYLOAD, 7)));
  expect(events.map((e) => e.type)).toEqual(["turn", "delta", "delta", "error"]);
  expect(events.filter((e): e is Extract<ChatStreamEvent, { type: "delta" }> => e.type === "delta").map((e) => e.text)).toEqual([
    "Where ",
    "are you stuck?",
  ]);
});

it("survives one byte at a time", async () => {
  const events = await collect(streamOf(chunked(PAYLOAD, 1)));
  expect(events.map((e) => e.type)).toEqual(["turn", "delta", "delta", "error"]);
});

/**
 * A boundary inside a multi-byte character. `TextDecoder` handles this only
 * when called with `{ stream: true }` — without it each chunk is decoded
 * independently and a split emoji or accented character becomes U+FFFD, which
 * corrupts the JSON and takes the whole turn down with it.
 */
it("reassembles a multi-byte character split across chunks", async () => {
  const payload = `${JSON.stringify({ type: "delta", text: "café ✏️" })}\n`;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(payload);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // One byte at a time guarantees every multi-byte sequence is split.
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });

  const events = await collect(new Response(body, { status: 200 }));
  expect(events).toEqual([{ type: "delta", text: "café ✏️" }]);
});

it("yields a final line that arrived without a trailing newline", async () => {
  // Defensive: the server always terminates its lines. Dropping a terminal
  // event because a byte went missing would leave the UI typing forever.
  const events = await collect(streamOf([JSON.stringify({ type: "delta", text: "tail" })]));
  expect(events).toEqual([{ type: "delta", text: "tail" }]);
});

it("ignores blank lines rather than treating them as content", async () => {
  const events = await collect(streamOf([`\n\n${JSON.stringify({ type: "delta", text: "x" })}\n\n`]));
  expect(events).toEqual([{ type: "delta", text: "x" }]);
});

/**
 * ADR-0013 §2: a failure before the stream opened is a normal `ApiResult` with
 * a real status. The caller must not need a second code path for it — it is
 * surfaced as the same terminal error event, carrying the allowlisted message
 * that was already written to be read by a child.
 */
it("turns a pre-stream ApiResult failure into one terminal error event", async () => {
  const response = new Response(
    JSON.stringify({ ok: false, error: { code: "CONFLICT", message: "This session has finished." } }),
    { status: 409, headers: { "Content-Type": "application/json" } },
  );
  const events = await collect(response);
  expect(events).toEqual([{ type: "error", code: "CONFLICT", message: "This session has finished." }]);
});

it("reports a non-JSON error body without inventing content", async () => {
  const events = await collect(new Response("<html>502 Bad Gateway</html>", { status: 502 }));
  expect(events).toHaveLength(1);
  expect(events[0].type).toBe("error");
});

it("reports a network failure instead of throwing across the caller's loop", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
  const events: ChatStreamEvent[] = [];
  for await (const event of apiStream<ChatStreamEvent>("/api/chat/sessions/s1/messages")) {
    events.push(event as ChatStreamEvent);
  }
  expect(events).toEqual([
    { type: "error", code: "UPSTREAM_ERROR", message: expect.any(String) },
  ]);
});

it("stops at a malformed line rather than yielding garbage after it", async () => {
  const events = await collect(
    streamOf([`${JSON.stringify({ type: "delta", text: "ok" })}\nnot json at all\n${JSON.stringify(TURN)}\n`]),
  );
  expect(events.map((e) => e.type)).toEqual(["delta", "error"]);
});
