// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * M6 slice 9 — the entry point. `YourVoiceCard` is the only link to
 * `/account/voice`, so these tests render the real card and check that the way
 * in exists, honours the cap, and offers each management action only when it
 * means something (the M2.5 lesson: a built flow nobody can reach is not built).
 */
const dalMock = { listOwnedPersonas: vi.fn() };
vi.mock("@/lib/personas/dal", () => dalMock);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch }));

const { YourVoiceCard } = await import("@/components/voice/your-voice-card");

async function renderCard() {
  render(await YourVoiceCard({ userId: "user_1" }));
}

const persona = (over: Record<string, unknown> = {}) => ({
  id: "per_1",
  label: "Dad",
  status: "ACTIVE",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("YourVoiceCard", () => {
  it("scopes its read to the signed-in account", async () => {
    dalMock.listOwnedPersonas.mockResolvedValue([]);
    await renderCard();
    expect(dalMock.listOwnedPersonas).toHaveBeenCalledWith("user_1");
  });

  it("links to the voice flow when the account has no voice", async () => {
    dalMock.listOwnedPersonas.mockResolvedValue([]);
    await renderCard();
    const link = screen.getByRole("link", { name: /add your voice/i });
    expect(link.getAttribute("href")).toBe("/account/voice");
  });

  it("offers stop-using and delete for an active voice, and no add link at the cap", async () => {
    dalMock.listOwnedPersonas.mockResolvedValue([persona()]);
    await renderCard();
    expect(screen.getByText("Dad")).toBeTruthy();
    expect(screen.getByRole("button", { name: /stop using this voice/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /delete this voice/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /add your voice/i })).toBeNull();
  });

  it("a revoked voice can only be deleted, and does not block adding a new one", async () => {
    dalMock.listOwnedPersonas.mockResolvedValue([persona({ status: "REVOKED" })]);
    await renderCard();
    expect(screen.getByText("Not in use")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /stop using this voice/i })).toBeNull();
    expect(screen.getByRole("button", { name: /delete this voice/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /add your voice/i })).toBeTruthy();
  });

  it("deleting calls endpoint 52 after confirmation and refreshes", async () => {
    dalMock.listOwnedPersonas.mockResolvedValue([persona()]);
    apiFetch.mockResolvedValue({ ok: true, data: { deleted: true } });
    await renderCard();

    fireEvent.click(screen.getByRole("button", { name: /delete this voice/i }));
    // The confirmation must say what a parent is agreeing to, including the
    // replay consequence the spec flags as startling for a child.
    expect(await screen.findByText(/narrated again in a standard voice/i)).toBeTruthy();
    const confirm = screen.getAllByRole("button", { name: /delete this voice/i }).at(-1)!;
    fireEvent.click(confirm);

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/voice/per_1", { method: "DELETE" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("revoking calls endpoint 53 with an empty strict body", async () => {
    dalMock.listOwnedPersonas.mockResolvedValue([persona()]);
    apiFetch.mockResolvedValue({ ok: true, data: { persona: { id: "per_1", status: "REVOKED" } } });
    await renderCard();

    fireEvent.click(screen.getByRole("button", { name: /stop using this voice/i }));
    const confirm = (await screen.findAllByRole("button", { name: /stop using this voice/i })).at(-1)!;
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/api/voice/per_1/revoke", { method: "POST", body: {} }),
    );
  });

  it("shows the API's own message on failure and does not refresh", async () => {
    dalMock.listOwnedPersonas.mockResolvedValue([persona()]);
    apiFetch.mockResolvedValue({ ok: false, error: { code: "NOT_FOUND", message: "That voice no longer exists." } });
    await renderCard();

    fireEvent.click(screen.getByRole("button", { name: /delete this voice/i }));
    const confirm = (await screen.findAllByRole("button", { name: /delete this voice/i })).at(-1)!;
    fireEvent.click(confirm);

    expect(await screen.findByText("That voice no longer exists.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
