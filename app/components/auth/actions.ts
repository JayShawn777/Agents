"use server";

/**
 * A `useActionState`-shaped adapter around `signInWithEmail`
 * (`lib/auth/actions.ts`, backend track, plan §3.1). `signInWithEmail`'s
 * fixed contract takes a single validated `input: unknown` and returns
 * `ApiResult<{ sent: true }>` — it has no opinion about `FormData` or a
 * `(prevState, formData)` shape, because its other caller (a route handler,
 * if it ever needed one) wouldn't need one either. `useActionState` does,
 * so that adaptation lives here, in the frontend track, rather than inside
 * the shared action.
 */

import { signInWithEmail } from "@/lib/auth/actions";
import type { ApiResult } from "@/lib/errors";

export type SignInActionState = ApiResult<{ sent: true }> | null;

export async function submitSignIn(
  _prevState: SignInActionState,
  formData: FormData,
): Promise<SignInActionState> {
  return signInWithEmail({
    email: formData.get("email"),
    // The checkbox posts "on" when ticked and is absent from the FormData
    // entirely when it isn't (plan's AC 6 — never a pre-checked default).
    // `signInWithEmailInputSchema` requires the literal `true`, so anything
    // else (including an absent key) must become `false` here and fail
    // validation with a field error, not silently pass.
    isAdult: formData.get("isAdult") === "on",
  });
}
