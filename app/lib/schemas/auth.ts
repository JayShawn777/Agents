/**
 * zod input schemas for the two server actions (plan §3.1):
 * `signInWithEmail`, `signOutSession`.
 */

import { z } from "zod";

/**
 * `isAdult: z.literal(true)` is the account-holder 18+ attestation (AC 6) —
 * NOT parental consent (ADR-0002, ADR-0008). A missing or `false` value must
 * fail validation, not silently default.
 */
export const signInWithEmailInputSchema = z
  .object({
    email: z.email(),
    isAdult: z.literal(true),
  })
  .strict();

export type SignInWithEmailInput = z.infer<typeof signInWithEmailInputSchema>;

export const signOutSessionInputSchema = z.object({}).strict();

export type SignOutSessionInput = z.infer<typeof signOutSessionInputSchema>;
