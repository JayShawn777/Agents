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
it. Instead add a tiny `"use server"` adapter file in a frontend-owned
directory (e.g. `components/<feature>/actions.ts`, next to the client
component that uses it) that imports the real action and translates
`FormData`/`prevState` into the single validated input object. This keeps
the backend file untouched and the frontend still gets proper
pending/field-error state. Example from M0: `components/auth/actions.ts`
wraps `lib/auth/actions.ts`'s `signInWithEmail`; `components/nav/actions.ts`
wraps `signOutSession`. See [[frontend-parallel-track-workflow]].
