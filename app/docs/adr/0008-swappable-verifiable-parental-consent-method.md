# ADR-0008: Verifiable parental consent is a swappable, recorded method behind one interface

- **Status:** Proposed
- **Date:** 2026-08-26
- **Deciders:** Jaysh (pending)
- **Spec:** docs/specs/m0-accounts-and-profiles.md
- **Research:** docs/research/coppa-childrens-privacy.md

## Context

The previous M0 draft treated an in-app checkbox — "I am the parent" plus a name
and a relationship, recorded with IP and user agent — as verifiable parental
consent. It is not. The research is unambiguous: 16 CFR §312.5(b)(2) enumerates
the accepted methods and **every one of them independently corroborates the
consenter**. A self-assertion by whoever holds the session corroborates nothing;
it is an audit trail of a claim.

The revised spec (AC 16–20) requires:

- a `method` on every consent record, drawn from an enumerated set;
- a `methodEvidence` specific to that method;
- a `verifiedAt` that is **null until the corroborating step completes**, with
  the profile sitting in `CONSENT_PENDING` until it is set;
- and, critically, **AC 16**: changing the deployed method by configuration must
  change what new flows present, while records written under the previous method
  stay readable and profiles verified under it stay `ACTIVE` **with no data
  migration**. No method may be hard-coded into the profile, consent or upload
  code paths.

**Which method we should ship is not decidable today, and that is the whole
reason this ADR exists.** It turns on a question counsel has not answered:

> **Is sending a child's worksheet to Anthropic a "disclosure" under §312.2, or
> is Anthropic a "service provider providing support for the internal
> operations"?**

The research could not settle it and says so. It decides the available set:

- **If there is no disclosure**, the "email plus" and "text plus" methods are
  available. They are restricted to operators that do not disclose children's
  personal information to third parties. They are effectively free.
- **If there is a disclosure**, those two are off the table entirely and we are
  choosing between a payment-card transaction and a paid identity vendor.

The argument against the internal-operations reading is not weak. That
definition is a **closed list**, and its own text forbids using such data "to
amass a profile on a specific individual" — which is a fair description of M7's
mastery model. This is the single highest-value legal question in the product,
it must go to counsel with the Anthropic commercial terms attached, and it is
**blocking for public launch with real children but not for building M0**,
precisely because AC 16 requires swappability.

One more constraint from the spec's own non-goals: **"No billing, plans,
subscriptions or usage limits"** is a stated M0 non-goal, but it carries an
explicit exception — *"if the payment-card consent method is chosen, billing
becomes a prerequisite for M0 rather than a later milestone."* The Rule's
payment-card method requires notification of a **discrete transaction**; a
stored card with no charge does not qualify. Choosing that method therefore
drags a payment processor, a charge (and probably a refund), a webhook, and the
associated PCI-scope reasoning into M0. That is a scope decision the owner must
make knowingly, not a detail an engineer discovers in week two.

**A caveat on the enum labels, stated up front.** The research agent had web
search but not web fetch. It says outright that it never read §312.5(b)(2) as a
continuous list and **inferred the subsection lettering** from search-engine
summaries. This ADR therefore names the methods and deliberately does **not**
encode subsection letters anywhere — not in the enum, not in the code, not in
parent-facing copy. The labels below are working names for *method shapes* that
the research describes consistently. **They must be confirmed against eCFR
before any of them appears in parent-facing text, in a privacy policy, or in
anything shown to a regulator**, and before the enum is treated as closed.

## Decision

We will implement verifiable parental consent as a **`ConsentMethodProvider`
strategy selected at runtime from configuration**, with the chosen method
**recorded on every consent record** so that history is self-describing and no
record ever depends on what the configuration happens to say when it is read.

### 1. One enum, recorded on the row, never inferred

```prisma
/// Method shapes enumerated in 16 CFR §312.5(b)(2). Subsection LETTERING is
/// deliberately not encoded — see ADR-0008 "caveat on the enum labels".
/// Values are append-only: removing one is a destructive migration against rows
/// that are legal evidence.
enum ConsentMethod {
  SIGNED_FORM
  PAYMENT_CARD
  TOLL_FREE_CALL
  VIDEO_CALL
  GOV_ID_CHECK
  KBA
  FMVPI
  EMAIL_PLUS
  TEXT_PLUS
}
```

All nine values exist in the schema from the first migration even though one
implementation ships. Adding a value later is a migration; having them present
costs nothing and means a method swap is a configuration change and a new file,
never a schema change (AC 16).

### 2. The interface

`lib/consent/methods/port.ts`, imported by nothing outside `lib/consent/`:

```ts
export type ConsentBeginResult =
  | { kind: 'pending'; evidenceRef: string | null; challenge?: ChallengeSpec }
  | { kind: 'verified'; evidenceRef: string };

export type ChallengeSpec = {
  /// SHA-256 of the token handed to the parent. The token itself is never stored.
  tokenHash: string;
  expiresAt: Date;
};

export type CorroborationResult =
  | { ok: true; consentId: string; evidenceRef: string }
  | { ok: false; code: 'EXPIRED' | 'ALREADY_USED' | 'NOT_FOUND' | 'REJECTED' };

export interface ConsentMethodProvider {
  readonly method: ConsentMethod;
  /// Identifier of the versioned copy block describing this method's steps to the
  /// parent. Rendered server-side; never a hard-coded string in a component.
  readonly stepCopyId: string;
  /// Extra fields this method needs on the consent form, as a zod schema.
  /// EMAIL_PLUS contributes nothing; TEXT_PLUS contributes a phone number.
  readonly extraInputSchema: z.ZodType;
  /// Runs immediately after the ParentalConsent row is inserted, inside the same
  /// transaction. Must not perform network I/O that cannot be retried safely.
  begin(ctx: ConsentContext): Promise<ConsentBeginResult>;
  /// Runs from this method's callback route. Verification only — it does not
  /// write the consent row, does not touch StudentProfile, and does not know
  /// what ACTIVE means.
  corroborate(input: unknown): Promise<CorroborationResult>;
}
```

`lib/consent/methods/registry.ts` maps every `ConsentMethod` value to either a
live provider or a `NotImplementedProvider` that throws at startup if selected.
`lib/config.ts` reads `CONSENT_METHOD` from the environment, validates it
against the enum with zod at module load, and exports the resolved provider.
**A bad or unimplemented value fails the boot, not the parent's request.**

### 3. What the rest of the codebase is allowed to know

Exactly two facts: that a consent record exists with a non-null `verifiedAt`,
and that `StudentProfile.status === 'ACTIVE'`. Nothing outside `lib/consent/`
may branch on `ConsentMethod`. The upload-token route, the profile-detail route,
the dashboard and the DAL all gate on `status`, which is what makes AC 16's
"profiles verified under the previous method remain `ACTIVE`" true by
construction rather than by care.

The state machine lives in `lib/consent/service.ts` and is method-agnostic:

```
submit()      → insert ParentalConsent (verifiedAt null) → provider.begin()
              → status = CONSENT_PENDING                              [AC 18]
callback()    → provider.corroborate() → stamp verifiedAt (conditional
                UPDATE, see ADR-0007 §3) → status = ACTIVE            [AC 19]
```

If `begin()` returns `{ kind: 'verified' }` — a method whose corroboration is
synchronous, such as a vendor returning an inline decision — the service still
runs the same stamp, so `verifiedAt` is always distinct from and later than
`submittedAt` (AC 19) and the profile is never `ACTIVE` at insert time.

### 4. Evidence is a reference, never a live credential

`methodEvidence` is a nullable opaque string holding a **reference**: a
processor transaction id, a vendor verification id, a stored signed-form
pathname, or the id of a consumed challenge. It never holds a token that would
still grant consent if the database leaked.

Pending challenges live in their own short-lived table,
`ConsentVerificationChallenge`, holding only a **SHA-256 of the token**, the
method, an expiry and a `consumedAt`. This mirrors how the sign-in tokens are
handled in ADR-0002 and for the same reason: for `EMAIL_PLUS`, that token *is*
parental consent, so it is a bearer credential of unusual consequence.

### 5. The confirmation link is a page, not a mutating GET

For `EMAIL_PLUS`/`TEXT_PLUS`, the message contains a link to
`/consent/verify/[token]` — a public **page** that renders a single explicit
confirm control which POSTs to `/api/consent/verify`.

This is not stylistic. Corporate mail scanners, link-preview bots and
"safe links" rewriters routinely follow every URL in an inbound email. A GET
that stamps `verifiedAt` would let a security appliance grant verifiable
parental consent on a parent's behalf, which is a defect that is both a
compliance failure and unfalsifiable after the fact. The page is also where a
parent who did **not** consent gets a visible "this was not me" action.

### 6. What happens to records under a superseded method

Nothing. Concretely:

- `method` is on the row, so a record written under `EMAIL_PLUS` still reads as
  `EMAIL_PLUS` after the deployment switches to `PAYMENT_CARD`.
- Verified profiles are **not** re-verified, not downgraded, and not flagged. The
  consent was validly obtained under the method in force at the time; that is the
  point of recording the method and the consent-text version.
- The registry keeps entries for retired methods in a read-only capacity so a
  historical row still resolves to a display label and a copy version. Only
  `begin()`/`corroborate()` become unreachable.
- Enum values are never removed. Removing one would be a destructive migration
  against rows that are legal evidence.
- `ConsentAuditArtifact` (ADR-0007 §6) also carries `method`, so the fact
  survives even deletion.

**If counsel later says a previously used method was inadequate**, that is not a
data migration either — it is a re-consent campaign: the affected profiles move
to `CONSENT_WITHDRAWN` or a new `CONSENT_PENDING` cycle via a new appended row,
and the old rows stand as an accurate record of what we actually did. Rewriting
them would be the wrong response to being wrong.

### 7. What ships first

**Recommendation: implement `EMAIL_PLUS` first and treat it as provisional.**
It is the only method that can be built, tested end to end and demonstrated
without a vendor contract, a payment processor or a phone number, so it unblocks
every other part of M0. It is also the method counsel is most likely to strike
out. Building it first is therefore a bet on the *interface*, not on the method
— which is exactly what AC 16 asks for.

**It must not be shipped to real children before counsel answers the disclosure
question.** The spec's open questions mark that as blocking for public launch,
and this ADR does not change that.

## Alternatives considered

### Hard-code one method in the consent route
- **Pros:** Least code by a wide margin. No registry, no interface, no
  `NotImplementedProvider`, no method column to keep honest.
- **Cons:** AC 16 forbids it in terms. More importantly, the decision that
  selects the method is a **legal** one that has not been made, so hard-coding
  means the answer arrives as a rewrite of the consent, profile and upload paths
  under time pressure.
- **Rejected because:** we are being asked to build before the deciding input
  exists. An interface is the standard answer to that and costs perhaps a day.

### A generic "consent provider" SDK / third-party consent-management platform
- **Pros:** Someone else owns the method implementations and their regulatory
  currency. PRIVO and the safe-harbor programs (kidSAFE, ESRB, TrustArc) offer
  this shape, and safe-harbor membership carries an independent benefit: an
  FTC-approved program can approve non-enumerated methods for its members.
- **Cons:** A new sub-processor holding parent identity data for a children's
  product — a new DPA, a new named third party in the §312.4 direct notice
  (AC 13), and a new entry in the §312.8 vendor capability assessment (AC 52).
  No pricing verified by anyone on this team. It also does not remove the need
  for the interface; it becomes one implementation behind it.
- **Rejected for M0, worth pricing:** safe-harbor membership is a real strategic
  option and the research names it. It is a commercial decision, not an
  architectural one, and the port accommodates it later without change.

### Ship `EMAIL_PLUS` as the permanent answer
- **Pros:** Effectively free. Best completion rate of the low-cost options. The
  direct notice is already being emailed (AC 14), so the infrastructure exists.
- **Cons:** **Available only if we make no "disclosure"** — unresolved, and the
  internal-operations list is closed and expressly hostile to "amass a profile on
  a specific individual", which is M7. If counsel says we disclose, every consent
  collected this way is arguably invalid, and we would have collected children's
  data on an invalid basis at scale.
- **Rejected as a permanent answer, accepted as the first implementation:** the
  downside is bounded only while the population is small and the method is
  swappable.

### `TEXT_PLUS`
- **Pros:** The same near-zero-cost structure with materially better completion
  than email. Per-message cost is Twilio-class — cents.
- **Cons:** Same non-disclosure restriction, so it does not de-risk the legal
  question at all. Adds an SMS provider: a new sub-processor, a new named third
  party in the notice, and a **phone number** in the data table, which is
  personal information about the adult we do not otherwise hold. Newest of the
  methods and least tested in practice.
- **Rejected for first implementation:** it buys completion rate at the cost of a
  vendor and a new data category, while carrying the identical legal exposure.
  Trivial to add later as a second provider.

### `PAYMENT_CARD`
- **Pros:** Available regardless of how the disclosure question resolves. Common
  in practice. If we are charging for the product anyway, consent rides the real
  subscription charge at literally zero marginal cost and zero extra friction.
- **Cons:** The Rule requires notification of a **discrete transaction** — a card
  on file with no charge does not qualify. So while the product is free, we must
  create a real charge and refund it. Card economics make micro-charges lossy
  (roughly 2.9% + 30¢ per transaction on a $0.50 charge, and the fee is not
  refunded when the charge is). It also demands a card from a parent who has not
  yet seen the product work, which is the single largest conversion cliff of any
  option here. **And it drags billing into M0, which the spec lists as a
  non-goal** — a processor, a webhook, a refund path and a new named third party.
- **Rejected for now, and the strongest candidate the moment we charge money:**
  if the product gains a paid plan, this becomes near-free and near-frictionless
  and should be revisited immediately.

### `FMVPI` (face match to verified photo ID) or `GOV_ID_CHECK` via a vendor
- **Pros:** Available regardless of the disclosure answer. Good parent-facing UX
  compared with printing a form or taking a phone call. `GOV_ID_CHECK` requires
  the ID to be deleted promptly after verification, which limits our exposure
  window.
- **Cons:** Per-verification vendor cost — the research states a rough
  $0.50–$3 range for ID checks and **explicitly did not verify it**; nobody on
  this team has a quote. Both introduce a vendor processing the adult's identity
  documents. `FMVPI` additionally means processing a **face image**, which the
  2025 amendments added to "personal information" as a biometric identifier and
  which is an enumerated biometric identifier under Illinois BIPA — we would be
  taking on the exact category of risk M6 is being carefully designed around, in
  M0, to avoid a different risk.
- **Rejected for M0:** unpriced, and `FMVPI` in particular trades a COPPA
  question for a BIPA question. Retained as the designated fallback if counsel
  says we disclose and we are still free-tier.

### `KBA` (knowledge-based authentication)
- **Pros:** No document upload, no charge, no phone call. Instant. Vendor-run.
- **Cons:** Requires dynamic multiple-choice questions hard enough that a
  12-year-old could not answer them, which in practice means credit-bureau
  out-of-wallet questions. It **fails structurally** for adults with thin credit
  files, recent immigrants, and young parents — the failure mode is a parent
  being told they cannot prove they are their child's parent, with no recourse
  and a support ticket. Per-check vendor cost, also unpriced.
- **Rejected, and the research says so directly: do not ship KBA as the only
  path.** It is acceptable at most as one option among several.

### `SIGNED_FORM` (print, sign, return by mail/fax/scan)
- **Pros:** Cheapest to build of the disclosure-proof methods — generate a PDF,
  accept a scan back. No vendor, no per-use fee.
- **Cons:** Brutal friction; completion rates collapse. It also means accepting
  an uploaded document from an unauthenticated-ish flow and storing a signed
  form containing a parent's handwriting and address, which is a new sensitive
  artifact with its own retention obligation.
- **Rejected for M0:** it is a viable emergency fallback that needs no vendor, so
  it is worth keeping in the enum, but nobody should design a signup around it.

### `TOLL_FREE_CALL` / `VIDEO_CALL`
- **Pros:** Unambiguously accepted methods; high assurance.
- **Cons:** Both require **trained personnel**. On a team of this size that means
  a vendor and a staffing model, and video is the highest-friction option in the
  entire list.
- **Rejected:** not viable at our size. Present in the enum for completeness.

## Consequences

### Positive
- The legal answer, when it arrives, changes one environment variable and adds
  one file. Nothing in the schema, the routes, the DTOs or the UI moves.
- Consent history is self-describing: every row states the method, the consent
  text version and the notice version that were actually in force.
- A method swap cannot invalidate existing consent, because nothing reads the
  configured method to interpret an old row (AC 16).
- The unimplemented methods are enumerated and named, so the cost of each is a
  documented comparison rather than a rediscovery.
- Confining method knowledge to `lib/consent/` gives the security reviewer a
  single directory to audit, and gives the rest of the codebase one boolean.

### Negative / accepted trade-offs
- An interface with one implementation is speculative generality, and would be
  the wrong call if the method were decided. It is not decided, and AC 16
  requires it.
- `CONSENT_PENDING` is a real user-visible limbo state: the parent submits and
  the child still cannot do anything until a second step completes. That is
  inherent to every enumerated method, not to this design.
- The `EMAIL_PLUS` confirmation token is a bearer credential that grants
  parental consent. Hashing at rest, a short TTL, single use, rate limiting and
  the page-not-GET rule in §5 are all load-bearing, not defence in depth.
- **We may build `EMAIL_PLUS` and then be told we may not use it.** That is a
  known, accepted write-off of roughly a day's work, chosen over blocking all of
  M0 on a legal answer with no date.
- Nine enum values with one implementation will look like over-engineering to a
  reviewer who has not read this ADR. The schema comment points here.

### Follow-up required
- [ ] **LAWYER, blocking for public launch:** is sending a child's worksheet to
      Anthropic a "disclosure"? Take the Anthropic commercial terms to counsel.
      The answer selects the available method set.
- [ ] **Confirm the method names and the enum labels against eCFR §312.5(b)(2)**
      before any label reaches parent-facing copy, the privacy policy, or a
      filing. The research inferred the lettering and never read the list.
- [ ] **PRODUCT, blocking before M0 is declared done:** which method ships. If
      `PAYMENT_CARD`, billing enters M0 and the spec's non-goal is void — say so
      out loud before the engineers start.
- [ ] Get real quotes for at least one identity vendor before the fallback is
      needed, so the fallback has a price attached.
- [ ] Price safe-harbor membership (kidSAFE / PRIVO / ESRB), which also unlocks
      program-approved non-enumerated methods.
- [ ] Add `CONSENT_METHOD` and `AUDIT_PSEUDONYM_KEY` to `.env.example` and the
      runbook. Neither may be `NEXT_PUBLIC_`.
- [ ] Whichever method ships, add its vendor to the §312.8 capability assessment
      in `docs/security-program.md` (AC 52) **before** it processes anything.

## Revisit when

Counsel answers the disclosure question; or the product starts charging money,
at which point `PAYMENT_CARD` becomes near-free and near-frictionless and should
be reconsidered immediately; or `EMAIL_PLUS` completion rates prove worse than
`TEXT_PLUS` by enough to justify an SMS vendor; or the FTC approves a new method
under its voluntary approval process; or we join a safe harbor program whose
approved methods differ from the enumerated set.
