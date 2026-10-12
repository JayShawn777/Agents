import { afterEach, describe, expect, it } from "vitest";

import { isSignupAllowed } from "@/lib/auth/allowlist";

const original = process.env.ALLOWED_SIGNUP_EMAILS;
afterEach(() => {
  if (original === undefined) delete process.env.ALLOWED_SIGNUP_EMAILS;
  else process.env.ALLOWED_SIGNUP_EMAILS = original;
});

describe("isSignupAllowed (invite-only gate)", () => {
  it("is OPEN when unset or empty — the shipped default", () => {
    delete process.env.ALLOWED_SIGNUP_EMAILS;
    expect(isSignupAllowed("anyone@example.com")).toBe(true);
    process.env.ALLOWED_SIGNUP_EMAILS = "  ,  ";
    expect(isSignupAllowed("anyone@example.com")).toBe(true);
  });

  it("admits only listed addresses once set, comma or whitespace separated", () => {
    process.env.ALLOWED_SIGNUP_EMAILS = "dad@example.com, mom@example.com\nnana@example.com";
    expect(isSignupAllowed("dad@example.com")).toBe(true);
    expect(isSignupAllowed("nana@example.com")).toBe(true);
    expect(isSignupAllowed("stranger@example.com")).toBe(false);
  });

  it("compares case-insensitively and does not accept a substring or a lookalike", () => {
    process.env.ALLOWED_SIGNUP_EMAILS = "Dad@Example.com";
    expect(isSignupAllowed("dad@example.COM")).toBe(true);
    expect(isSignupAllowed("xdad@example.com")).toBe(false);
    expect(isSignupAllowed("dad@example.com.evil.io")).toBe(false);
  });
});
