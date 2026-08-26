# ADR-0006: All mutations are route handlers; server actions are used only for Auth.js

- **Status:** Proposed
- **Date:** 2026-08-26
- **Deciders:** Jaysh (pending)
- **Spec:** docs/specs/m0-accounts-and-profiles.md, docs/specs/m1-upload-and-extract.md

## Context

The project constitution lists "API routes / server actions" as equally valid
backend surfaces, and the Next.js App Router default for form mutations is a
server action. Choosing per-feature would leave two validation patterns, two
error shapes and two authorization helpers in a codebase whose most important
property is that every read of student data is scoped to the owning account.

The acceptance criteria push hard in one direction. They are written in HTTP
terms and they are written as *attacks*, not as form submissions:

- M0 AC 10 — "a **direct POST** to the profile-creation endpoint carrying a
  grade level that is not in the allowed set → the response is **HTTP 400** with
  the project's typed error shape".
- M0 AC 11 — zero, nine, or an unknown subject → **HTTP 400**.
- M0 AC 12 — an avatar identifier outside the preset set → **HTTP 400**.
- M0 AC 14 — after deletion, "a direct request for that profile returns
  **HTTP 404**".
- M0 AC 15 — account A requesting, editing or deleting account B's profile →
  **HTTP 404**, and B's row unchanged.
- M0 AC 25 / 26 / 30, M1 AC 11 / 12 — **401**, **403**, **403**.
- M1 AC 17 — the hourly cap → **HTTP 429** with the typed error shape.
- M1 AC 33 — cross-account read of an upload or extracted problem → **HTTP 404**.

A server action does not have a status code available to its caller. It is a
POST to the current page URL that returns 200 with a serialised result; a
failure is a value, not a status. Asserting "HTTP 400 with the typed error
shape" against a server action means asserting the shape of an RSC action
payload, which is an internal wire format we do not control and should not
couple tests to. Fifteen acceptance criteria would become approximations.

There is one unavoidable exception: Auth.js's `signIn()` and `signOut()`
helpers set and clear cookies from server code and are designed to be invoked
from a server action or a form post to the Auth.js catch-all.

## Decision

We will implement **every application mutation and every non-page read as a
route handler under `app/api/`**, returning `NextResponse.json()` with an
explicit status and, on failure, the single `ApiError` shape defined in
`lib/errors.ts`.

**Two server actions exist, both in `lib/auth/actions.ts`:**
`signInWithEmail` (writes the `AdultAttestation`, calls Auth.js `signIn`) and
`signOutSession` (calls Auth.js `signOut`). No others. Any future action must
supersede this ADR.

Consequences of that choice, made concrete:

- Every route handler is wrapped by `withAuth()` in `lib/api/handler.ts`, which
  resolves the session (401 on absence), zod-parses the body (400 with
  `fieldErrors`), maps thrown domain errors to statuses, sets
  `Cache-Control: no-store`, and guarantees the response body is either
  `{ ok: true, data }` or `{ ok: false, error: { code, message, fieldErrors? } }`.
- **Authorization is a `where` clause, never a check.** Handlers taking a
  `studentProfileId` resolve it through
  `requireStudentProfile(id)` → `db.studentProfile.findFirst({ where: { id,
  userId: session.user.id } })`. A profile belonging to another account is
  indistinguishable from a nonexistent one, which is exactly the **404** that
  AC 15 and M1 AC 33 demand. `403` is reserved for cases where the caller
  legitimately owns the resource but the operation is barred — an upload token
  for a `CONSENT_REQUIRED` profile (AC 30) — because collapsing that to 404
  would hide from the parent that their own profile exists.
- Forms are client components calling `apiFetch<T>()` from `lib/api/client.ts`,
  the single place that understands `ApiError`, followed by `router.refresh()`
  to re-render the server components that own the data.
- Page-level reads stay in server components through the DAL. No route handler
  exists to serve data a server component already has.

## Alternatives considered

### Server actions for forms, route handlers for programmatic endpoints
- **Pros:** The idiomatic App Router split. Progressive enhancement: forms work
  with JavaScript disabled. No client-side fetch wrapper. Slightly less code per
  form.
- **Cons:** Two error conventions, two validation call sites and two
  authorization helpers, in the codebase where a single missed `userId` scope is
  a children's-data breach. Fifteen acceptance criteria stop being literally
  testable. The "programmatic" boundary is fuzzy — profile creation is a form
  *and* the thing AC 10 attacks with a direct POST.
- **Rejected because:** uniformity of the authorization boundary is worth more
  here than progressive enhancement, and the specs were written against HTTP.

### Server actions everywhere, with ACs reinterpreted
- **Pros:** Least code, fully idiomatic, no fetch layer.
- **Cons:** Requires rewriting fifteen acceptance criteria to say "returns a
  typed failure result" instead of "HTTP 400/403/404/429" — a scope negotiation
  with the owner, after approval, to make the implementation convenient. Server
  actions are also public untrusted endpoints (Next's own guidance) with a
  generated, non-stable identifier, so the "direct POST" adversarial tests
  become awkward regardless.
- **Rejected because:** changing the spec to fit the implementation is the wrong
  direction, and the ACs' HTTP framing is deliberate — they are security
  criteria.

### tRPC
- **Pros:** End-to-end types with no hand-written DTOs; one procedure definition
  replaces route plus schema plus client call.
- **Cons:** A major new dependency; a bespoke transport whose HTTP status
  mapping is its own convention, so the ACs' status codes still need
  translating; a second routing system alongside the App Router.
- **Rejected because:** a dependency and a parallel router to solve a typing
  problem that exported zod schemas and DTO types already solve.

### A single `/api/graphql` endpoint
- **Pros:** One endpoint, one schema.
- **Cons:** GraphQL returns 200 for logical errors by design, which is the exact
  opposite of what these ACs assert. Large new dependency and a per-field
  authorization surface.
- **Rejected because:** it directly contradicts the status-code criteria.

## Consequences

### Positive
- One `ApiError` shape, one `withAuth()` wrapper, one authorization helper. A
  reviewer can audit "is every student query scoped by `userId`?" by reading
  `lib/auth/dal.ts` and grepping for handlers that bypass it.
- Every acceptance criterion that names a status code is asserted literally, in
  Vitest, by calling the exported handler directly — no browser, no RSC payload.
- The backend track can be built and fully tested before any UI exists, which is
  what makes the parallel frontend/backend split real rather than nominal.
- Route handlers are the natural home for the cron jobs and the
  `handleUpload()` callback, which cannot be server actions anyway.

### Negative / accepted trade-offs
- **No progressive enhancement.** Every form requires JavaScript. Acceptable:
  the upload flow requires JavaScript unconditionally (client-direct upload,
  magic-byte sniffing, wasm conversion), so a no-JS path would work for half the
  product and fail at its core.
- More boilerplate per mutation: a route file, a zod schema, a DTO type and a
  client call, versus one action function.
- Manual revalidation — `router.refresh()` after a successful mutation instead
  of `revalidatePath()` inside an action.
- One documented inconsistency: sign-in and sign-out are server actions.
- CSRF is not free the way it is with server actions. Mitigated by
  `SameSite=Lax` session cookies plus a same-origin `Origin` header check inside
  `withAuth()` for all non-GET methods. That check is part of the wrapper, not
  per-route, so it cannot be forgotten.

### Follow-up required
- [ ] `lib/api/handler.ts` must include the `Origin`/`Sec-Fetch-Site`
      same-origin check for non-GET methods; the security reviewer should verify
      it exists before M0 is called done.
- [ ] One Vitest helper that asserts any error response conforms to `ApiError`,
      applied to every handler, so the shape cannot drift.

## Revisit when

A future milestone genuinely needs a no-JavaScript path; or the boilerplate cost
becomes the dominant complaint in review; or Next ships a way for server actions
to return real status codes.
