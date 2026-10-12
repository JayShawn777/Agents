# ADR-0023: An account-owned persona is one nullable column and one required WHERE clause

- **Status:** Proposed
- **Date:** 2026-10-12
- **Deciders:** Jaysh (pending)
- **Spec:** docs/specs/m6-custom-voice.md (AC 12, 13, 14, 18)
- **Plan:** docs/plans/m6-custom-voice-implementation.md (§1, §2.1, slice 1)

## Context

M5's six personas are app reference data owned by nobody. M6 adds a cloned voice
that belongs to one account. The picker, `StudentProfile.personaId`,
`LessonNarration`, `NarrationAsset`, the cache key and the disclosure already work
off a `Persona` row.

M5 also shipped three unscoped persona reads — the PATCH validation, the narration
route's resolver and the DAL — that were correct only because no row had an owner.
The moment one does, an unscoped `findFirst({ id })` lets account A point their
child's narration at account B's cloned parent voice: a stranger's real voice
reading a child's homework, reachable by pasting one cuid.

## Decision

**1. Extend `Persona`; do not add a parallel model.** One nullable
`ownerUserId` (cascade on user delete) and a `status` (`ACTIVE`,
`PENDING_VERIFICATION`, `REVOKED`). `NULL` owner means the shared set. Everything
downstream keeps working unchanged. A custom voice's slug is `custom-<id>`,
generated server-side, so it can never collide with or be reached as a stock slug.

**2. `lib/personas/dal.ts` is the only module that reads `Persona`.** Every reader
takes a **required** `viewerUserId` and composes `personaVisibilityWhere`:
`{ OR: [{ ownerUserId: null }, { ownerUserId: viewer }] }`. There is no optional
variant, because an optional parameter is how the clause quietly disappears.
`single-reader.test.ts` reads the source tree and fails if `db.persona.<read>`
appears elsewhere. This landed in slice 1, before any owned persona could exist.

**3. Visibility and usability are different questions.**
- *Visible* (display, AC 16 disclosure): shared, or owned by the viewer. A foreign
  persona is indistinguishable from a missing one.
- *Selectable* and *listed*: visible, not retired, **and `ACTIVE`**.
- *Generated with*: `ACTIVE` only. The narration resolver falls back to the
  default persona for anything else.

Slice 9 added the status conditions. They were missing from slice 1: a `REVOKED`
voice (already deleted at the vendor) and a `PENDING_VERIFICATION` voice (cannot
synthesise yet) stayed selectable and generatable. Integration tests against real
Postgres and a narration-route test now pin both.

**4. Revocation also clears the pointers.** `revokeCustomVoice` nulls every
`StudentProfile.personaId` that referenced the persona (the row survives, so no
`SetNull` fires). Explicit delete relies on the foreign key's `SetNull`. Either
way a null means "the default" (AC 3).

**5. Deletion is account-level, not profile-level.** Deleting one child's profile
does not delete the parent's voice while siblings still use it; it removes that
profile's narration assets through the existing profile blob sources. Account
deletion calls `deleteAllCustomVoicesForUser` *before* the user cascade so the
vendor voice id is not lost with the row.

## Alternatives considered

### A separate `CustomPersona` model
- **Rejected because:** It forks the picker, the profile FK, the cache key and the
  disclosure, for isolation that one column and one clause provide.

### Per-call-site ownership checks
- **Rejected because:** That is what M5 had; three call sites each needed to
  remember. A grep-enforced single reader cannot be forgotten.

## Consequences

### Positive
- Cross-account exposure is structurally impossible through the DAL.
- No schema fork; the six stock personas are untouched.

### Negative / accepted trade-offs
- A caller cannot ask for "any persona"; background jobs must pass a real owner.
- `status` and `retiredAt` both exist and mean different things (voice lifecycle vs
  app withdrawal). Both must be read.

### Follow-up required
- [ ] If the strict reading of AC 20 is ever wanted (profile deletion deletes the
  voice), `deleteAllCustomVoicesForUser` is the seam.

## Revisit when
A second owner type appears (a school, a household with two adults) or personas
become shareable between accounts.
