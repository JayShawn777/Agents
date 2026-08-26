"use server";

/**
 * A `<form action>`-shaped adapter around `signOutSession`
 * (`lib/auth/actions.ts`, backend track, plan §3.1). `signOutSession`'s
 * fixed contract takes a validated `input: unknown` matching
 * `z.object({}).strict()` — it does not accept the raw `FormData` object a
 * `<form action={signOutSession}>` invocation would otherwise hand it, so
 * that adaptation lives here.
 */

import { signOutSession } from "@/lib/auth/actions";

export async function submitSignOut(): Promise<void> {
  await signOutSession({});
}
