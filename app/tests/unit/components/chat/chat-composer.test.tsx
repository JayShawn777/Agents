// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { ChatComposer } from "@/components/chat/chat-composer";
import type { ChatMessageDTO, ChatStreamEvent } from "@/lib/schemas/dto";

/**
 * `components/chat/chat-composer.tsx` — the one client component that owns the
 * NDJSON read, the `AbortController` and the retry.
 *
 * These drive the component through a REAL `ReadableStream` rather than mocking
 * `apiStream`, so the parsing, the terminal-event rules and the retry key all
 * run for real. Mocking the reader would test the mock.
 */

function message(overrides: Partial<ChatMessageDTO> = {}): ChatMessageDTO {
  return {
    id: "msg_a",
    role: "ASSISTANT",
    content: "Where are you stuck?",
    contentHtml: null,
    sequence: 2,
    partial: false,
    truncated: false,
    safetyResponse: false,
    createdAt: "2026-08-28T10:00:00.000Z",
    ...overrides,
  };
}

const TURN_EVENT: ChatStreamEvent = {
  type: "turn",
  userMessage: message({ id: "msg_u", role: "USER", content: "why did you flip it?", sequence: 1 }),
  assistantMessageId: "msg_a",
};

/** Builds a Response whose body streams the given NDJSON events. */
function ndjson(events: ChatStreamEvent[]): Response {
  const lines = events.map((event) => `${JSON.stringify(event)}\n`).join("");
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // Chunked at 5 bytes so line boundaries land mid-JSON, as they do on a
      // real connection.
      const bytes = encoder.encode(lines);
      for (let i = 0; i < bytes.length; i += 5) controller.enqueue(bytes.slice(i, i + 5));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "3f2504e0-4f89-11d3-9a0c-0305e82c3301" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * `fireEvent` rather than `user-event`: the latter is not a dependency of this
 * project, and CLAUDE.md's Never list forbids adding one without asking. The
 * two existing component tests use the same approach.
 */
function send(text: string) {
  fireEvent.change(screen.getByLabelText(/your message/i), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
}

describe("a successful turn", () => {
  it("renders the student's message, the streamed reply, and then the stored one", async () => {
    fetchMock.mockResolvedValue(
      ndjson([
        TURN_EVENT,
        { type: "delta", text: "Where " },
        { type: "delta", text: "are you stuck?" },
        { type: "done", message: message(), session: { id: "s", status: "OPEN", subject: { kind: "EXTRACTED_PROBLEM", id: "ep" }, studentTurnCount: 1, maxStudentTurns: 20, expiresAt: "", openedAt: "", closedAt: null } },
      ]),
    );

    render(<ChatComposer sessionId="sess_1" serverMessageIds={[]} />);
    send("why did you flip it?");

    await waitFor(() => {
      expect(screen.getByText("why did you flip it?")).toBeInTheDocument();
      expect(screen.getByText("Where are you stuck?")).toBeInTheDocument();
    });
  });

  it("posts the typed content with a client-generated turn id", async () => {
    fetchMock.mockResolvedValue(
      ndjson([TURN_EVENT, { type: "done", message: message(), session: { id: "s", status: "OPEN", subject: { kind: "EXTRACTED_PROBLEM", id: "ep" }, studentTurnCount: 1, maxStudentTurns: 20, expiresAt: "", openedAt: "", closedAt: null } }]),
    );

    render(<ChatComposer sessionId="sess_1" serverMessageIds={[]} />);
    send("why did you flip it?");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat/sessions/sess_1/messages");
    expect(JSON.parse(init.body)).toEqual({
      clientTurnId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      content: "why did you flip it?",
    });
  });

  it("re-reads the stored transcript once the turn lands", async () => {
    fetchMock.mockResolvedValue(
      ndjson([TURN_EVENT, { type: "done", message: message(), session: { id: "s", status: "OPEN", subject: { kind: "EXTRACTED_PROBLEM", id: "ep" }, studentTurnCount: 1, maxStudentTurns: 20, expiresAt: "", openedAt: "", closedAt: null } }]),
    );

    render(<ChatComposer sessionId="sess_1" serverMessageIds={[]} />);
    send("why?");

    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  /**
   * The hand-off from the locally-held bubble to the server-rendered one. Once
   * the server transcript carries the id, the local copy must disappear — or
   * the student sees their turn twice.
   */
  it("drops its local copy once the server transcript carries the same id", async () => {
    fetchMock.mockResolvedValue(
      ndjson([TURN_EVENT, { type: "done", message: message(), session: { id: "s", status: "OPEN", subject: { kind: "EXTRACTED_PROBLEM", id: "ep" }, studentTurnCount: 1, maxStudentTurns: 20, expiresAt: "", openedAt: "", closedAt: null } }]),
    );

    const { rerender } = render(<ChatComposer sessionId="sess_1" serverMessageIds={[]} />);
    send("why?");
    await waitFor(() => expect(screen.getByText("Where are you stuck?")).toBeInTheDocument());

    rerender(<ChatComposer sessionId="sess_1" serverMessageIds={["msg_u", "msg_a"]} />);
    expect(screen.queryByText("Where are you stuck?")).not.toBeInTheDocument();
  });
});

describe("failure and retry (AC 18, AC 19)", () => {
  it("shows the allowlisted message and a retry on a terminal error event", async () => {
    fetchMock.mockResolvedValue(
      ndjson([TURN_EVENT, { type: "error", code: "UPSTREAM_ERROR", message: "The tutor isn't available right now. Please try again in a moment." }]),
    );

    render(<ChatComposer sessionId="sess_1" serverMessageIds={[]} />);
    send("why?");

    await waitFor(() => {
      expect(screen.getByText(/tutor isn't available right now/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    });
  });

  /**
   * The whole reason a retry button is safe to offer: the turn is idempotent on
   * this key, so retrying replays a reply that already generated rather than
   * creating a second turn or a second bill.
   */
  it("retries with the SAME clientTurnId", async () => {
    fetchMock.mockResolvedValueOnce(
      ndjson([TURN_EVENT, { type: "error", code: "UPSTREAM_ERROR", message: "Please try again in a moment." }]),
    );
    fetchMock.mockResolvedValueOnce(
      ndjson([TURN_EVENT, { type: "done", message: message(), session: { id: "s", status: "OPEN", subject: { kind: "EXTRACTED_PROBLEM", id: "ep" }, studentTurnCount: 1, maxStudentTurns: 20, expiresAt: "", openedAt: "", closedAt: null } }]),
    );

    render(<ChatComposer sessionId="sess_1" serverMessageIds={[]} />);
    send("why?");

    await waitFor(() => expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.clientTurnId).toBe(first.clientTurnId);
    expect(second.content).toBe("why?");
  });

  /**
   * ADR-0013 §3: the UI leaves the typing state on `done`, on `error`, or on
   * its own timeout — NEVER on stream end alone. A socket that dies quietly
   * would otherwise leave a child watching "Thinking…" forever.
   */
  it("treats a stream that ends with no terminal event as a failure, not a success", async () => {
    fetchMock.mockResolvedValue(ndjson([TURN_EVENT, { type: "delta", text: "Where " }]));

    render(<ChatComposer sessionId="sess_1" serverMessageIds={[]} />);
    send("why?");

    await waitFor(() => expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument());
    expect(screen.queryByText(/thinking/i)).not.toBeInTheDocument();
  });

  it("surfaces a pre-stream ApiResult failure through the same one path", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: { code: "RATE_LIMITED", message: "Too many attempts. Please wait a bit and try again." } }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<ChatComposer sessionId="sess_1" serverMessageIds={[]} />);
    send("why?");

    await waitFor(() => expect(screen.getByText(/too many attempts/i)).toBeInTheDocument());
  });
});

describe("the composer itself", () => {
  it("will not send an empty or whitespace-only message", async () => {
    render(<ChatComposer sessionId="sess_1" serverMessageIds={[]} />);

    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/your message/i), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a waiting state until the first delta arrives (AC 2)", async () => {
    // Initialised rather than left null: TypeScript cannot see an assignment
    // made inside a Promise executor, and narrows the variable to `never` at
    // the call site below.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const encoder = new TextEncoder();
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode(`${JSON.stringify(TURN_EVENT)}\n`));
            await gate;
            controller.close();
          },
        }),
        { status: 200 },
      ),
    );

    render(<ChatComposer sessionId="sess_1" serverMessageIds={[]} />);
    send("why?");

    await waitFor(() => expect(screen.getByText(/thinking/i)).toBeInTheDocument());
    release();
  });
});
