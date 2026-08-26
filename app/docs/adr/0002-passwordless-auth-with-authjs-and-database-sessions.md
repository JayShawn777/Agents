# ADR-0002: Passwordless email sign-in with Auth.js v5 and database sessions

- **Status:** Proposed
- **Date:** 2026-08-26
- **Revised:** 2026-08-26 (see "Revision note")
- **Deciders:** Jaysh (pending)
- **Spec:** docs/specs/m0-accounts-and-profiles.md

## Revision note — 2026-08-26

The M0 spec was revised on the same date (36 → 52 acceptance criteria). **The
decision in this ADR is unchanged** — the sign-in mechanism was not what the
spec revision touched. Four references are corrected because they now point at
the wrong thing:

1. **AC renumbering.** The old AC 36 (account deletion, soft-delete, sign-in
   refusal) is now **AC 47**, and it is specifically **account *closure***.
   Every "AC 36" below now reads AC 47.
2. **Sign-in refusal applies to account closure only.** The revised spec splits
   deletion three ways (ADR-0007 §4). A parent's §312.6 request to delete a
   child's data does **not** close the account, does **not** set
   `closureRequestedAt`, and must **not** refuse the adult's sign-in. The
   `signIn` callback's refusal condition is `User.closureRequestedAt`, and
   nothing else.
3. **The endpoint is `/api/account/closure`, not `/api/account/deletion`.**
   Renamed deliberately; see ADR-0007 §4(c).
4. **The last follow-up item is answered and removed.** It asked for legal
   review of whether an in-app attestation plus an adult-attested consent meets
   COPPA's verifiable-parental-consent bar. The research answered it: **it does
   not.** Verifiable parental consent is now its own decision in **ADR-0008**,
   and it does not supersede this one. The 18+ attestation in AC 6 survives
   untouched, because it was never claimed to be consent — it is an age gate for
   the *account holder* and the spec now says so explicitly.

One thing this ADR now owns that it did not before: `lib/email/` sends **three**
distinct message types, and they must not be confused. The sign-in magic link
(AC 3), the §312.4 direct notice email (AC 14), and — if `EMAIL_PLUS` is the
configured consent method — the confirmatory consent message (ADR-0008 §5). The
spec's non-goals state plainly that the sign-in link is **not** the confirmatory
step of an email-plus consent method. They use different tokens, different
tables, different TTLs and different landing pages. Nothing in the consent flow
may reuse `VerificationToken`.

## Context

M0 requires an authenticated adult account holder before any student data can
exist. Nothing is installed: `package.json` has no auth package, and
`.env.example` carries commented `AUTH_SECRET` / `AUTH_URL` entries that imply
Auth.js but decide nothing. The spec names this **BLOCKING**.

The acceptance criteria constrain the mechanism tightly:

- AC 2 — email-only entry; the response must not reveal whether an account
  already existed.
- AC 3 — session cookie is `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS.
- AC 4 — the sign-in link is **single-use** and expires.
- AC 5 — sign-out **invalidates the session server-side**; the old cookie must
  not work afterwards.
- AC 6 — an 18+ attestation is required and **no `User` row is written**
  without it.
- AC 47 — an account in the closure recovery window must be **refused sign-in**
  for 30 days.

AC 5 is the sharpest constraint: a stateless JWT session cannot be invalidated
server-side, so sign-out would only clear a cookie that still verifies. AC 5
therefore forces a **server-side session store**, which in turn forces a
database adapter.

Two further facts shape the choice. Prisma 7 generates its client to
`lib/generated/prisma/` and it is imported from `@/lib/db`, never from
`@prisma/client` (CLAUDE.md, runbook §2) — so any adapter that types its
argument as `PrismaClient` imported from `@prisma/client` may not typecheck.
And the project constitution forbids `any` without a justifying comment, so
"cast it and move on" is not available.

## Decision

We will use **Auth.js v5 (`next-auth@^5`) with the `database` session strategy,
a single passwordless email provider, and the Prisma adapter**, wired as:

- `app/api/auth/[...nextauth]/route.ts` — the Auth.js catch-all handler.
- `lib/auth/config.ts` — `NextAuth({ adapter, session: { strategy: 'database' },
  providers: [magicLink], callbacks, pages })`.
- The magic-link provider is a **custom `type: 'email'` provider** with our own
  `sendVerificationRequest` that POSTs to the Resend HTTP API with `fetch`. No
  mail SDK and no SMTP client is added. `maxAge` is set to **900 seconds**
  (15 minutes) to satisfy AC 4's expiry half; Auth.js deletes the
  `VerificationToken` row on redemption, which satisfies the single-use half.
- In non-production, `sendVerificationRequest` writes the URL to the server
  console instead of sending. Playwright reads the token directly from the
  `VerificationToken` table through Prisma in a fixture, so e2e needs no mail
  server and no test-only HTTP route.
- **Two server actions only** — `signInWithEmail` and `signOutSession` — because
  Auth.js's `signIn()` / `signOut()` helpers must be invoked from server code.
  Every other mutation in M0/M1 is a route handler (see ADR-0006).
- **The 18+ attestation (AC 6) is enforced in `signInWithEmail`**, before
  `signIn()` is called. Its zod input is
  `{ email: z.email(), isAdult: z.literal(true) }`. Without the attestation no
  email is dispatched, therefore no token exists, therefore no callback can run,
  therefore no `User` row can be created. The action also writes an
  `AdultAttestation` row (email, timestamp, IP, user agent, 15-minute expiry),
  and the `signIn` callback refuses any redemption with no live attestation for
  that address — defence in depth against a replayed link.
  **This is an account-holder age gate and carries no COPPA weight.** It is not
  consent and must never be presented as consent; see ADR-0008.
- **AC 47** is enforced in the `signIn` callback: if
  `user.closureRequestedAt` is set and the recovery window has not elapsed,
  return `false`. The account-closure route also deletes every `Session` row
  for that user so existing cookies die immediately. No other deletion path
  affects sign-in.
- **`lib/auth/dal.ts`** is the only place session state is read. It exports
  React-`cache`d `verifySession()`, `requireUser()` and
  `requireStudentProfile(studentProfileId)`; the last one resolves a profile
  **only** via `where: { id, userId: session.userId }` and returns `null`
  otherwise. Per the Next 16 authentication guide, authorization is done at the
  data source, not in a layout and not in `proxy.ts`.
- **`proxy.ts` performs an optimistic cookie-presence redirect only.** It is a
  UX optimisation. It is never the authorization boundary — Next's own docs say
  proxy "should not be your only line of defense", and it may be deployed to the
  CDN separately from render code.

Cookie flags come from Auth.js defaults (`httpOnly: true`, `sameSite: 'lax'`,
`secure` + `__Secure-` prefix when the URL is HTTPS), which satisfies AC 3 as
written.

**Contingency, stated up front:** if `@auth/prisma-adapter` does not typecheck
against the Prisma 7 generated client, we implement the `Adapter` interface from
`@auth/core/adapters` directly in `lib/auth/prisma-adapter.ts` against our own
models (~15 small functions) and drop the `@auth/prisma-adapter` dependency. We
do **not** cast to `any`.

## Alternatives considered

### Hand-rolled magic link + opaque database sessions (zero auth dependency)
- **Pros:** No new major dependency to approve. ~150 lines, fully auditable, no
  version coupling to Prisma 7. Every AC — single-use token, 15-minute expiry,
  server-side revocation, closure refusal, attestation gate — is expressed
  directly rather than through a hook. No unused `Account`/`Authenticator`
  tables. No JWT, no password hashing, no OAuth: the crypto surface is a
  32-byte random token and a SHA-256 hash.
- **Cons:** Auth code we own forever. Session fixation, token comparison,
  cookie-prefix handling and CSRF posture all become our review burden. The
  security-reviewer stage will reasonably challenge it. Any future OAuth or MFA
  requirement means writing it or migrating to a library anyway.
- **Rejected because:** the cost is paid in the least reviewable part of the
  codebase, in an app holding children's data, to save one dependency the owner
  was already anticipating in `.env.example`.

### Auth.js v5 with the JWT (stateless) session strategy
- **Pros:** No `Session` table, no database round trip per request, works
  without an adapter for the session half.
- **Cons:** Sign-out cannot invalidate anything server-side — the old cookie
  keeps verifying until its `exp`. Closure refusal (AC 47) is likewise
  unenforceable against an already-issued token without a denylist, which is a
  session table by another name.
- **Rejected because:** it fails AC 5 and AC 47 outright.

### Better Auth (magic-link plugin, Prisma adapter)
- **Pros:** TypeScript-native, database sessions by default with real
  revocation, first-class magic-link plugin, actively maintained, generates its
  own schema.
- **Cons:** A second schema-owning tool alongside Prisma migrations; its CLI
  wants to write `schema.prisma`, which collides with our hand-authored models
  and our immutable-migration rule. Contradicts the `AUTH_SECRET` / `AUTH_URL`
  scaffolding already in `.env.example`. Smaller body of Next 16 App Router
  precedent.
- **Rejected because:** it is a credible equal on capability but introduces a
  competing owner of `prisma/schema.prisma`. Reconsider if Auth.js v5's
  perpetual beta becomes a problem.

### Clerk / WorkOS / Auth0 (hosted identity)
- **Pros:** Nothing to build. Verified email, MFA, device management included.
- **Cons:** A third-party processor holding the account owner's identity for a
  product handling minors' data — a new sub-processor, a new DPA, a new name in
  the §312.4 direct notice (AC 13) and a new row in the vendor capability
  assessment (AC 52). Per-MAU pricing. User records live outside our Postgres,
  so `StudentProfile.userId` becomes a foreign identifier and the account-purge
  path (AC 47) has to span two systems.
- **Rejected because:** the compliance and deletion story gets worse, not
  better, for a feature we can satisfy with a table.

### Password-based sign-in
- **Pros:** Familiar; no email deliverability dependency.
- **Cons:** Password storage, reset flows, breach exposure, and a credential a
  parent will lose.
- **Rejected because:** the spec's non-goals rule it out explicitly.

## Consequences

### Positive
- AC 5 and AC 47 are satisfied by deleting rows, which is trivially testable.
- Sessions, users, consent records and notice records all live in one Postgres
  database, so the AC 47 purge is one transaction plus a blob sweep.
- No password, no OAuth, no MFA surface in M0.
- Email deliverability is the only external dependency in the auth path, and it
  is behind one function we can stub in tests.

### Negative / accepted trade-offs
- A database round trip per authenticated request to load the session. Mitigated
  by React `cache` deduplicating it within a render pass.
- `next-auth@5` has been in beta for an extended period; we accept an unstable
  minor-version surface.
- The Prisma adapter requires `Account` and `VerificationToken` models. `Account`
  is unused in M0 (no OAuth provider) and exists solely to satisfy the adapter.
- Every sign-in requires re-ticking the 18+ attestation box, since the
  attestation is bound to the request that dispatches the link, not to a
  remembered account state. This is mildly repetitive and defensible.
- Sign-in and sign-out are server actions while everything else is a route
  handler — one deliberate inconsistency, documented in ADR-0006.
- Email deliverability now sits on the critical path of a **compliance**
  artifact, not only of sign-in: AC 14 requires the direct notice to be emailed,
  and `EMAIL_PLUS` would make the confirmatory message the consent itself. A
  Resend outage degrades from "a parent cannot sign in" to "a parent cannot
  complete consent". See the plan's risk table.

### Follow-up required
- [ ] Owner approval for `next-auth@^5` and `@auth/prisma-adapter`.
- [ ] Add `AUTH_SECRET`, `AUTH_URL`, `AUTH_RESEND_KEY`, `EMAIL_FROM` to
      `.env.example` and the runbook env table.
- [ ] Verify `@auth/prisma-adapter` typechecks against the Prisma 7 generated
      client on the first install; if not, execute the hand-written-`Adapter`
      contingency and record it as a superseding ADR.
- [ ] Verify the `Secure` flag and the `__Secure-` cookie prefix on a Vercel
      preview deployment — local Playwright runs over HTTP and cannot assert it.
- [ ] Add the transactional email provider to the §312.8 vendor capability
      assessment in `docs/security-program.md` (AC 52) before it carries a
      direct notice or a consent message.

## Revisit when

Any of: the app needs a second sign-in factor or a social provider; sign-in
email deliverability becomes a support burden; `next-auth@5` stays in beta past
the point where a stable alternative is clearly better. Note that a stronger
*parental consent* method does **not** revisit this ADR — consent identity and
account identity are separate concerns, and consent lives in ADR-0008.
