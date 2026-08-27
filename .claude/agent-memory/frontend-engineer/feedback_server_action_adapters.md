---
name: feedback-server-action-adapters
description: When a backend server action's fixed signature doesn't match useActionState/<form action>'s calling convention, write a small "use server" adapter in frontend-owned files rather than touching the backend file.
metadata:
  type: feedback
---

Backend-owned server actions are sometimes specified/typed as
`(input: unknown) => Promise<ApiResult<T>>` (one argument, matching the API
contract's request/response table) rather than the
`(prevState, formData) => newState` shape React's `useActionState` requires,
or the plain `(formData) => void` shape a raw `<form action={fn}>` requires.

**Why:** the contract table (plan §3.1) only pins the validated input shape
and the success/error envelope, not the literal JS calling convention a
specific React API needs. A backend engineer writing against the contract
has no reason to add a `prevState` parameter or accept `FormData` — that's a
frontend/React concern.

**How to apply:** don't modify the backend's action file to add a
`FormData`-shaped overload, and don't skip `useActionState` to work around
it. Instead write a tiny adapter that imports the real action and translates
`FormData`/`prevState` into the single validated input object, so the
frontend still gets proper pending/field-error state.

**Correction (M0 code review, 2026-08-27):** where a project has an ADR
capping the total count of `"use server"` files (checked by
`grep -rl '"use server"' ...` returning exactly N paths — here, ADR-0006
capped it at one file, `lib/auth/actions.ts`, for exactly two actions), do
**not** give the adapter its own file with its own `"use server"` directive
— that's a new file the grep would count, defeating the ADR's point (every
`"use server"` export is a publicly invokable endpoint; the count must stay
greppable). Instead append the adapter as a plain exported async function in
the SAME file as the action it wraps — the file's single top-of-file
`"use server"` directive already covers every export in it, so the adapter
needs no directive of its own. `components/auth/actions.ts` and
`components/nav/actions.ts` (wrapping `signInWithEmail`/`signOutSession`)
were built as separate files in an earlier session and had to be deleted and
merged into `lib/auth/actions.ts` for exactly this reason. Only reach for a
separate frontend-owned adapter file (the original guidance above) when
there's no such cap to respect. See [[frontend-parallel-track-workflow]].
