// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PersonaPicker } from "@/components/personas/persona-picker";
import type { PersonaDTO } from "@/lib/schemas/dto";

/**
 * `components/personas/persona-picker.tsx` (M5 AC 3/4, slice 7) — the screen
 * a child reaches to choose which computer voice reads a lesson.
 *
 * Fixture note (retro lesson 20): these three personas are exactly the shape
 * `lib/personas/dto.ts`'s `toPersonaDTO` produces from a seeded `Persona` row
 * — id, slug, label, description, artworkId, nothing else. No provider voice
 * id anywhere in this file, which is the point: AC 1 says that value reaches
 * nowhere past the database, and a fixture that included one would be testing
 * a shape nothing renders.
 */

const PERSONAS: PersonaDTO[] = [
  { id: "per_smoothj", slug: "smooth-j", label: "Smooth J", description: "Takes it easy.", artworkId: "persona-smooth-j" },
  { id: "per_vale", slug: "coach-vale", label: "Coach Vale", description: "Precise and serious.", artworkId: "persona-coach-vale" },
  { id: "per_love", slug: "professor-love", label: "Professor Love", description: "Patient and encouraging.", artworkId: "persona-professor-love" },
];

let fetchMock: ReturnType<typeof vi.fn>;

function ok() {
  return new Response(JSON.stringify({ ok: true, data: { student: { id: "st_1" } } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function failure() {
  return new Response(
    JSON.stringify({ ok: false, error: { code: "CONFLICT", message: "That couldn't be completed right now. Please refresh and try again." } }),
    { status: 409, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => ok());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("choosing a voice", () => {
  it("starts with nothing extra selected when the profile already chose one", () => {
    render(
      <PersonaPicker studentId="st_1" personas={PERSONAS} initialPersonaId="per_vale" defaultPersonaId="per_love" />,
    );

    expect(screen.getByRole("radio", { name: /coach vale/i })).toHaveAttribute("data-checked", "");
    expect(screen.getByRole("radio", { name: /smooth j/i })).not.toHaveAttribute("data-checked");
  });

  /** AC 4: null means "the default persona", not "no voice" — the default shows selected. */
  it("shows the default persona selected when the profile has never chosen one", () => {
    render(
      <PersonaPicker studentId="st_1" personas={PERSONAS} initialPersonaId={null} defaultPersonaId="per_love" />,
    );

    expect(screen.getByRole("radio", { name: /professor love/i })).toHaveAttribute("data-checked", "");
  });

  it("PATCHes the student route with the chosen persona id", async () => {
    render(
      <PersonaPicker studentId="st_1" personas={PERSONAS} initialPersonaId={null} defaultPersonaId="per_love" />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /smooth j/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/students/st_1");
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ personaId: "per_smoothj" });

    await waitFor(() => expect(screen.getByText("Saved.")).toBeInTheDocument());
    expect(screen.getByRole("radio", { name: /smooth j/i })).toHaveAttribute("data-checked", "");
  });

  it("snaps back to the last saved choice, and shows the allowlisted error, on a failed PATCH", async () => {
    fetchMock.mockResolvedValueOnce(failure());
    render(
      <PersonaPicker studentId="st_1" personas={PERSONAS} initialPersonaId="per_love" defaultPersonaId="per_love" />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /coach vale/i }));

    await waitFor(() =>
      expect(screen.getByText("That couldn't be completed right now. Please refresh and try again.")).toBeInTheDocument(),
    );
    // Back to the persona the profile actually still has, not the failed pick.
    expect(screen.getByRole("radio", { name: /professor love/i })).toHaveAttribute("data-checked", "");
    expect(screen.getByRole("radio", { name: /coach vale/i })).not.toHaveAttribute("data-checked");
  });
});
