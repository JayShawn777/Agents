import { describe, expect, it } from "vitest";

import { toPublicSession } from "@/lib/auth/session-shape";

describe("toPublicSession() — the auth() return shape", () => {
  it("carries only { user: { id, email }, expires } — never the session token or any other User column", () => {
    const result = toPublicSession(
      { id: "user_1", email: "parent@example.com" },
      { expires: new Date("2026-01-01T00:00:00.000Z") },
    );

    expect(result).toEqual({
      user: { id: "user_1", email: "parent@example.com" },
      expires: "2026-01-01T00:00:00.000Z",
    });
    // Exactly two keys on `user` — guards against a future edit widening
    // this back into "spread the whole row".
    expect(Object.keys(result.user).sort()).toEqual(["email", "id"]);
    expect(Object.keys(result).sort()).toEqual(["expires", "user"]);
  });

  it("serializes expires to an ISO string, not a Date", () => {
    const result = toPublicSession(
      { id: "user_1", email: null },
      { expires: new Date("2030-06-15T12:30:00.000Z") },
    );
    expect(typeof result.expires).toBe("string");
    expect(result.expires).toBe("2030-06-15T12:30:00.000Z");
  });
});
