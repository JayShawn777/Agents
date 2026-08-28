// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import { RequestLessonButton } from "@/components/lessons/request-lesson-button";

/**
 * `components/lessons/request-lesson-button.tsx` — M4's entry point.
 *
 * Its own test file for the same reason it is its own slice: retro lesson 15
 * came from M2.5 shipping seven green slices, 616 tests, and no screen that
 * offered a way to start a checkpoint. A feature nobody can reach is
 * unreachable code however green the suite is.
 */

let fetchMock: ReturnType<typeof vi.fn>;

function ok(lessonId = "les_1") {
  return new Response(JSON.stringify({ ok: true, data: { lesson: { id: lessonId, status: "PENDING" } } }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => ok());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requesting a lesson", () => {
  it("posts to the extracted-problem endpoint and navigates to the lesson", async () => {
    render(<RequestLessonButton subject={{ kind: "EXTRACTED_PROBLEM", problemId: "ep_1" }} />);
    fireEvent.click(screen.getByRole("button", { name: /show me on the whiteboard/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/extracted-problems/ep_1/lessons");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");

    await waitFor(() => expect(push).toHaveBeenCalledWith("/lessons/les_1"));
  });

  it("posts to the practice-problem endpoint for the other binding", async () => {
    render(<RequestLessonButton subject={{ kind: "PRACTICE_PROBLEM", problemId: "pp_1" }} />);
    fireEvent.click(screen.getByRole("button", { name: /show me on the whiteboard/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/practice-problems/pp_1/lessons");
  });

  it("navigates to the lesson the server actually created, not a guessed id", async () => {
    fetchMock.mockResolvedValue(ok("les_from_server"));
    render(<RequestLessonButton subject={{ kind: "EXTRACTED_PROBLEM", problemId: "ep_1" }} />);
    fireEvent.click(screen.getByRole("button", { name: /show me on the whiteboard/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/lessons/les_from_server"));
  });

  /**
   * AC 5 working as intended is not an error state. "Have a go at this one
   * first" is the gate doing its job, and it belongs inline rather than as an
   * alarm.
   */
  it("shows a 409 inline and does not navigate", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: { code: "CONFLICT", message: "Have a go at this one first — then I can walk you through it." },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<RequestLessonButton subject={{ kind: "EXTRACTED_PROBLEM", problemId: "ep_1" }} />);
    fireEvent.click(screen.getByRole("button", { name: /show me on the whiteboard/i }));

    await waitFor(() => expect(screen.getByText(/have a go at this one first/i)).toBeInTheDocument());
    expect(push).not.toHaveBeenCalled();
  });

  it("surfaces the hourly cap without inventing a message of its own", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, error: { code: "RATE_LIMITED", message: "Too many attempts. Please wait a bit and try again." } }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<RequestLessonButton subject={{ kind: "PRACTICE_PROBLEM", problemId: "pp_1" }} />);
    fireEvent.click(screen.getByRole("button", { name: /show me on the whiteboard/i }));

    await waitFor(() => expect(screen.getByText(/too many attempts/i)).toBeInTheDocument());
  });

  it("accepts a caller-supplied label, so the same button reads right in each place", () => {
    render(
      <RequestLessonButton subject={{ kind: "PRACTICE_PROBLEM", problemId: "pp_1" }} label="Draw it out for me" />,
    );
    expect(screen.getByRole("button", { name: "Draw it out for me" })).toBeInTheDocument();
  });
});
