---
name: review-ordering-tests-must-be-falsified
description: How to review this repo's ADR-0006 ordered-checks tests — run them against a deliberately reordered handler instead of reading them
metadata:
  type: project
---

`app/docs/adr/0006-*.md` fixes a 7-step check order in `withAuth()`
(session 401 → origin 403 → resource 404 → consent-state 403 → flow 409 →
zod 400 → rate limit 429) and calls the order itself part of the contract.
ADR-0006's follow-up list requires one ordering test per consent-gated
handler, so this will recur at every milestone.

**Do not judge those tests by reading them. Falsify them.** A test that
configures only one failing check proves nothing about precedence; only a
test where *two* checks fail at once pins the pair.

**Why:** at M0, all 13 tests in `tests/unit/lib/api/handler.test.ts` passed
against a handler reordered to 1,2,3,**5,4,7,6**. The AC-11 pair
(consent-state before body) was genuinely pinned; the state↔flow pair and
the rate-limit position were not pinned at all.

**How to apply:** copy `lib/api/handler.ts` to the scratchpad, move the step
blocks (hoist the `let body` declaration or you get a TDZ error that is a
false positive), and run the repo's own test file against it via a scratch
vitest config that aliases `@/lib/api/handler` to the copy. Aliases needed:
`@/`, `zod`, and `server-only` → `tests/unit/mocks/server-only.ts`; import
`@vitejs/plugin-react` by absolute path since the config lives outside the
package. Report any pair that survives reordering. Never edit the repo copy.
